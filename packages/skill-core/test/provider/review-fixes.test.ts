import { expect, test, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { openGitHubSource, resolveGitHubApi } from "../../src/internal/source-github";
import { runProviderChild, openGitSource, resolveGitRef } from "../../src/internal/source-git";
import { networkFixture } from "./network-fixture";
import { discoverSnapshotSkills } from "../../src/internal/sources";
import { createSourceOperation } from "../../src/internal/source-network";
import { createExecutableFixture } from "../executable-fixture";

const commit = "a".repeat(40),
  treeId = "b".repeat(40);
const bytes = Buffer.from("---\nname: reviewed\ndescription: Reviewed\n---\n");
const blobId = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const provenance = {
  source: "reviewed",
  origin: "git" as const,
  declaration: { level: "project" as const },
  stability: "immutable" as const,
};
const marker = { path: "SKILL.md", sha: blobId, mode: "100644", type: "blob", size: bytes.length };
const blob = { sha: blobId, encoding: "base64", content: bytes.toString("base64") };
const open = (baseUrl: string, operation?: ReturnType<typeof createSourceOperation>) =>
  openGitHubSource(
    "reviewed",
    "https://github.com/acme/skills",
    commit,
    "",
    provenance,
    undefined,
    { baseUrl },
    "/not-an-available-fallback",
    operation,
  );

test("unsafe resource names do not block tree checks; blob success is memoized and cancelled cache hits reject", async () => {
  let blobs = 0;
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.includes("/commits/"))
        return Response.json({ sha: commit, commit: { tree: { sha: treeId } } });
      if (path.includes("/trees/"))
        return Response.json({
          sha: treeId,
          tree: [marker, { ...marker, path: "notes\\draft.txt" }],
        });
      blobs++;
      return Response.json(blob);
    },
  });
  const operation = createSourceOperation({ source: "reviewed" });
  const snapshot = await open(server.url.toString(), operation);
  try {
    expect((await snapshot.inspectRoots([""]))[0]?.status).toBe("present");
    await snapshot.read("SKILL.md");
    await snapshot.read("SKILL.md");
    expect(blobs).toBe(1);
    const cancelled = AbortSignal.abort();
    await expect(snapshot.read("SKILL.md", cancelled)).rejects.toMatchObject({ code: "CANCELLED" });
    operation.dispose();
  } finally {
    await snapshot.close();
    operation.dispose();
    server.stop(true);
  }
});

test("GitHub method abort stops in-flight work without poisoning memo and close drains admitted reads", async () => {
  let blobRequests = 0,
    ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.includes("/commits/"))
        return Response.json({ sha: commit, commit: { tree: { sha: treeId } } });
      if (path.includes("/trees/")) return Response.json({ sha: treeId, tree: [marker] });
      blobRequests++;
      ready();
      await Bun.sleep(180);
      return Response.json(blob);
    },
  });
  const snapshot = await open(server.url.toString());
  try {
    const controller = new AbortController();
    const pending = snapshot.read("SKILL.md", controller.signal);
    await started;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    const retry = snapshot.read("SKILL.md");
    let closed = false;
    const close = snapshot.close().then(() => {
      closed = true;
    });
    const closeAgain = snapshot.close();
    await Bun.sleep(20);
    expect(closed).toBe(false);
    expect((await retry).bytes).toEqual(bytes);
    await Promise.all([close, closeAgain]);
    expect(blobRequests).toBe(2);
    await expect(snapshot.read("SKILL.md")).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  } finally {
    await snapshot.close();
    server.stop(true);
  }
});

test("warmed GitHub list respects shared cancellation and discovery never swallows blob deadline", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.includes("/commits/"))
        return Response.json({ sha: commit, commit: { tree: { sha: treeId } } });
      if (path.includes("/trees/")) return Response.json({ sha: treeId, tree: [marker] });
      return new Promise<Response>(() => {});
    },
  });
  const caller = new AbortController(),
    operation = createSourceOperation({ source: "reviewed", signal: caller.signal });
  const cached = await open(server.url.toString(), operation);
  try {
    await Array.fromAsync(cached.list(""));
    caller.abort();
    await expect(Array.fromAsync(cached.list(""))).rejects.toMatchObject({ code: "CANCELLED" });
  } finally {
    await cached.close();
    operation.dispose();
  }
  const short = createSourceOperation({ source: "reviewed", budgetMs: 80 });
  const snapshot = await open(server.url.toString(), short);
  try {
    await expect(discoverSnapshotSkills(snapshot)).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });
  } finally {
    await snapshot.close();
    short.dispose();
    server.stop(true);
  }
});

test("discovery ignores OTHER_SKILL.md rather than inventing/shadowing a Root", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.includes("/commits/"))
        return Response.json({ sha: commit, commit: { tree: { sha: treeId } } });
      if (path.includes("/trees/"))
        return Response.json({ sha: treeId, tree: [{ ...marker, path: "OTHER_SKILL.md" }] });
      return Response.json(blob);
    },
  });
  const snapshot = await open(server.url.toString());
  try {
    expect((await discoverSnapshotSkills(snapshot)).skills).toEqual([]);
  } finally {
    await snapshot.close();
    server.stop(true);
  }
});

test("owned cancellation kills a pipe-closed descendant and a failed drain keeps cleanup active", async () => {
  const root = await mkdtemp(join(tmpdir(), "review-child-"));
  try {
    for (const failDrain of [false, true]) {
      const pidFile = join(root, `pid-${failDrain}`);
      const original = Bun.spawn;
      const injection = failDrain
        ? spyOn(Bun, "spawn").mockImplementation((...args) => {
            const [command] = args;
            const child = Array.isArray(command)
              ? original({ cmd: command, stdout: "pipe", stderr: "pipe", detached: true })
              : original(command);
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
          })
        : undefined;
      const controller = new AbortController();
      const pending = runProviderChild(
        {
          cmd: [
            "/bin/sh",
            "-c",
            `trap 'exit 0' TERM; /bin/sh -c 'trap "" TERM; echo $$ > "${pidFile}"; exec >/dev/null 2>&1; while :; do sleep 1; done' & wait`,
          ],
          stdout: "pipe",
          stderr: "pipe",
        },
        controller.signal,
      );
      const outcome = pending.catch((error) => error);
      try {
        for (let i = 0; i < 100 && !(await Bun.file(pidFile).exists()); i++) await Bun.sleep(10);
        expect(await Bun.file(pidFile).exists()).toBe(true);
        if (failDrain) await Bun.sleep(70);
        controller.abort();
        const error = await outcome;
        expect(String(error)).toContain(failDrain ? "fixture pipe read failed" : "cancelled");
        const pid = Number(await readFile(pidFile, "utf8"));
        const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
        expect(!stat || /^\d+ \(.*\) Z /u.test(stat)).toBe(true);
      } finally {
        controller.abort();
        await outcome;
        injection?.mockRestore();
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("enterprise credentials remain host-specific; meta auth and body failures are authoritative", async () => {
  const root = await createExecutableFixture();
  const previousPath = process.env.PATH,
    previousToken = process.env.GH_TOKEN;
  try {
    await mkdir(join(root, "bin"));
    await writeFile(join(root, "bin", "gh"), "#!/bin/sh\nprintf host-specific-token\n", {
      mode: 0o755,
    });
    process.env.PATH = `${root}/bin:${previousPath}`;
    process.env.GH_TOKEN = "public-secret";
    const seen: string[] = [];
    // Runtime-boundary fetch injection retains the actual provider/meta classification.
    const actualFetch = globalThis.fetch;
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          seen.push(new Headers(init?.headers).get("authorization") ?? "");
          return new Response("not-json", { status: 401 });
        },
        { preconnect: actualFetch.preconnect },
      ),
    );
    try {
      await expect(
        resolveGitHubApi("https://enterprise.invalid/acme/skills"),
      ).rejects.toMatchObject({
        code: "PROVIDER_AUTH_FAILED",
        message: expect.stringContaining("GitHub meta"),
      });
      expect(seen).toEqual(["Bearer host-specific-token"]);
    } finally {
      fetchMock.mockRestore();
    }
  } finally {
    process.env.PATH = previousPath;
    if (previousToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previousToken;
    await rm(root, { recursive: true, force: true });
  }
});

test("provider errors retain actual API body failure and bounded primary/fallback phases without secondary logs", async () => {
  const broken = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json", "content-length": "10000" });
    response.write('{"sha":');
    setTimeout(() => response.destroy(), 30);
  });
  await new Promise<void>((resolve) => broken.listen(0, "127.0.0.1", resolve));
  const snapshot = await open(`http://127.0.0.1:${(broken.address() as AddressInfo).port}`);
  try {
    await expect(snapshot.inspectRoots([""])).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      message: expect.stringContaining("body"),
    });
  } finally {
    await snapshot.close();
    broken.closeAllConnections();
    await new Promise<void>((resolve) => broken.close(() => resolve()));
  }
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json(
        { message: "unavailable" },
        {
          status: 503,
          headers: {
            deprecation: "true",
            sunset: "tomorrow",
            link: '<https://secret.invalid/?token=secondary-secret>; rel="deprecation"',
          },
        },
      ),
  });
  const warnings: unknown[][] = [];
  const warn = spyOn(console, "warn").mockImplementation((...args) => {
    warnings.push(args);
  });
  const fallback = await open(server.url.toString());
  try {
    const error = await fallback.inspectRoots([""]).catch((error) => error);
    expect(error.message).toContain("GitHub commit");
    expect(error.message).toContain("Git fetch");
    expect(warnings).toEqual([]);
  } finally {
    await fallback.close();
    warn.mockRestore();
    server.stop(true);
  }
});

test("Git method signals cancel tree preparation/ref and cached reads without poisoning the next caller", async () => {
  const fixture = await networkFixture(),
    shim = await createExecutableFixture(),
    previous = process.env.PATH;
  const ready = join(shim, "ready"),
    block = join(shim, "block");
  const operation = createSourceOperation({ source: "reviewed" });
  let snapshot: Awaited<ReturnType<typeof openGitSource>> | undefined;
  try {
    snapshot = await openGitSource(
      "reviewed",
      join(fixture.root, "remote.git"),
      fixture.commit,
      "",
      provenance,
      undefined,
      operation,
    );
    await mkdir(join(shim, "bin"));
    await writeFile(
      join(shim, "bin", "git"),
      `#!/bin/sh
if [ -f '${block}' ]; then
  case " $* " in *' ls-tree '*|*' ls-remote '*) : > '${ready}'; trap '' TERM; while :; do sleep 1; done;; esac
fi
exec /usr/bin/git "$@"
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${shim}/bin:${previous}`;
    await writeFile(block, "");
    const controller = new AbortController();
    await snapshot.close();
    snapshot = undefined;
    const pending = openGitSource(
      "reviewed",
      join(fixture.root, "remote.git"),
      fixture.commit,
      "",
      provenance,
      controller.signal,
      operation,
    );
    const outcome = pending.catch((error) => error);
    for (let i = 0; i < 100 && !(await Bun.file(ready).exists()); i++) await Bun.sleep(10);
    expect(await Bun.file(ready).exists()).toBe(true);
    controller.abort();
    expect(await outcome).toMatchObject({ code: "CANCELLED" });
    await rm(block);
    await rm(ready);
    snapshot = await openGitSource(
      "reviewed",
      join(fixture.root, "remote.git"),
      fixture.commit,
      "",
      provenance,
      undefined,
      operation,
    );
    expect((await snapshot.inspectRoots([""]))[0]?.status).toBe("present");
    await snapshot.read("SKILL.md");
    await expect(snapshot.read("SKILL.md", AbortSignal.abort())).rejects.toMatchObject({
      code: "CANCELLED",
    });
    await writeFile(block, "");
    const refController = new AbortController();
    const ref = resolveGitRef(
      join(fixture.root, "remote.git"),
      "main",
      refController.signal,
      undefined,
      operation,
    ).catch((error) => error);
    for (let i = 0; i < 100 && !(await Bun.file(ready).exists()); i++) await Bun.sleep(10);
    refController.abort();
    expect(await ref).toMatchObject({ code: "CANCELLED" });
  } finally {
    await snapshot?.close();
    operation.dispose();
    process.env.PATH = previous;
    await fixture.close();
    await rm(shim, { recursive: true, force: true });
  }
});

test("close never admits a new fallback after an in-flight API failure", async () => {
  let ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  const fixture = await networkFixture();
  const server = Bun.serve({
    port: 0,
    async fetch() {
      ready();
      await Bun.sleep(100);
      return Response.json({ message: "unavailable" }, { status: 503 });
    },
  });
  const snapshot = await openGitHubSource(
    "reviewed",
    "https://github.com/acme/skills",
    fixture.commit,
    "",
    provenance,
    undefined,
    { baseUrl: server.url.toString() },
    fixture.targetUrl,
  );
  try {
    const result = snapshot.inspectRoots([""]).catch((error) => error);
    await started;
    const closed = snapshot.close();
    const again = snapshot.close();
    expect(await result).toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      message: expect.stringContaining("closing"),
    });
    await Promise.all([closed, again]);
    expect(fixture.direct).toBe(0);
    expect(fixture.transfers).toEqual([]);
  } finally {
    await snapshot.close();
    server.stop(true);
    await fixture.close();
  }
});

test("enterprise meta distinguishes auth/capability/integrity and abnormal credential startup", async () => {
  const root = await createExecutableFixture(),
    previous = process.env.PATH;
  try {
    await mkdir(join(root, "bin"));
    const gh = join(root, "bin", "gh");
    await writeFile(gh, "#!/bin/sh\nprintf enterprise-token\n", { mode: 0o755 });
    process.env.PATH = `${root}/bin:${previous}`;
    const actualFetch = fetch;
    for (const [status, body, code] of [
      [403, "not-json", "PROVIDER_AUTH_FAILED"],
      [404, "not-json", undefined],
      [503, "not-json", undefined],
      [200, "{}", "PROVIDER_INTEGRITY_FAILED"],
      [200, '{"installed_version":"fixture"}', "success"],
    ] as const) {
      const injection = spyOn(globalThis, "fetch").mockImplementation(
        Object.assign(async () => new Response(body, { status }), {
          preconnect: actualFetch.preconnect,
        }),
      );
      try {
        const pending = resolveGitHubApi("https://enterprise.invalid/acme/skills");
        if (code === "success") expect(await pending).toMatchObject({ token: "enterprise-token" });
        else if (code) await expect(pending).rejects.toMatchObject({ code });
        else expect(await pending).toBeUndefined();
      } finally {
        injection.mockRestore();
      }
    }
    const spawn = spyOn(Bun, "spawn").mockImplementation(() => {
      throw Object.assign(new Error("credential executable permission denied"), { code: "EACCES" });
    });
    try {
      const error = await resolveGitHubApi("https://enterprise.invalid/acme/skills").catch(
        (error) => error,
      );
      expect(error).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
      expect(error.message).toContain("credentials startup");
    } finally {
      spawn.mockRestore();
    }
  } finally {
    process.env.PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("method signal aborts actual raw body and cached inspect does not bypass shared deadline", async () => {
  let ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  const raw = createServer((_request, response) => {
    response.writeHead(200, { "content-length": String(bytes.length) });
    response.write(bytes.subarray(0, 1));
    ready();
  });
  await new Promise<void>((resolve) => raw.listen(0, "127.0.0.1", resolve));
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.includes("/commits/"))
        return Response.json({ sha: commit, commit: { tree: { sha: treeId } } });
      if (path.includes("/trees/")) return Response.json({ sha: treeId, tree: [marker] });
      return Response.json({ message: "unavailable" }, { status: 503 });
    },
  });
  const snapshot = await openGitHubSource(
    "reviewed",
    "https://github.com/acme/skills",
    commit,
    "",
    provenance,
    undefined,
    {
      baseUrl: server.url.toString(),
      rawBaseUrl: `http://127.0.0.1:${(raw.address() as AddressInfo).port}`,
    },
  );
  try {
    const caller = new AbortController();
    const pending = snapshot.read("SKILL.md", caller.signal);
    await started;
    caller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  } finally {
    await snapshot.close();
    raw.closeAllConnections();
    await new Promise<void>((resolve) => raw.close(() => resolve()));
    server.stop(true);
  }
  const api = Bun.serve({
    port: 0,
    fetch(request) {
      return new URL(request.url).pathname.includes("/commits/")
        ? Response.json({ sha: commit, commit: { tree: { sha: treeId } } })
        : Response.json({ sha: treeId, tree: [marker] });
    },
  });
  const operation = createSourceOperation({ source: "reviewed", budgetMs: 80 }),
    cached = await open(api.url.toString(), operation);
  try {
    await cached.inspectRoots([""]);
    await Bun.sleep(100);
    await expect(cached.inspectRoots([""])).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  } finally {
    await cached.close();
    operation.dispose();
    api.stop(true);
  }
});

test("R1 paused list emission ignores another admitted method abort during fallback cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "review-list-isolation-"));
  const ready = join(root, "ready");
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.includes("/commits/"))
        return Response.json({ sha: commit, commit: { tree: { sha: treeId } } });
      if (path.includes("/trees/"))
        return Response.json({ sha: treeId, tree: [marker, { ...marker, path: "copy.md" }] });
      return Response.json({ message: "unavailable" }, { status: 503 });
    },
  });
  const original = Bun.spawn;
  let fallbackChild: ReturnType<typeof Bun.spawn> | undefined;
  const injection = spyOn(Bun, "spawn").mockImplementation((...args) => {
    const [command] = args;
    const cmd = Array.isArray(command) ? command : command.cmd;
    if (cmd[0] === "git" && cmd.includes("fetch")) {
      const child = original({
        cmd: ["/bin/sh", "-c", `: > '${ready}'; trap '' TERM; while :; do sleep 1; done`],
        stdout: "pipe",
        stderr: "pipe",
        detached: true,
      });
      fallbackChild = child;
      return child;
    }
    return Array.isArray(command)
      ? original({ cmd: command, stdout: "pipe", stderr: "pipe", detached: true })
      : original(command);
  });
  const snapshot = await open(server.url.toString());
  const caller = new AbortController();
  let pending: Promise<unknown> | undefined;
  try {
    const iterator = snapshot.list("")[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    pending = snapshot.read("SKILL.md", caller.signal).catch((error) => error);
    for (let i = 0; i < 100 && !(await Bun.file(ready).exists()); i++) await Bun.sleep(10);
    expect(await Bun.file(ready).exists()).toBe(true);
    let settled = false;
    pending.then(() => {
      settled = true;
    });
    caller.abort();
    // The other admission still owns its signal until real TERM/KILL cleanup finishes.
    expect(settled).toBe(false);
    const second = await iterator.next();
    expect(second.done).toBe(false);
    expect(second.value?.path).toBe("copy.md");
    expect((await iterator.next()).done).toBe(true);
    expect(await pending).toMatchObject({ code: "CANCELLED" });
    expect(await fallbackChild?.exited).not.toBeUndefined();
  } finally {
    caller.abort();
    await pending;
    await snapshot.close();
    injection.mockRestore();
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

test("R2 nested fallback retains real pipe-drain failure ahead of method/shared abort", async () => {
  for (const shared of [false, true]) {
    const root = await mkdtemp(join(tmpdir(), "review-nested-drain-"));
    const ready = join(root, "ready");
    const caller = new AbortController();
    const operation = createSourceOperation({
      source: "reviewed",
      ...(shared ? { signal: caller.signal } : {}),
    });
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ message: "unavailable" }, { status: 503 }),
    });
    const original = Bun.spawn;
    let failDrain: (() => void) | undefined;
    let fallbackChild: ReturnType<typeof Bun.spawn> | undefined;
    const injection = spyOn(Bun, "spawn").mockImplementation((...args) => {
      const [command] = args;
      const cmd = Array.isArray(command) ? command : command.cmd;
      if (cmd[0] === "git" && cmd.includes("fetch")) {
        const child = original({
          cmd: ["/bin/sh", "-c", `: > '${ready}'; trap '' TERM; while :; do sleep 1; done`],
          stdout: "pipe",
          stderr: "pipe",
          detached: true,
        });
        fallbackChild = child;
        const failedPipe = new ReadableStream<Uint8Array>({
          start(controller) {
            failDrain = () =>
              controller.error(new Error("nested fixture pipe read failed; token=drain-secret"));
          },
        });
        return new Proxy(child, {
          get(target, key) {
            return key === "stdout" ? failedPipe : Reflect.get(target, key, target);
          },
        });
      }
      return Array.isArray(command)
        ? original({ cmd: command, stdout: "pipe", stderr: "pipe", detached: true })
        : original(command);
    });
    const snapshot = await open(server.url.toString(), operation);
    const pending = snapshot
      .inspectRoots([""], shared ? undefined : caller.signal)
      .catch((error) => error);
    try {
      for (let i = 0; i < 100 && !(await Bun.file(ready).exists()); i++) await Bun.sleep(10);
      expect(await Bun.file(ready).exists()).toBe(true);
      expect(failDrain).toBeDefined();
      failDrain!();
      caller.abort();
      const error = await pending;
      expect(error).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
      expect(error.message).toContain("pipe drain failed");
      expect(error.message).toContain("GitHub commit");
      expect(error.message).toContain("fallback");
      expect(error.message).not.toContain("drain-secret");
      expect(await fallbackChild?.exited).not.toBeUndefined();
      await Promise.all([snapshot.close(), snapshot.close()]);
    } finally {
      caller.abort();
      await pending;
      await snapshot.close();
      operation.dispose();
      injection.mockRestore();
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  }
});
