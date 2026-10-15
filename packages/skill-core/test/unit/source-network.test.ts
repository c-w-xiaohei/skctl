import { expect, spyOn, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUserNetwork, capturedWorkspace, readWorkspace } from "../../src/internal/config";
import {
  createSourceOperation,
  sourceFetch,
  sourceChildEnv,
  sourceProxyConfigArgs,
  sourceNetworkError,
} from "../../src/internal/source-network";

test.serial(
  "operation reads only the custom user scope, freezes it, and rejects inaccessible files",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-cli-network-reader-"));
    const file = join(root, "arbitrary-user-name.jsonc");
    const previous = process.env.SKILL_CLI_STATE_DIR;
    try {
      process.env.SKILL_CLI_STATE_DIR = join(root, "state");
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
      if (previous === undefined) delete process.env.SKILL_CLI_STATE_DIR;
      else process.env.SKILL_CLI_STATE_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("one deadline survives phases; cancellation and disposal have different lifetime effects", async () => {
  const operation = createSourceOperation({ source: "team", budgetMs: 25 });
  try {
    const deadline = operation.expiresAt;
    await Bun.sleep(15);
    operation.throwIfAborted("ref");
    await Bun.sleep(20);
    expect(operation.expiresAt).toBe(deadline);
    expect(() => operation.throwIfAborted("tree")).toThrow(
      expect.objectContaining({ code: "PROVIDER_TIMEOUT" }),
    );
  } finally {
    operation.dispose();
  }
  const caller = new AbortController();
  const cancelled = createSourceOperation({ source: "team", signal: caller.signal, budgetMs: 100 });
  caller.abort(new Error("secret caller reason"));
  expect(() => cancelled.throwIfAborted("blob")).toThrow(
    expect.objectContaining({ code: "CANCELLED" }),
  );
  cancelled.dispose();
  const disposed = createSourceOperation({
    source: "team",
    signal: new AbortController().signal,
    budgetMs: 10,
  });
  disposed.dispose();
  await Bun.sleep(20);
  expect(disposed.signal.aborted).toBe(false);
  const oldSignal = new AbortController();
  const mutableInput = { source: "team", signal: oldSignal.signal, budgetMs: 100 };
  const frozen = createSourceOperation(mutableInput);
  mutableInput.signal = new AbortController().signal;
  frozen.dispose();
  oldSignal.abort();
  expect(frozen.signal.aborted).toBe(false);
  const preAborted = new AbortController();
  preAborted.abort();
  const early = createSourceOperation({ source: "team", signal: preAborted.signal });
  try {
    expect(() => early.throwIfAborted("ref")).toThrow(
      expect.objectContaining({ code: "CANCELLED" }),
    );
  } finally {
    early.dispose();
  }
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
  try {
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
  } finally {
    operation.dispose();
  }
  const inherit = createSourceOperation({ source: "team" });
  try {
    expect(sourceChildEnv(inherit, env)).toEqual(env);
    expect(sourceChildEnv(inherit, env)).not.toBe(env);
    expect(sourceProxyConfigArgs(inherit, "https://example.test", [])).toEqual([]);
  } finally {
    inherit.dispose();
  }
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
    try {
      const request = new AbortController();
      request.abort();
      await expect(sourceFetch(live)(server.url, { signal: request.signal })).rejects.toBeDefined();
    } finally {
      live.dispose();
    }
  } finally {
    operation.dispose();
    await server.stop(true);
  }
});

test("Bun fetch closure supplies explicit proxy and Octokit uses that exact fetch", async () => {
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
    operation.dispose();
    await proxy.stop(true);
  }
});

test("fetch uses native request-local bypass suppression only for an explicit proxy", async () => {
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
    explicit.dispose();
    inherited.dispose();
  }
});

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
      explicit.dispose();
      inherited.dispose();
    }
  },
);

test("provider errors retain bounded useful cause text without secrets or raw cause objects", () => {
  const operation = createSourceOperation({
    source: "team",
    proxy: "http://alice:proxy-secret@proxy.test:7890",
  });
  try {
    const cause = new Error(
      "Authorization: Bearer bearer-secret\nProxy-Authorization: Basic basic-secret\npassword=password-secret token=known-secret http://alice:proxy-secret@proxy.test:7890 refused",
      { cause: new Error("cause-token " + "x".repeat(2000)) },
    );
    const error = sourceNetworkError(operation, "exact fetch", cause, "PROVIDER_UNAVAILABLE", [
      "known-secret",
      "cause-token",
    ]);
    const visible = `${error.message} ${JSON.stringify(error)} ${String(error.cause)}`;
    for (const secret of [
      "alice",
      "proxy-secret",
      "bearer-secret",
      "basic-secret",
      "password-secret",
      "known-secret",
      "cause-token",
    ])
      expect(visible).not.toContain(secret);
    expect(error.message).toContain("team");
    expect(error.message).toContain("exact fetch");
    expect(error.message).toContain("configured proxy");
    expect(error.message).toContain("refused");
    expect(error.message.length).toBeLessThanOrEqual(1024);
    expect(error.cause).toBeUndefined();
  } finally {
    operation.dispose();
  }
});

test("sanitization handles JSON-shaped headers and secrets in nested causes", () => {
  const operation = createSourceOperation({ source: "team" });
  try {
    const cause = new Error(
      'HTTP 407 {"authorization":"token json-auth-secret","proxy-authorization":"Basic json-proxy-secret","password":"json-password-secret","token":"json-token-secret"}',
      { cause: new Error("https://user:cause-password@proxy.test refused") },
    );
    const error = sourceNetworkError(operation, "raw", cause);
    const visible = `${String(error)} ${JSON.stringify(error)}`;
    for (const secret of [
      "json-auth-secret",
      "json-proxy-secret",
      "json-password-secret",
      "json-token-secret",
      "cause-password",
    ])
      expect(visible).not.toContain(secret);
    expect(error.message).toContain("407");
    expect(error.message).toContain("refused");
  } finally {
    operation.dispose();
  }
});

test("escaped quoted credentials stay redacted across JSON error and cause output", () => {
  const operation = createSourceOperation({
    source: "team",
    proxy: "http://user:head%22proxy-tail-sentinel@proxy.test:7890",
  });
  try {
    const reason = new Error(
      `HTTP 407 ${JSON.stringify({
        password: 'head"proxy-tail-sentinel',
        detail: "proxy authentication refused",
      })}`,
      {
        cause: new Error(
          `upstream response ${JSON.stringify({
            authorization: 'Token head"auth-tail-sentinel',
            "proxy-authorization": 'Token head"header-tail-sentinel',
            token: 'head\\"token-tail-sentinel',
            passwd: 'head"passwd-tail-sentinel',
            secret: 'head"secret-tail-sentinel',
            api_key: 'head"key-tail-sentinel',
            detail: "credential helper rejected",
          })}`,
        ),
      },
    );
    const error = sourceNetworkError(operation, "credentials", reason);
    for (const output of [error.message, String(error), error.stack!, JSON.stringify(error)])
      for (const suffix of [
        "proxy-tail-sentinel",
        "auth-tail-sentinel",
        "header-tail-sentinel",
        "token-tail-sentinel",
        "passwd-tail-sentinel",
        "secret-tail-sentinel",
        "key-tail-sentinel",
      ])
        expect(output).not.toContain(suffix);
    expect(error.message).toContain("HTTP 407");
    expect(error.message).toContain("proxy authentication refused");
    expect(error.message).toContain("credential helper rejected");
    expect(error.message).toContain("Source team, credentials, configured proxy");
    expect(error.message.length).toBeLessThanOrEqual(1024);
    expect(error.cause).toBeUndefined();
  } finally {
    operation.dispose();
  }
});

test("escaped quoted credentials stay redacted in single-quoted provider reasons", () => {
  const operation = createSourceOperation({ source: "team" });
  try {
    const reason = new Error(
      String.raw`HTTP 401 {'authorization':'Token head\'auth-tail-sentinel','proxy-authorization':'Token head\'proxy-tail-sentinel','password':'head\'password-tail-sentinel','token':'head\\\'token-tail-sentinel','detail':'access refused'}`,
    );
    const error = sourceNetworkError(operation, "raw", reason);
    for (const output of [error.message, String(error), error.stack!, JSON.stringify(error)])
      for (const suffix of [
        "auth-tail-sentinel",
        "proxy-tail-sentinel",
        "password-tail-sentinel",
        "token-tail-sentinel",
      ])
        expect(output).not.toContain(suffix);
    expect(error.message).toContain("HTTP 401");
    expect(error.message).toContain("access refused");
    expect(error.message.length).toBeLessThanOrEqual(1024);
    expect(error.cause).toBeUndefined();
  } finally {
    operation.dispose();
  }
});
