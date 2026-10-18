import * as coreApi from "../../src/index";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
async function git(cwd: string, ...args: string[]) {
  const child = Bun.spawn(["/usr/bin/git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [output, error, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (status) throw new Error(error);
  return output.trim();
}
const blob = (text: string) => {
  const bytes = Buffer.from(text);
  return {
    id: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
    bytes,
  };
};
type OldOutcome =
  | "available"
  | "missing"
  | "auth"
  | "socket"
  | "body"
  | "integrity"
  | "missing-integrity"
  | "unprocessable"
  | "tree-missing";
async function fixture(changed: boolean) {
  const root = await mkdtemp(join(tmpdir(), "github-legacy-"));
  const work = join(root, "work"),
    bare = join(root, "remote.git"),
    stateFile = join(root, "state", "state.json");
  const previousState = process.env.SKILL_CLI_STATE_DIR;
  process.env.SKILL_CLI_STATE_DIR = join(root, "state");
  let oldOutcome: OldOutcome = "available",
    currentUnavailable = false,
    disappearAfterOld = false;
  const requests: string[] = [];
  await mkdir(work);
  await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
  await git(work, "init", "-b", "main");
  await git(work, "config", "user.email", "test@example.test");
  await git(work, "config", "user.name", "Test");
  await writeFile(join(work, "pin.txt"), "old");
  await git(work, "add", ".");
  await git(work, "commit", "-m", "old");
  const old = await git(work, "rev-parse", "HEAD");
  await writeFile(join(work, "pin.txt"), "current");
  await git(work, "add", ".");
  await git(work, "commit", "-m", "current");
  const current = await git(work, "rev-parse", "HEAD");
  await git(root, "init", "--bare", bare);
  await git(work, "push", bare, "HEAD:main");
  const marker = blob("---\nname: chosen\ndescription: Chosen\n---\n");
  const oldResource = blob("old resource\n"),
    currentResource = blob(changed ? "new resource\n" : "old resource\n");
  const otherMarker = blob("---\nname: other\ndescription: Other\n---\n"),
    otherResource = blob("unselected\n");
  const uninstalledMarker = blob("---\nname: uninstalled\ndescription: Uninstalled\n---\n"),
    uninstalledResource = blob("never download\n");
  const blobs = new Map(
    [
      marker,
      oldResource,
      currentResource,
      otherMarker,
      otherResource,
      uninstalledMarker,
      uninstalledResource,
    ].map((item) => [item.id, item]),
  );
  const oldRepo = "1".repeat(40),
    currentRepo = "2".repeat(40),
    oldSource = "3".repeat(40),
    currentSource = "4".repeat(40);
  const oldChosen = "5".repeat(40),
    currentChosen = "6".repeat(40),
    other = "7".repeat(40),
    uninstalled = "8".repeat(40);
  const directory = (path: string, sha: string) => ({ path, sha, mode: "040000", type: "tree" });
  const file = (path: string, item: ReturnType<typeof blob>) => ({
    path,
    sha: item.id,
    mode: "100644",
    type: "blob",
    size: item.bytes.length,
  });
  const trees = new Map<string, (ReturnType<typeof directory> | ReturnType<typeof file>)[]>([
    [oldRepo, [directory("skills", oldSource)]],
    [currentRepo, [directory("skills", currentSource)]],
    [
      oldSource,
      [
        directory("chosen", oldChosen),
        directory("other", other),
        directory("uninstalled", uninstalled),
      ],
    ],
    [
      currentSource,
      [
        directory("chosen", currentChosen),
        directory("other", other),
        directory("uninstalled", uninstalled),
      ],
    ],
    [oldChosen, [file("SKILL.md", marker), file("resource.txt", oldResource)]],
    [currentChosen, [file("SKILL.md", marker), file("resource.txt", currentResource)]],
    [other, [file("SKILL.md", otherMarker), file("resource.txt", otherResource)]],
    [uninstalled, [file("SKILL.md", uninstalledMarker), file("resource.txt", uninstalledResource)]],
  ]);
  function recursiveTree(id: string) {
    const entries: (ReturnType<typeof directory> | ReturnType<typeof file>)[] = [];
    function collect(treeId: string, prefix = "") {
      for (const entry of trees.get(treeId) ?? []) {
        const path = prefix ? `${prefix}/${entry.path}` : entry.path;
        entries.push({ ...entry, path });
        if (entry.type === "tree") collect(entry.sha, path);
      }
    }
    collect(id);
    return entries;
  }
  const api = createServer((request, response) => {
    const url = new URL(request.url!, "http://fixture.invalid");
    const path = url.pathname;
    requests.push(path);
    const json = (data: unknown, status = 200) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(data));
    };
    if (path.endsWith(`/commits/${old}`)) {
      if (oldOutcome === "missing") {
        if (disappearAfterOld) currentUnavailable = true;
        return json({ message: "Not Found" }, 404);
      }
      if (oldOutcome === "auth") return json({ message: "Bad credentials" }, 401);
      if (oldOutcome === "missing-integrity")
        return json({ message: "parse/integrity failure in commit response" }, 404);
      if (oldOutcome === "unprocessable") return json({ message: "Validation Failed" }, 422);
      if (oldOutcome === "socket") {
        response.destroy();
        return;
      }
      if (oldOutcome === "body") {
        response.writeHead(200, { "content-type": "application/json", "content-length": "10000" });
        response.write('{"sha":');
        setTimeout(() => response.destroy(), 10);
        return;
      }
      if (oldOutcome === "integrity")
        return json({ sha: current, commit: { tree: { sha: oldRepo } } });
      return json({ sha: old, commit: { tree: { sha: oldRepo } } });
    }
    if (path.endsWith(`/commits/${current}`))
      return currentUnavailable
        ? json({ message: "Not Found" }, 404)
        : json({ sha: current, commit: { tree: { sha: currentRepo } } });
    const id = path.split("/").at(-1)!;
    if (oldOutcome === "tree-missing" && id === oldRepo) return json({ message: "Not Found" }, 404);
    if (path.includes("/git/trees/") && url.searchParams.get("recursive") === "1" && trees.has(id))
      return json({ sha: id, truncated: false, tree: recursiveTree(id) });
    if (path.includes("/git/trees/") && trees.has(id))
      return json({ sha: id, truncated: false, tree: trees.get(id) });
    if (path.includes("/git/blobs/") && blobs.has(id)) {
      const item = blobs.get(id)!;
      return json({ sha: id, encoding: "base64", content: item.bytes.toString("base64") });
    }
    json({ message: "Not Found" }, 404);
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const core = {
    cwd: root,
    userConfigPath: join(root, "user.jsonc"),
    sourceTransport: (url: string) =>
      url === "https://github.com/acme/skills.git" ? bare : undefined,
    githubApiBaseUrl: `http://127.0.0.1:${(api.address() as AddressInfo).port}`,
  };
  await coreApi.registerSource(core, {
    level: "project",
    id: "github",
    binding: {
      kind: "github",
      origin: "https://github.com/acme/skills.git",
      root: "skills",
      ref: "main",
    },
  });
  await coreApi.installSkills(core, { source: "github", paths: ["chosen"], exactRevision: old });
  await coreApi.installSkills(core, { source: "github", paths: ["other"], exactRevision: current });
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  state.version = 2;
  for (const item of state.installed) delete item.treeIdentity;
  await writeFile(stateFile, JSON.stringify(state) + "\n");
  requests.length = 0;
  return {
    root,
    core,
    old,
    current,
    stateFile,
    requests,
    marker,
    currentResource,
    otherMarker,
    otherResource,
    uninstalledMarker,
    uninstalledResource,
    setOld(outcome: OldOutcome) {
      oldOutcome = outcome;
    },
    setCurrentUnavailable() {
      currentUnavailable = true;
    },
    disappearOnOldMissing() {
      disappearAfterOld = true;
    },
    restoreCurrent() {
      currentUnavailable = false;
    },
    async close() {
      api.closeAllConnections();
      await new Promise<void>((resolve) => api.close(() => resolve()));
      if (previousState === undefined) delete process.env.SKILL_CLI_STATE_DIR;
      else process.env.SKILL_CLI_STATE_DIR = previousState;
      await rm(root, { recursive: true, force: true });
    },
  };
}
test("GitHub unavailable legacy O fails check without content fallback; update can use exact C", async () => {
  for (const changed of [false, true]) {
    const value = await fixture(changed);
    try {
      value.setOld("missing");
      const before = await readFile(value.stateFile);
      await expect(coreApi.checkUpdate(value.core, { source: "github" })).rejects.toMatchObject({
        code: "PINNED_COMMIT_UNAVAILABLE",
      });
      expect(await readFile(value.stateFile)).toEqual(before);
      expect(
        value.requests.some((path) => path.includes("/git/blobs/") || path.includes("/raw/")),
      ).toBe(false);
      expect(value.requests).toContain(`/repos/acme/skills/commits/${value.old}`);
      if (changed) {
        value.requests.length = 0;
        const oldState = JSON.parse(before.toString());
        await coreApi.updateSkills(value.core, {
          source: "github",
          paths: ["chosen"],
          exactRevision: value.current,
        });
        const updated = JSON.parse(await readFile(value.stateFile, "utf8"));
        expect(updated.installed.find((item: { path: string }) => item.path === "other")).toEqual(
          oldState.installed.find((item: { path: string }) => item.path === "other"),
        );
        expect(
          updated.installed.find((item: { path: string }) => item.path === "chosen"),
        ).toMatchObject({ adoptedRevision: value.current, treeIdentity: { objectFormat: "sha1" } });
        const chosen = updated.installed.find((item: { path: string }) => item.path === "chosen");
        expect(
          await readFile(
            join(value.root, "state", "snapshots", chosen.digest, "root", "resource.txt"),
          ),
        ).toEqual(value.currentResource.bytes);
        const updateBlobs = value.requests
          .filter((path) => path.includes("/git/blobs/"))
          .map((path) => path.split("/").at(-1));
        expect(updateBlobs.sort()).toEqual([value.marker.id, value.currentResource.id].sort());
        expect(
          value.requests
            .filter((path) => path.includes("/commits/"))
            .every((path) => path.endsWith(value.current)),
        ).toBe(true);
      }
    } finally {
      await value.close();
    }
  }
});
test("old O 404 is not recovery evidence when fresh exact C repository-access proof fails", async () => {
  const value = await fixture(true);
  try {
    value.setOld("missing");
    value.disappearOnOldMissing();
    const before = await readFile(value.stateFile);
    await expect(coreApi.checkUpdate(value.core, { source: "github" })).rejects.toMatchObject({
      code: "SOURCE_NOT_FOUND",
    });
    expect(value.requests.some((path) => path.includes("/git/blobs/"))).toBe(false);
    expect(
      value.requests.filter((path) => path.endsWith(`/commits/${value.current}`)).length,
    ).toBeGreaterThanOrEqual(2);
    expect(await readFile(value.stateFile)).toEqual(before);
    value.restoreCurrent();
    value.setCurrentUnavailable();
    value.requests.length = 0;
    await expect(
      coreApi.updateSkills(value.core, {
        source: "github",
        paths: ["chosen"],
        exactRevision: value.current,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
    expect(value.requests.some((path) => path.includes("/git/blobs/"))).toBe(false);
    expect(
      value.requests.filter((path) => path.endsWith(`/commits/${value.current}`)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(await readFile(value.stateFile)).toEqual(before);
  } finally {
    await value.close();
  }
});
test("GitHub legacy O auth/socket/body/integrity and current C missing never authorize digest recovery", async () => {
  for (const [outcome, code] of [
    ["auth", "PROVIDER_AUTH_FAILED"],
    ["socket", "PROVIDER_UNAVAILABLE"],
    ["body", "PROVIDER_UNAVAILABLE"],
    ["integrity", "PROVIDER_INTEGRITY_FAILED"],
    ["unprocessable", "PROVIDER_UNAVAILABLE"],
    ["tree-missing", "SOURCE_NOT_FOUND"],
  ] as const) {
    const value = await fixture(true);
    try {
      const before = await readFile(value.stateFile);
      value.setOld(outcome);
      value.requests.length = 0;
      await expect(coreApi.checkUpdate(value.core, { source: "github" })).rejects.toMatchObject({
        code,
      });
      expect(value.requests).toContain(`/repos/acme/skills/commits/${value.old}`);
      expect(
        value.requests.some((path) => path.includes("/git/blobs/") || path.includes("/raw/")),
      ).toBe(false);
      expect(await readFile(value.stateFile)).toEqual(before);
      value.requests.length = 0;
      await expect(
        coreApi.updateSkills(value.core, {
          source: "github",
          paths: ["chosen"],
          exactRevision: value.current,
        }),
      ).resolves.toBeDefined();
      expect(value.requests).not.toContain(`/repos/acme/skills/commits/${value.old}`);
      expect(value.requests.filter((path) => path.includes("/git/blobs/")).length).toBeGreaterThan(
        0,
      );
    } finally {
      await value.close();
    }
  }
  const value = await fixture(true);
  try {
    const before = await readFile(value.stateFile);
    value.setOld("missing");
    value.setCurrentUnavailable();
    value.requests.length = 0;
    await expect(coreApi.checkUpdate(value.core, { source: "github" })).rejects.toMatchObject({
      code: "SOURCE_NOT_FOUND",
    });
    await expect(
      coreApi.updateSkills(value.core, {
        source: "github",
        paths: ["chosen"],
        exactRevision: value.current,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
    expect(value.requests.some((path) => path.includes("/git/blobs/"))).toBe(false);
    expect(value.requests).not.toContain(`/repos/acme/skills/commits/${value.old}`);
    expect(await readFile(value.stateFile)).toEqual(before);
  } finally {
    await value.close();
  }
});
test("I1R1 old O HTTP404 already classified as integrity never enters missing-evidence recovery", async () => {
  const value = await fixture(true);
  try {
    value.setOld("missing-integrity");
    const before = await readFile(value.stateFile);
    await expect(coreApi.checkUpdate(value.core, { source: "github" })).rejects.toMatchObject({
      code: "PROVIDER_INTEGRITY_FAILED",
    });
    expect(value.requests).toContain(`/repos/acme/skills/commits/${value.old}`);
    expect(
      value.requests.filter((path) => path.endsWith(`/commits/${value.current}`)),
    ).toHaveLength(1);
    expect(value.requests.some((path) => path.includes("/git/blobs/"))).toBe(false);
    expect(await readFile(value.stateFile)).toEqual(before);
    value.requests.length = 0;
    await coreApi.updateSkills(value.core, {
      source: "github",
      paths: ["chosen"],
      exactRevision: value.current,
    });
    expect(value.requests).not.toContain(`/repos/acme/skills/commits/${value.old}`);
    expect(value.requests.some((path) => path.includes("/git/blobs/"))).toBe(true);
  } finally {
    await value.close();
  }
});
