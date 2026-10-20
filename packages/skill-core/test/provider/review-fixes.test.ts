import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { discoverSource, withPreparedSkills } from "../../src/source/service";
import { withRepository } from "../../src/source/service/remote/cache";
import type { Repository, RepositoryReader } from "../../src/source/service/remote/types";
import { GitHubTransfer } from "../../src/source/service/remote/github";
import { GitObjects } from "../../src/source/service/remote/objects";
import * as network from "../../src/source/service/remote/network";
import { skillTree, candidateMarkers } from "../../src/source/service/skills";
import { runProcess } from "../../src/runtime/process";
import { createExecutableFixture } from "../executable-fixture";
import { repositoryFixture, serveRepository } from "./repository-fixture";

let root: string, saved: Record<string, string | undefined>, roots: string[];
beforeEach(async () => {
  saved = Object.fromEntries(
    ["PATH", "GITHUB_TOKEN", "GH_TOKEN", "SKCTL_SOURCE_CACHE_DIR"].map((key) => [
      key,
      process.env[key],
    ]),
  );
  root = await mkdtemp(join(tmpdir(), "skctl-review-"));
  roots = [root];
  process.env.SKCTL_SOURCE_CACHE_DIR = join(root, "cache");
});
afterEach(async () => {
  mock.restore();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const path of roots) await rm(path, { recursive: true, force: true });
});
const origin = "https://github.com/acme/skills";
const binding = {
  id: "reviewed",
  kind: "github" as const,
  origin,
  root: "",
  ref: "main",
  selectors: [],
  provenance: { level: "project" as const },
};
async function fixture(files?: Readonly<Record<string, string>>) {
  const value = await repositoryFixture(files);
  roots.push(value.root);
  return value;
}

test("unsafe resource names do not block metadata checks; blob reuse and cancelled cache hits stay correct", async () => {
  const value = await fixture({
    "SKILL.md": "---\nname: reviewed\ndescription: Reviewed\n---\n",
    "notes\\draft.txt": "unsafe resource",
  });
  const api = serveRepository(value),
    controller = new AbortController();
  const request = {
    ...binding,
    githubApiBaseUrl: api.server.url.toString(),
    signal: controller.signal,
  };
  try {
    await withRepository(request, async (reader) => {
      const version = await reader.revision({ commit: value.commit });
      expect(await skillTree(version!, version!.version.tree, "")).toBe(version!.version.tree);
      const marker = (await version!.readTree(version!.version.tree)).find(
        (entry) => entry.path === "SKILL.md",
      )!;
      await version!.blobs([marker.oid]);
      await version!.blobs([marker.oid]);
      expect(api.requests.filter((path) => path.includes("/blobs/"))).toHaveLength(1);
      controller.abort();
      await expect(version!.blobs([marker.oid])).rejects.toHaveProperty("code", "CANCELLED");
    });
    await expect(
      withPreparedSkills(
        { binding, githubApiBaseUrl: api.server.url.toString() },
        [""],
        value.commit,
        async () => {},
      ),
    ).rejects.toHaveProperty("code", "INVALID_RESOURCE_PATH");
  } finally {
    await api.server.stop(true);
  }
});

test("GitHub cancellation during blob acquisition releases the lock, preserves valid metadata and permits a clean retry", async () => {
  const value = await fixture(),
    api = serveRepository(value);
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const fetch = network.sourceFetch;
  const admission = spyOn(network, "sourceFetch").mockImplementation((operation) => {
    const client = fetch(operation);
    return async (input, init) => {
      if (String(input).includes("/blobs/")) {
        ready();
        await new Promise<void>((resolve) =>
          operation.signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        operation.throwIfAborted("fixture blob");
      }
      return client(input, init);
    };
  });
  const controller = new AbortController();
  const context = { binding, githubApiBaseUrl: api.server.url.toString() };
  const pending = discoverSource({ ...context, signal: controller.signal });
  try {
    await started;
    controller.abort();
    await expect(pending).rejects.toHaveProperty("code", "CANCELLED");
    admission.mockRestore();
    expect((await discoverSource(context)).candidates).toHaveLength(1);
    expect(api.requests.filter((path) => path.includes("/trees/"))).toHaveLength(1);
    expect(await readdir(join(root, "cache", "locks"))).toEqual([]);
  } finally {
    controller.abort();
    await pending.catch(() => {});
    await api.server.stop(true);
  }
});

test("warmed tree reads respect cancellation and marker acquisition cannot swallow its deadline", async () => {
  const value = await fixture(),
    api = serveRepository(value, (request) =>
      new URL(request.url).pathname.includes("/blobs/")
        ? new Response(new ReadableStream({ start() {} }))
        : undefined,
    );
  const controller = new AbortController();
  const request = { ...binding, githubApiBaseUrl: api.server.url.toString() };
  try {
    await withRepository({ ...request, signal: controller.signal }, async (reader) => {
      const version = await reader.revision({ commit: value.commit });
      controller.abort();
      await expect(version!.readTree(version!.version.tree)).rejects.toHaveProperty(
        "code",
        "CANCELLED",
      );
    });
    await expect(
      withRepository({ ...request, budgetMs: 80 }, async (reader) => {
        const version = await reader.revision({ commit: value.commit });
        const markers = await candidateMarkers(version!, version!.version.tree);
        await version!.blobs(markers.map((entry) => entry.oid));
      }),
    ).rejects.toHaveProperty("code", "PROVIDER_TIMEOUT");
  } finally {
    await api.server.stop(true);
  }
});

test("discovery ignores OTHER_SKILL.md rather than inventing or shadowing a Root", async () => {
  const value = await fixture({
      "OTHER_SKILL.md": "---\nname: not-a-skill\ndescription: Other\n---\n",
    }),
    api = serveRepository(value);
  try {
    expect(
      (await discoverSource({ binding, githubApiBaseUrl: api.server.url.toString() })).candidates,
    ).toEqual([]);
    expect(api.requests.some((path) => path.includes("/blobs/"))).toBe(false);
  } finally {
    await api.server.stop(true);
  }
});

test.each([false, true])(
  "owned cancellation stops a pipe-closed descendant; failed drain precedence = %s",
  async (failDrain) => {
    const pidFile = join(root, "pid"),
      original = Bun.spawn;
    if (failDrain)
      spyOn(Bun, "spawn").mockImplementation((...args) => {
        const child = Reflect.apply(original, Bun, args);
        return new Proxy(child, {
          get(target, key) {
            if (key === "stdout")
              return new ReadableStream({
                start(controller) {
                  setTimeout(() => controller.error(new Error("fixture pipe read failed")), 40);
                },
              });
            return Reflect.get(target, key, target);
          },
        });
      });
    const controller = new AbortController();
    const pending = runProcess({
      cmd: [
        "/bin/sh",
        "-c",
        `trap 'exit 0' TERM; /bin/sh -c 'trap "" TERM; echo $$ > "${pidFile}"; exec >/dev/null 2>&1; while :; do sleep 1; done' & wait`,
      ],
      signal: controller.signal,
    }).catch((error: unknown) => error);
    try {
      for (let i = 0; i < 100 && !(await Bun.file(pidFile).exists()); i++) await Bun.sleep(10);
      expect(await Bun.file(pidFile).exists()).toBe(true);
      if (failDrain) await Bun.sleep(70);
      controller.abort();
      expect(String(await pending)).toContain(failDrain ? "fixture pipe read failed" : "cancelled");
      const pid = Number(await readFile(pidFile, "utf8")),
        stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
      expect(!stat || /^\d+ \(.*\) Z /u.test(stat)).toBe(true);
    } finally {
      controller.abort();
      await pending;
    }
  },
);

test("enterprise credentials are host-specific; meta separates auth, unavailable capability and integrity", async () => {
  const executable = await createExecutableFixture();
  roots.push(executable);
  await mkdir(join(executable, "bin"));
  const invocation = join(root, "invocation");
  await writeFile(
    join(executable, "bin", "gh"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${invocation}'\nprintf enterprise-token\n`,
    { mode: 0o755 },
  );
  process.env.PATH = `${executable}/bin:${saved.PATH}`;
  process.env.GH_TOKEN = "public-secret";
  process.env.GITHUB_TOKEN = "public-secret";
  for (const [status, body, code] of [
    [401, "not-json", "PROVIDER_AUTH_FAILED"],
    [403, "not-json", "PROVIDER_AUTH_FAILED"],
    [404, "not-json", undefined],
    [503, "not-json", undefined],
    [200, "{}", "PROVIDER_INTEGRITY_FAILED"],
    [200, '{"installed_version":"fixture"}', "success"],
  ] as const) {
    const seen: string[] = [];
    const fetch = spyOn(network, "sourceFetch").mockReturnValue(async (input, init) => {
      expect(String(input)).toBe("https://enterprise.invalid/api/v3/meta");
      seen.push(new Headers(init?.headers).get("authorization") ?? "");
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    });
    const operation = network.createSourceOperation({ source: "enterprise" });
    try {
      const pending = GitHubTransfer.create(
        "https://enterprise.invalid/acme/skills",
        new GitObjects(join(root, "objects.git")),
        operation,
      );
      if (code === "success") expect(await pending).toBeInstanceOf(GitHubTransfer);
      else if (code) await expect(pending).rejects.toHaveProperty("code", code);
      else expect(await pending).toBeUndefined();
      expect(seen).toEqual(["token enterprise-token"]);
    } finally {
      fetch.mockRestore();
    }
  }
  expect(
    (await readFile(invocation, "utf8"))
      .trim()
      .split("\n")
      .every((line) => line === "auth token --hostname enterprise.invalid"),
  ).toBe(true);
  spyOn(Bun, "spawn").mockImplementation(() => {
    throw Object.assign(new Error("credential executable permission denied"), { code: "EACCES" });
  });
  const operation = network.createSourceOperation({ source: "enterprise" });
  await expect(
    GitHubTransfer.create(
      "https://enterprise.invalid/acme/skills",
      new GitObjects(join(root, "objects.git")),
      operation,
    ),
  ).rejects.toMatchObject({
    code: "PROVIDER_UNAVAILABLE",
    message: expect.stringContaining("credentials startup"),
  });
});

test("actual body failures are sanitized and primary/fallback diagnostics do not emit secondary logs", async () => {
  const broken = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json", "content-length": "10000" });
    response.write('{"sha":');
    setTimeout(() => response.destroy(), 30);
  });
  await new Promise<void>((resolve) => broken.listen(0, "127.0.0.1", resolve));
  try {
    await expect(
      withRepository(
        {
          ...binding,
          githubApiBaseUrl: `http://127.0.0.1:${(broken.address() as AddressInfo).port}`,
        },
        async (reader) => reader.revision({ commit: "a".repeat(40) }),
      ),
    ).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      message: expect.stringContaining("body"),
    });
  } finally {
    broken.closeAllConnections();
    await new Promise<void>((resolve) => broken.close(() => resolve()));
  }
  const value = await fixture(),
    api = serveRepository(
      value,
      () =>
        new Response("unavailable", {
          status: 503,
          headers: {
            deprecation: "true",
            link: '<https://secret.invalid/?token=secondary-secret>; rel="deprecation"',
          },
        }),
    );
  const warn = spyOn(console, "warn");
  try {
    const error = await discoverSource({
      binding,
      githubApiBaseUrl: api.server.url.toString(),
      transport: () => "/unavailable",
    }).catch((error: unknown) => error);
    const message = String(error);
    expect(error).toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      message: expect.stringContaining("GitHub"),
    });
    expect(message).toContain("Git");
    expect(message).not.toContain("secondary-secret");
    expect(warn).not.toHaveBeenCalled();
  } finally {
    await api.server.stop(true);
  }
});

test("cancelling an in-flight API failure never admits fallback work", async () => {
  const value = await fixture();
  let ready!: () => void, finish!: () => void;
  const started = new Promise<void>((resolve) => {
      ready = resolve;
    }),
    release = new Promise<void>((resolve) => {
      finish = resolve;
    });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch() {
      ready();
      await release;
      return new Response("unavailable", { status: 503 });
    },
  });
  const controller = new AbortController();
  const pending = discoverSource({
    binding,
    signal: controller.signal,
    githubApiBaseUrl: server.url.toString(),
    transport: () => value.bare,
  });
  try {
    await started;
    controller.abort();
    finish();
    await expect(pending).rejects.toHaveProperty("code", "CANCELLED");
    const key = new Bun.CryptoHasher("sha256").update(origin).digest("hex");
    expect(
      await readdir(join(root, "cache", "origins", key, "objects.git", "objects", "pack")),
    ).toEqual([]);
  } finally {
    controller.abort();
    finish();
    await pending.catch(() => {});
    await server.stop(true);
  }
});

test("cache handles cannot escape their scope and independent callers survive another caller's abort", async () => {
  const value = await fixture(),
    api = serveRepository(value);
  let escaped: Repository | undefined;
  let escapedVersion: RepositoryReader | undefined;
  const request = { ...binding, githubApiBaseUrl: api.server.url.toString() };
  try {
    await withRepository(request, async (reader) => {
      escaped = reader;
      escapedVersion = await reader.revision({ commit: value.commit });
    });
    await expect(escaped!.revision({ commit: value.commit })).rejects.toHaveProperty(
      "code",
      "INTERNAL",
    );
    await expect(escapedVersion!.readTree(value.tree)).rejects.toHaveProperty("code", "INTERNAL");
    const controller = new AbortController();
    const cancelled = withRepository({ ...request, signal: controller.signal }, async (reader) => {
      const version = await reader.revision({ commit: value.commit });
      controller.abort();
      return version!.readTree(version!.version.tree);
    }).catch((error: unknown) => error);
    const independent = withRepository(request, async (reader) => {
      const version = await reader.revision({ commit: value.commit });
      return version!.readTree(version!.version.tree);
    });
    expect(await cancelled).toMatchObject({ code: "CANCELLED" });
    expect(await independent).toHaveLength(1);
  } finally {
    await api.server.stop(true);
  }
});

test("cancelling a real Git metadata/ref child leaves the next caller usable and cached reads cancellable", async () => {
  const value = await fixture(),
    executable = await createExecutableFixture();
  roots.push(executable);
  await mkdir(join(executable, "bin"));
  const ready = join(root, "ready"),
    block = join(root, "block");
  await writeFile(
    join(executable, "bin", "git"),
    `#!/bin/sh\nif [ -f '${block}' ]; then case " $* " in *' fetch '*|*' ls-remote '*) : > '${ready}'; trap '' TERM; while :; do sleep 1; done;; esac; fi\nexec /usr/bin/git "$@"\n`,
    { mode: 0o755 },
  );
  process.env.PATH = `${executable}/bin:${saved.PATH}`;
  const request = { ...binding, kind: "git" as const, transport: () => value.bare };
  for (const target of [{ commit: value.commit }, { current: true }] as const) {
    await writeFile(block, "");
    const controller = new AbortController();
    const pending = withRepository({ ...request, signal: controller.signal }, async (reader) =>
      reader.revision(target),
    );
    try {
      for (let i = 0; i < 100 && !(await Bun.file(ready).exists()); i++) await Bun.sleep(10);
      expect(await Bun.file(ready).exists()).toBe(true);
      controller.abort();
      await expect(pending).rejects.toHaveProperty("code", "CANCELLED");
    } finally {
      controller.abort();
      await pending.catch(() => {});
      await rm(block);
      await rm(ready, { force: true });
    }
  }
  await withRepository(request, async (reader) => {
    const version = await reader.revision({ current: true });
    expect((await version!.readTree(version!.version.tree)).length).toBe(1);
  });
  await expect(
    withRepository({ ...request, signal: AbortSignal.abort() }, async (reader) =>
      reader.revision({ current: true }),
    ),
  ).rejects.toHaveProperty("code", "CANCELLED");
});

test("nested fallback preserves a real pipe-drain failure ahead of cancellation and sanitizes it", async () => {
  const value = await fixture(),
    api = serveRepository(value, () => new Response("unavailable", { status: 503 }));
  const original = Bun.spawn,
    ready = join(root, "ready"),
    controller = new AbortController();
  let failDrain!: () => void;
  spyOn(Bun, "spawn").mockImplementation((...args) => {
    const [command] = args,
      cmd = Array.isArray(command) ? command : command.cmd;
    if (cmd[0] !== "git" || !cmd.includes("fetch")) return Reflect.apply(original, Bun, args);
    const child = original(
      ["/bin/sh", "-c", `: > '${ready}'; trap '' TERM; while :; do sleep 1; done`],
      { stdout: "pipe", stderr: "pipe", detached: true },
    );
    const failed = new ReadableStream<Uint8Array>({
      start(pipe) {
        failDrain = () => pipe.error(new Error("nested pipe drain failed; token=drain-secret"));
      },
    });
    return new Proxy(child, {
      get(target, key) {
        return key === "stdout" ? failed : Reflect.get(target, key, target);
      },
    });
  });
  const pending = withRepository(
    {
      ...binding,
      signal: controller.signal,
      githubApiBaseUrl: api.server.url.toString(),
      transport: () => value.bare,
    },
    async (reader) => reader.revision({ current: true }),
  ).catch((error: unknown) => error);
  try {
    for (let i = 0; i < 100 && !(await Bun.file(ready).exists()); i++) await Bun.sleep(10);
    expect(await Bun.file(ready).exists()).toBe(true);
    expect(failDrain).toBeDefined();
    failDrain();
    controller.abort();
    expect(await pending).toMatchObject({
      code: "CLEANUP_FAILED",
      message: expect.stringContaining("pipe drain failed"),
    });
    expect(String(await pending)).not.toContain("drain-secret");
  } finally {
    controller.abort();
    await pending;
    await api.server.stop(true);
  }
});
