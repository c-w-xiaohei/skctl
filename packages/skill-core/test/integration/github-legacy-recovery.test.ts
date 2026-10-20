import * as api from "../../src/index";
import { expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { runProcess } from "../../src/runtime/process";
import { repositoryFixture } from "../provider/repository-fixture";

type Outcome =
  | "available"
  | "missing"
  | "auth"
  | "socket"
  | "body"
  | "integrity"
  | "missing-integrity"
  | "unprocessable"
  | "tree-missing";
async function fixture(changed = true) {
  const value = await repositoryFixture({
    "skills/chosen/SKILL.md": "---\nname: chosen\ndescription: Chosen\n---\n",
    "skills/chosen/resource.txt": "old resource\n",
    "skills/other/SKILL.md": "---\nname: other\ndescription: Other\n---\n",
    "skills/other/resource.txt": "unselected\n",
    "skills/uninstalled/SKILL.md": "---\nname: uninstalled\ndescription: Uninstalled\n---\n",
    "skills/uninstalled/resource.txt": "never download\n",
  });
  const old = value.commit;
  await writeFile(join(value.work, "pin.txt"), "new commit\n");
  if (changed)
    await writeFile(join(value.work, "skills", "chosen", "resource.txt"), "new resource\n");
  await value.git("add", ".");
  await value.git("commit", "-m", "current");
  const current = await value.git("rev-parse", "HEAD"),
    currentTree = await value.git("rev-parse", "HEAD^{tree}");
  const currentEntries = JSON.parse(
    `[${(await value.git("ls-tree", "-r", "-t", '--format={"path":"%(path)","mode":"%(objectmode)","type":"%(objecttype)","sha":"%(objectname)"},', "HEAD")).replace(/,\s*$/, "")}]`,
  );
  const saved = {
    SKCTL_STATE_DIR: process.env.SKCTL_STATE_DIR,
    SKCTL_SOURCE_CACHE_DIR: process.env.SKCTL_SOURCE_CACHE_DIR,
  };
  const cache = join(value.root, "cache"),
    stateFile = join(value.root, "state", "state.json");
  process.env.SKCTL_STATE_DIR = join(value.root, "state");
  process.env.SKCTL_SOURCE_CACHE_DIR = cache;
  let outcome: Outcome = "available",
    currentUnavailable = false,
    disappearOnOld = false;
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    const path = new URL(request.url!, "http://fixture.invalid").pathname;
    requests.push(path);
    const json = (body: unknown, status = 200) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (path.endsWith("/git/ref/heads/main"))
      return json({ object: { sha: current, type: "commit" } });
    if (path.endsWith(`/commits/${old}`)) {
      if (outcome === "missing" || outcome === "missing-integrity") {
        if (disappearOnOld) currentUnavailable = true;
        return json(
          { message: outcome === "missing-integrity" ? "parse/integrity failure" : "Not Found" },
          404,
        );
      }
      if (outcome === "auth") return json({ message: "Bad credentials" }, 401);
      if (outcome === "unprocessable") return json({ message: "Validation Failed" }, 422);
      if (outcome === "socket") {
        response.destroy();
        return;
      }
      if (outcome === "body") {
        response.writeHead(200, { "content-length": "10000" });
        response.write('{"sha":');
        setTimeout(() => response.destroy(), 10);
        return;
      }
      return json({
        sha: outcome === "integrity" ? current : old,
        commit: { tree: { sha: value.tree } },
      });
    }
    if (path.endsWith(`/commits/${current}`))
      return currentUnavailable
        ? json({}, 404)
        : json({ sha: current, commit: { tree: { sha: currentTree } } });
    if (path.includes("/trees/")) {
      const tree = path.split("/").at(-1)!;
      if (outcome === "tree-missing" && tree === value.tree) return json({}, 404);
      return json({
        sha: tree,
        truncated: false,
        tree: tree === value.tree ? value.entries : currentEntries,
      });
    }
    if (path.includes("/blobs/")) {
      const id = path.split("/").at(-1)!,
        blob = await runProcess({ cmd: ["/usr/bin/git", "cat-file", "blob", id], cwd: value.work });
      return json({
        sha: id,
        encoding: "base64",
        content: blob.stdout.toString("base64"),
        size: blob.stdout.length,
      });
    }
    json({}, 404);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const core = {
    cwd: value.root,
    userConfigPath: join(value.root, "user.jsonc"),
    githubApiBaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    sourceTransport: () => "/unavailable-fallback",
  };
  await writeFile(
    join(value.root, "skctl.jsonc"),
    JSON.stringify({
      sources: {
        github: {
          kind: "github",
          origin: "https://github.com/acme/skills",
          root: "skills",
          ref: "main",
        },
      },
    }),
  );
  await api.installSkills(core, { source: "github", paths: ["chosen"], exactRevision: old });
  await api.installSkills(core, { source: "github", paths: ["other"], exactRevision: current });
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  state.version = 2;
  for (const item of state.installed) delete item.treeIdentity;
  await writeFile(stateFile, JSON.stringify(state));
  // This scenario explicitly lacks shared old metadata. Installation content survives.
  await rm(cache, { recursive: true });
  await mkdir(cache);
  requests.length = 0;
  return {
    ...value,
    core,
    old,
    current,
    stateFile,
    requests,
    setOld(next: Outcome) {
      outcome = next;
    },
    setCurrentUnavailable() {
      currentUnavailable = true;
    },
    disappearOnOldMissing() {
      disappearOnOld = true;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const [key, setting] of Object.entries(saved)) {
        if (setting === undefined) delete process.env[key];
        else process.env[key] = setting;
      }
      await rm(value.root, { recursive: true, force: true });
    },
  };
}

test("missing legacy comparison metadata fails check without content fallback; exact changed content remains applicable", async () => {
  for (const changed of [false, true]) {
    const value = await fixture(changed);
    try {
      value.setOld("missing");
      const before = await readFile(value.stateFile, "utf8");
      await expect(api.checkUpdate(value.core, { source: "github" })).rejects.toHaveProperty(
        "code",
        "SOURCE_NOT_FOUND",
      );
      expect(await readFile(value.stateFile, "utf8")).toBe(before);
      expect(value.requests.some((path) => path.includes("/blobs/"))).toBe(false);
      value.requests.length = 0;
      if (changed) {
        await api.updateSkills(value.core, {
          source: "github",
          paths: ["chosen"],
          exactRevision: value.current,
        });
        const updated = JSON.parse(await readFile(value.stateFile, "utf8"));
        expect(updated.installed.find((item: { path: string }) => item.path === "other")).toEqual(
          JSON.parse(before).installed.find((item: { path: string }) => item.path === "other"),
        );
        const chosen = updated.installed.find((item: { path: string }) => item.path === "chosen");
        expect(chosen).toMatchObject({
          adoptedRevision: value.current,
          treeIdentity: { objectFormat: "sha1" },
        });
        expect(
          await readFile(
            join(value.root, "state", "snapshots", chosen.digest, "root", "resource.txt"),
            "utf8",
          ),
        ).toBe("new resource\n");
        expect(value.requests).not.toContain(`/repos/acme/skills/commits/${value.old}`);
        expect(value.requests.filter((path) => path.includes("/blobs/"))).toHaveLength(2);
      } else {
        await expect(
          api.updateSkills(value.core, {
            source: "github",
            paths: ["chosen"],
            exactRevision: value.current,
          }),
        ).rejects.toHaveProperty("code", "INVALID_ARGUMENT");
        expect(await readFile(value.stateFile, "utf8")).toBe(before);
      }
    } finally {
      await value.close();
    }
  }
});

test("old metadata 404 followed by lost repository access never becomes digest recovery or a removal", async () => {
  const value = await fixture();
  try {
    value.setOld("missing");
    value.disappearOnOldMissing();
    const before = await readFile(value.stateFile, "utf8");
    await expect(api.checkUpdate(value.core, { source: "github" })).rejects.toHaveProperty(
      "code",
      "SOURCE_NOT_FOUND",
    );
    expect(value.requests.some((path) => path.includes("/blobs/"))).toBe(false);
    expect(await readFile(value.stateFile, "utf8")).toBe(before);
  } finally {
    await value.close();
  }
});

test.each([
  ["auth", "PROVIDER_AUTH_FAILED"],
  ["socket", "PROVIDER_UNAVAILABLE"],
  ["body", "PROVIDER_UNAVAILABLE"],
  ["integrity", "PROVIDER_INTEGRITY_FAILED"],
  ["unprocessable", "PROVIDER_UNAVAILABLE"],
  ["tree-missing", "SOURCE_NOT_FOUND"],
  ["missing-integrity", "SOURCE_NOT_FOUND"],
] as const)(
  "legacy metadata failure %s cannot authorize digest comparison, but a selected exact update needs no old metadata",
  async (outcome, code) => {
    const value = await fixture();
    try {
      value.setOld(outcome);
      const before = await readFile(value.stateFile, "utf8");
      await expect(api.checkUpdate(value.core, { source: "github" })).rejects.toHaveProperty(
        "code",
        code,
      );
      expect(value.requests).toContain(`/repos/acme/skills/commits/${value.old}`);
      expect(value.requests.some((path) => path.includes("/blobs/"))).toBe(false);
      expect(await readFile(value.stateFile, "utf8")).toBe(before);
      value.requests.length = 0;
      await api.updateSkills(value.core, {
        source: "github",
        paths: ["chosen"],
        exactRevision: value.current,
      });
      expect(value.requests).not.toContain(`/repos/acme/skills/commits/${value.old}`);
      expect(value.requests.filter((path) => path.includes("/blobs/"))).toHaveLength(2);
    } finally {
      await value.close();
    }
  },
);

test("an unavailable exact target cannot authorize check, removal or publication", async () => {
  const value = await fixture();
  try {
    value.setCurrentUnavailable();
    const before = await readFile(value.stateFile, "utf8");
    await expect(api.checkUpdate(value.core, { source: "github" })).rejects.toHaveProperty(
      "code",
      "SOURCE_NOT_FOUND",
    );
    await expect(
      api.updateSkills(value.core, {
        source: "github",
        paths: ["chosen"],
        exactRevision: value.current,
      }),
    ).rejects.toHaveProperty("code", "SOURCE_NOT_FOUND");
    expect(value.requests).not.toContain(`/repos/acme/skills/commits/${value.old}`);
    expect(value.requests.some((path) => path.includes("/blobs/"))).toBe(false);
    expect(await readFile(value.stateFile, "utf8")).toBe(before);
  } finally {
    await value.close();
  }
});
