import { expect, spyOn, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUserNetwork, capturedWorkspace, readWorkspace } from "../../src/workspace/capture";
import { GitHubTransfer } from "../../src/source/service/remote/github";
import { GitObjects } from "../../src/source/service/remote/objects";
import * as network from "../../src/source/service/remote/network";
import { runProcess } from "../../src/runtime/process";
import {
  createSourceOperation,
  sourceFetch,
  sourceChildEnv,
  sourceProxyConfigArgs,
} from "../../src/source/service/remote/network";

test.serial(
  "operation reads only the custom user scope, freezes it, and rejects inaccessible files",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "skctl-network-reader-"));
    const file = join(root, "arbitrary-user-name.jsonc");
    const previous = process.env.SKCTL_STATE_DIR;
    try {
      process.env.SKCTL_STATE_DIR = join(root, "state");
      const options = { cwd: root, userConfigPath: file };
      expect(await readUserNetwork(options)).toEqual({});
      await writeFile(file, '{"network":{}}');
      expect(await readUserNetwork(options)).toEqual({});
      await writeFile(file, '{"network":{"proxy":"https://user:secret@proxy.test:8443"}}');
      const network = await readUserNetwork(options);
      expect(Object.isFrozen(network)).toBe(true);
      const workspace = (await readWorkspace(options)).value;
      expect(capturedWorkspace(workspace)?.network).toEqual(network);
      expect(JSON.stringify(workspace)).not.toContain("secret");
      await writeFile(file, '{"network":{"proxy":"http://next.test"}}');
      expect(network.proxy).toBe("https://user:secret@proxy.test:8443");
      expect((await readUserNetwork(options)).proxy).toBe("http://next.test");
      await chmod(file, 0);
      await expect(readUserNetwork(options)).rejects.toMatchObject({ code: "EACCES" });
      await chmod(file, 0o600);
      const blocked = join(root, "blocked");
      await mkdir(blocked);
      await chmod(blocked, 0);
      try {
        await expect(
          readUserNetwork({ ...options, userConfigPath: join(blocked, "missing") }),
        ).rejects.toMatchObject({ code: "EACCES" });
      } finally {
        await chmod(blocked, 0o700);
      }
    } finally {
      await chmod(file, 0o600).catch(() => undefined);
      if (previous === undefined) delete process.env.SKCTL_STATE_DIR;
      else process.env.SKCTL_STATE_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("one deadline survives phases and caller cancellation keeps its reason private", async () => {
  const operation = createSourceOperation({ source: "team", budgetMs: 25 });
  const signal = operation.signal;
  await Bun.sleep(15);
  operation.throwIfAborted("ref");
  await Bun.sleep(20);
  expect(operation.signal).toBe(signal);
  expect(() => operation.throwIfAborted("tree")).toThrow(
    expect.objectContaining({ code: "PROVIDER_TIMEOUT" }),
  );
  const caller = new AbortController();
  const cancelled = createSourceOperation({ source: "team", signal: caller.signal, budgetMs: 100 });
  caller.abort(new Error("secret caller reason"));
  expect(() => cancelled.throwIfAborted("blob")).toThrow(
    expect.objectContaining({ code: "CANCELLED" }),
  );
  const oldSignal = new AbortController();
  const mutableInput = { source: "team", signal: oldSignal.signal, budgetMs: 100 };
  const frozen = createSourceOperation(mutableInput);
  mutableInput.signal = new AbortController().signal;
  oldSignal.abort();
  expect(frozen.signal.aborted).toBe(true);
  const preAborted = new AbortController();
  preAborted.abort();
  const early = createSourceOperation({ source: "team", signal: preAborted.signal });
  expect(() => early.throwIfAborted("ref")).toThrow(expect.objectContaining({ code: "CANCELLED" }));
});

test("the first abort remains authoritative when caller cancellation and deadline both occur", async () => {
  const caller = new AbortController();
  const timedOut = createSourceOperation({ source: "team", signal: caller.signal, budgetMs: 10 });
  await Bun.sleep(20);
  caller.abort(new Error("private cancellation reason"));
  expect(() => timedOut.throwIfAborted("tree")).toThrow(
    expect.objectContaining({ code: "PROVIDER_TIMEOUT" }),
  );
  const early = new AbortController();
  const cancelled = createSourceOperation({ source: "team", signal: early.signal, budgetMs: 10 });
  early.abort();
  await Bun.sleep(20);
  expect(() => cancelled.throwIfAborted("tree")).toThrow(
    expect.objectContaining({ code: "CANCELLED" }),
  );
});

test("deadline remains live during owned process I/O and garbage collection", async () => {
  const operation = createSourceOperation({ source: "team", budgetMs: 50 });
  const started = performance.now();
  const pending = runProcess({ cmd: ["/bin/sh", "-c", "sleep 2"], signal: operation.signal });
  Bun.gc(true);
  await expect(pending).rejects.toHaveProperty("code", "CANCELLED");
  expect(performance.now() - started).toBeLessThan(1_000);
  expect(() => operation.throwIfAborted("Git")).toThrow(
    expect.objectContaining({ code: "PROVIDER_TIMEOUT" }),
  );
});

test("copied child environment and later invocation config isolate explicit proxy policy", () => {
  const env = {
    HTTP_PROXY: "http://hostile.test",
    NO_PROXY: "*",
    no_proxy: "*",
    KEEP: "auth",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "helper",
  };
  const operation = createSourceOperation({
    source: "team",
    proxy: "https://user:secret@proxy.test:8443",
  });
  const child = sourceChildEnv(operation, env);
  for (const key of [
    "HTTP_PROXY",
    "http_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
  ])
    expect(child[key]).toBe(operation.proxy);
  expect(child.NO_PROXY).toBe("");
  expect(child.no_proxy).toBe("");
  expect(child.KEEP).toBe("auth");
  expect(child.GIT_CONFIG_VALUE_0).toBe("helper");
  expect(env.HTTP_PROXY).toBe("http://hostile.test");
  expect(env.NO_PROXY).toBe("*");
  expect(
    sourceProxyConfigArgs(operation, "https://example.test/repo.git", [
      "http.https://example.test.proxy",
      "remote.origin.proxy",
      "credential.helper",
    ]),
  ).toEqual([
    "-c",
    `http.proxy=${operation.proxy}`,
    "-c",
    `http.https://example.test.proxy=${operation.proxy}`,
    "-c",
    `remote.origin.proxy=${operation.proxy}`,
    "-c",
    `http.https://example.test/repo.git.proxy=${operation.proxy}`,
  ]);
  const inherit = createSourceOperation({ source: "team" });
  expect(sourceChildEnv(inherit, env)).toEqual(env);
  expect(sourceChildEnv(inherit, env)).not.toBe(env);
  expect(sourceProxyConfigArgs(inherit, "https://example.test", [])).toEqual([]);
});

test("fetch shares operation and request cancellation through body consumption", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("start"));
          },
        }),
      ),
  });
  const operation = createSourceOperation({ source: "team", budgetMs: 50 });
  try {
    const response = await sourceFetch(operation)(server.url);
    await expect(response.text()).rejects.toBeDefined();
    expect(() => operation.throwIfAborted("raw")).toThrow(
      expect.objectContaining({ code: "PROVIDER_TIMEOUT" }),
    );
    const live = createSourceOperation({ source: "team" });
    const request = new AbortController();
    request.abort();
    await expect(sourceFetch(live)(server.url, { signal: request.signal })).rejects.toBeDefined();
  } finally {
    await server.stop(true);
  }
});

test.skipIf(!Bun.semver.satisfies(Bun.version, ">=1.4.3"))(
  "Bun fetch closure supplies explicit proxy and Octokit uses that exact fetch",
  async () => {
    const { Octokit } = await import("@octokit/rest");
    const requests: string[] = [];
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests.push(request.url);
        return Response.json({ ok: true });
      },
    });
    const operation = createSourceOperation({
      source: "team",
      proxy: proxy.url.href,
      budgetMs: 2000,
    });
    try {
      const customFetch = sourceFetch(operation);
      // .invalid cannot be directly reached in network-none; success is the proxy route.
      expect(await (await customFetch("http://target.invalid/raw")).json()).toEqual({ ok: true });
      const octokit = new Octokit({
        baseUrl: "http://target.invalid",
        request: { fetch: customFetch, signal: operation.signal },
      });
      expect((await octokit.request("GET /meta")).data).toHaveProperty("ok", true);
      expect(requests).toEqual(["http://target.invalid/raw", "http://target.invalid/meta"]);
    } finally {
      await proxy.stop(true);
    }
  },
);

test.skipIf(!Bun.semver.satisfies(Bun.version, ">=1.4.3"))(
  "fetch uses native request-local bypass suppression only for an explicit proxy",
  async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    const explicit = createSourceOperation({ source: "team", proxy: "http://proxy.test:7890" });
    const inherited = createSourceOperation({ source: "team" });
    try {
      await sourceFetch(explicit)("http://target.invalid");
      expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
        proxy: { url: explicit.proxy, respectNoProxy: false },
      });
      await sourceFetch(inherited)("http://target.invalid");
      expect(Object.hasOwn(fetchSpy.mock.calls[1]?.[1] ?? {}, "proxy")).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  },
);

test.skipIf(Bun.semver.satisfies(Bun.version, ">=1.4.3"))(
  "unsupported runtime rejects explicit proxy before fetch I/O but preserves inheritance",
  async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    const explicit = createSourceOperation({
      source: "team",
      proxy: "http://user:secret@proxy.test:7890",
    });
    const inherited = createSourceOperation({ source: "team" });
    try {
      expect(() => sourceFetch(explicit)("http://target.invalid")).toThrow(
        expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }),
      );
      expect(() => sourceFetch(explicit)("http://target.invalid")).toThrow(/Bun 1\.4\.3 or newer/);
      expect(fetchSpy).not.toHaveBeenCalled();
      await sourceFetch(inherited)("http://target.invalid");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(Object.hasOwn(fetchSpy.mock.calls[0]?.[1] ?? {}, "proxy")).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  },
);

test.each([
  "HTTP 401 Authorization: Bearer bearer-secret\nProxy-Authorization: Basic basic-secret\npassword=password-secret token=known-secret",
  'HTTP 401 {"authorization":"token json-auth-secret","proxy-authorization":"Basic json-proxy-secret","password":"json-password-secret","token":"json-token-secret"}',
  `HTTP 401 ${JSON.stringify({ password: 'head"proxy-secret', authorization: 'Token head"auth-secret', token: 'head\\"token-secret', passwd: 'head"passwd-secret', api_key: 'head"key-secret' })}`,
  String.raw`HTTP 401 {'authorization':'Token head\'auth-secret','proxy-authorization':'Token head\'proxy-secret','password':'head\'password-secret','token':'head\\\'token-secret'}`,
])("provider response bodies never enter diagnostics (%#)", async (body) => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(body, { status: 401 }),
  });
  try {
    const transfer = await GitHubTransfer.create(
      "https://github.com/acme/skills",
      new GitObjects("/unused"),
      createSourceOperation({ source: "team" }),
      server.url.toString(),
    );
    const error = await transfer!.metadata("a".repeat(40)).catch((error: unknown) => error);
    expect(error).toHaveProperty("code", "PROVIDER_AUTH_FAILED");
    for (const visible of [String(error), JSON.stringify(error), (error as Error).stack!])
      expect(visible).not.toContain("secret");
    expect((error as Error).message).toContain("HTTP 401");
    expect((error as Error).message.length).toBeLessThanOrEqual(1024);
    expect((error as Error).cause).toBeUndefined();
  } finally {
    await server.stop(true);
  }
});

test("provider transport causes and credential URLs never enter diagnostics", async () => {
  const failure = spyOn(network, "sourceFetch").mockReturnValue(async () => {
    throw new Error("Authorization: Bearer top-secret", {
      cause: new Error("https://alice:password-secret@proxy.test:7890 " + "x".repeat(2000)),
    });
  });
  try {
    const transfer = await GitHubTransfer.create(
      "https://github.com/acme/skills",
      new GitObjects("/unused"),
      createSourceOperation({
        source: "team",
        proxy: "https://alice:password-secret@proxy.test:7890",
      }),
      "http://fixture.invalid",
    );
    const error = await transfer!.metadata("a".repeat(40)).catch((error: unknown) => error);
    const visible = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack}`;
    expect(error).toHaveProperty("code", "PROVIDER_UNAVAILABLE");
    expect(visible).not.toMatch(/secret|alice|xxxxxxxx/);
    expect(visible).toContain("configured proxy https://proxy.test:7890");
    expect((error as Error).cause).toBeUndefined();
  } finally {
    failure.mockRestore();
  }
});
