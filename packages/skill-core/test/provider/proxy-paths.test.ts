import { expect, test as bunTest } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect, type AddressInfo } from "node:net";
import { join } from "node:path";
import { createExecutableFixture } from "../executable-fixture";
import { networkFixture, tlsFixture } from "./network-fixture";

const test = bunTest.serial;
const commit = "a".repeat(40),
  tree = "b".repeat(40);
const bytes = Buffer.from("---\nname: proxy\ndescription: Proxy\n---\n");
const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const marker = { path: "SKILL.md", mode: "100644", type: "blob", sha: blob, size: bytes.length };
const imports = `
import { openGitHubSource, resolveGitHubApi } from ${JSON.stringify(join(import.meta.dir, "../../src/internal/source-github.ts"))};
import { createSourceOperation } from ${JSON.stringify(join(import.meta.dir, "../../src/internal/source-network.ts"))};
import { expect } from 'bun:test';
expect(Bun.version).toBe('1.4.3');
const before = {...process.env};
const commit = process.env.COMMIT ?? '${commit}';
const provenance = {source:'proxy-paths', origin:'git', declaration:{level:'project'}, stability:'immutable', revision:commit};
const operation = createSourceOperation({source:'proxy-paths', proxy:process.env.PROXY, budgetMs:Number(process.env.BUDGET ?? 5000)});
let snapshot;
try {
`;

// Hostile inheritance exists only in a fresh child; neither process rewrites its environment.
async function client(body: string, env: Record<string, string | undefined>) {
  const root = await createExecutableFixture();
  try {
    const script = join(root, "client.ts");
    await writeFile(
      script,
      imports +
        body +
        `
} finally { await snapshot?.close(); operation.dispose(); }
expect(process.env).toEqual(before);
console.log('provider-paths-ok');
`,
    );
    const before = { ...process.env };
    const child = Bun.spawn([process.execPath, script], {
      env: {
        ...process.env,
        HTTP_PROXY: "http://127.0.0.1:1",
        http_proxy: "http://127.0.0.1:2",
        HTTPS_PROXY: "http://127.0.0.1:3",
        https_proxy: "http://127.0.0.1:4",
        ALL_PROXY: "http://127.0.0.1:5",
        all_proxy: "http://127.0.0.1:6",
        NO_PROXY: "*",
        no_proxy: "*",
        GH_TOKEN: "public-gh-sentinel",
        GITHUB_TOKEN: "public-github-sentinel",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.proxy",
        GIT_CONFIG_VALUE_0: "http://127.0.0.1:7",
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(process.env).toEqual(before);
    expect(stderr).not.toMatch(
      /public-gh-sentinel|public-github-sentinel|enterprise-token-sentinel/,
    );
    expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
    expect(stdout.trim()).toBe("provider-paths-ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("actual Octokit API and raw requests use the explicit proxy despite hostile inheritance", async () => {
  const routes: string[] = [],
    auth: string[] = [];
  let directCount = 0;
  const direct = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      directCount++;
      return new Response("direct route forbidden", { status: 500 });
    },
  });
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      routes.push(path);
      auth.push(request.headers.get("authorization") ?? "");
      if (path.includes("/commits/"))
        return Response.json({ sha: commit, commit: { tree: { sha: tree } } });
      if (path.includes("/trees/"))
        return Response.json({ sha: tree, truncated: false, tree: [marker] });
      if (path.includes("/blobs/"))
        return Response.json({ message: "unavailable" }, { status: 503 });
      return new Response(bytes);
    },
  });
  try {
    await client(
      `
snapshot = await openGitHubSource('proxy-paths','https://github.com/acme/skills',commit,'',provenance,undefined,
  {baseUrl:process.env.TARGET, rawBaseUrl:process.env.TARGET}, 'http://127.0.0.1:1/forbidden.git', operation);
expect((await snapshot.inspectRoots(['']))[0].status).toBe('present');
expect(Buffer.from((await snapshot.read('SKILL.md')).bytes).toString()).toBe(${JSON.stringify(bytes.toString())});
await snapshot.read('SKILL.md');
`,
      { PROXY: proxy.url.toString(), TARGET: direct.url.toString() },
    );
    expect(routes).toEqual([
      `/repos/acme/skills/commits/${commit}`,
      `/repos/acme/skills/git/trees/${tree}`,
      `/repos/acme/skills/git/blobs/${blob}`,
      `/acme/skills/${commit}/SKILL.md`,
    ]);
    expect(auth.every((value) => value === "")).toBe(true);
    expect(directCount).toBe(0);
  } finally {
    proxy.stop(true);
    direct.stop(true);
  }
});

test("actual HTTPS Octokit trusts the fixture CA and refuses untrusted TLS without raw or Git fallback", async () => {
  const tls = await tlsFixture();
  const apiRoutes: string[] = [],
    proxyHttpRoutes: string[] = [],
    tunnels: string[] = [];
  const authorization: string[] = [],
    directGitRoutes: string[] = [];
  const target = createHttpsServer(
    {
      key: await readFile(join(tls.root, "server.key")),
      cert: await readFile(join(tls.root, "server.pem")),
    },
    (request, response) => {
      const path = request.url!;
      apiRoutes.push(path);
      authorization.push(request.headers.authorization ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          path.includes("/commits/")
            ? { sha: commit, commit: { tree: { sha: tree } } }
            : path.includes("/trees/")
              ? { sha: tree, truncated: false, tree: [marker] }
              : { sha: blob, encoding: "base64", content: bytes.toString("base64") },
        ),
      );
    },
  );
  const gitTarget = createServer((request, response) => {
    directGitRoutes.push(request.url!);
    response.writeHead(503);
    response.end();
  });
  await Promise.all([
    new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve)),
    new Promise<void>((resolve) => gitTarget.listen(0, "127.0.0.1", resolve)),
  ]);
  const sockets = new Set<import("node:stream").Duplex>();
  const proxy = createServer((request, response) => {
    // Raw and HTTP Git fallback have distinct URLs but share this observable proxy boundary.
    proxyHttpRoutes.push(request.url!);
    response.writeHead(503);
    response.end();
  });
  proxy.on("connect", (request, downstream, head) => {
    tunnels.push(request.url!);
    sockets.add(downstream);
    if (request.url !== "target.invalid:443") {
      downstream.destroy();
      return;
    }
    const upstream = connect((target.address() as AddressInfo).port, "127.0.0.1", () => {
      downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      downstream.pipe(upstream);
      upstream.pipe(downstream);
    });
    sockets.add(upstream);
    downstream.on("error", () => upstream.destroy());
    upstream.on("error", () => downstream.destroy());
    downstream.on("close", () => {
      sockets.delete(downstream);
      upstream.destroy();
    });
    upstream.on("close", () => {
      sockets.delete(upstream);
      downstream.destroy();
    });
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  try {
    const env = {
      PROXY: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
      GIT_TARGET: `http://127.0.0.1:${(gitTarget.address() as AddressInfo).port}/forbidden.git`,
      NODE_EXTRA_CA_CERTS: tls.ca,
    };
    const open = `snapshot = await openGitHubSource('proxy-paths','https://github.com/acme/skills',commit,'',provenance,undefined,
  {baseUrl:'https://target.invalid', rawBaseUrl:'http://raw.invalid'}, process.env.GIT_TARGET, operation);`;
    await client(
      open +
        `
expect((await snapshot.inspectRoots(['']))[0].status).toBe('present');
expect(Buffer.from((await snapshot.read('SKILL.md')).bytes).toString()).toBe(${JSON.stringify(bytes.toString())});
`,
      env,
    );
    const expectedApiRoutes = [
      `/repos/acme/skills/commits/${commit}`,
      `/repos/acme/skills/git/trees/${tree}`,
      `/repos/acme/skills/git/blobs/${blob}`,
    ];
    expect(apiRoutes).toEqual(expectedApiRoutes);
    expect(authorization).toEqual(["", "", ""]);
    expect(tunnels.length).toBeGreaterThan(0);
    expect(tunnels.every((route) => route === "target.invalid:443")).toBe(true);
    const trustedTunnels = tunnels.length;
    await client(
      open +
        `
let failure;
try { await snapshot.read('SKILL.md'); } catch (error) { failure = error; }
expect(failure).toMatchObject({code:'PROVIDER_UNAVAILABLE'});
expect(failure.message).toMatch(/certificate|cert|TLS/iu);
expect(failure.message).not.toMatch(/public-gh-sentinel|public-github-sentinel/);
expect(operation.signal.aborted).toBe(false);
`,
      { ...env, NODE_EXTRA_CA_CERTS: "" },
    );
    // A CONNECT attempt proves TLS was actually tried. No authenticated API HTTP request,
    // raw request, proxied Git request or bypassed direct Git request follows its refusal.
    expect(tunnels.length).toBeGreaterThan(trustedTunnels);
    expect(tunnels.every((route) => route === "target.invalid:443")).toBe(true);
    expect(apiRoutes).toEqual(expectedApiRoutes);
    expect(proxyHttpRoutes).toEqual([]);
    expect(directGitRoutes).toEqual([]);
  } finally {
    for (const socket of sockets) socket.destroy();
    for (const server of [proxy, target, gitTarget]) server.closeAllConnections();
    await Promise.all(
      [proxy, target, gitTarget].map(
        (server) => new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
    await tls.close();
  }
});

test("eligible API failure reuses explicit proxy and exact C for real smart HTTP Git fallback", async () => {
  const fixture = await networkFixture();
  const routes: string[] = [];
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      routes.push(url.pathname);
      if (url.pathname.startsWith("/repos/"))
        return Response.json({ message: "unavailable" }, { status: 503 });
      // Boundary forwarding only: the backend still exchanges real Git protocol/pack bytes.
      return fetch(new URL(url.pathname + url.search, fixture.proxyUrl), {
        method: request.method,
        headers: request.headers,
        body: request.method === "POST" ? await request.arrayBuffer() : undefined,
        proxy: { url: fixture.proxyUrl, respectNoProxy: false },
      });
    },
  });
  try {
    await client(
      `
snapshot = await openGitHubSource('proxy-paths','https://github.com/acme/skills',commit,'',provenance,undefined,
  {baseUrl:'http://api.invalid'}, process.env.GIT_TARGET, operation);
expect((await snapshot.inspectRoots(['']))[0].status).toBe('present');
expect(snapshot.commit).toBe(commit);
expect(Buffer.from((await snapshot.read('SKILL.md')).bytes).toString()).toContain('name: network');
await snapshot.read('SKILL.md');
`,
      { PROXY: proxy.url.toString(), COMMIT: fixture.commit, GIT_TARGET: fixture.targetUrl },
    );
    const apiRoutes = routes.filter((path) => path.startsWith("/repos/"));
    expect(apiRoutes.length).toBeGreaterThan(0);
    expect(apiRoutes.every((path) => path === `/repos/acme/skills/commits/${fixture.commit}`)).toBe(
      true,
    );
    expect(routes.some((path) => path.includes("git-upload-pack"))).toBe(true);
    expect(fixture.direct).toBe(0);
    expect(fixture.transfers.map((transfer) => transfer.wants)).toEqual([
      [fixture.commit],
      [fixture.selectedBlob],
    ]);
    expect(fixture.transfers.flatMap((transfer) => transfer.objects).join("\n")).not.toContain(
      fixture.historicalCommit,
    );
  } finally {
    proxy.stop(true);
    await fixture.close();
  }
});

test("fallback consumes the same elapsed SourceOperation budget rather than renewing it", async () => {
  const routes: string[] = [];
  // Leave fallback headers open at the HTTP boundary without a synthetic response.
  const proxy = createServer((request, response) => {
    const path = new URL(request.url!, "http://fixture.invalid").pathname;
    routes.push(path);
    if (path.startsWith("/repos/")) {
      setTimeout(() => {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "unavailable" }));
      }, 1500);
    }
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  try {
    await client(
      `
const started = Date.now(), expiresAt = operation.expiresAt;
snapshot = await openGitHubSource('proxy-paths','https://github.com/acme/skills',commit,'',provenance,undefined,
  {baseUrl:'http://api.invalid'}, 'http://git.invalid/remote.git', operation);
await expect(snapshot.inspectRoots([''])).rejects.toMatchObject({code:'PROVIDER_TIMEOUT'});
expect(operation.expiresAt).toBe(expiresAt);
expect(Date.now()-started).toBeLessThan(3500);
expect(operation.signal.aborted).toBe(true);
`,
      { PROXY: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`, BUDGET: "2500" },
    );
    expect(routes[0]).toBe(`/repos/acme/skills/commits/${commit}`);
    expect(routes.some((path) => path.includes("info/refs"))).toBe(true);
    expect(routes.filter((path) => path.startsWith("/repos/"))).toHaveLength(1);
  } finally {
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});

test("actual HTTP auth, not-found, integrity and socket failures never start Git fallback", async () => {
  for (const [mode, code] of [
    ["auth", "PROVIDER_AUTH_FAILED"],
    ["missing", "SOURCE_NOT_FOUND"],
    ["integrity", "PROVIDER_INTEGRITY_FAILED"],
    ["socket", "PROVIDER_UNAVAILABLE"],
  ] as const) {
    const routes: string[] = [];
    const proxy = createServer((request, response) => {
      routes.push(request.url!);
      if (mode === "socket") {
        request.socket.destroy();
        return;
      }
      response.writeHead(mode === "auth" ? 401 : mode === "missing" ? 404 : 200, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          sha: tree,
          commit: { tree: { sha: tree } },
          message: "Bearer public-gh-sentinel",
        }),
      );
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    try {
      await client(
        `
snapshot = await openGitHubSource('proxy-paths','https://github.com/acme/skills',commit,'',provenance,undefined,
  {baseUrl:'http://api.invalid'}, 'http://git.invalid/forbidden.git', operation);
await expect(snapshot.read('SKILL.md')).rejects.toMatchObject({code:${JSON.stringify(code)}});
`,
        { PROXY: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}` },
      );
      expect(routes).toHaveLength(1);
      expect(routes[0]).toContain(`/repos/acme/skills/commits/${commit}`);
    } finally {
      proxy.closeAllConnections();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  }
});

test("enterprise HTTPS meta uses host credentials through explicit CONNECT; TLS refusal and auth do not switch route", async () => {
  const tls = await tlsFixture(),
    root = await createExecutableFixture();
  const routes: string[] = [],
    authorization: string[] = [];
  let status = 200;
  const target = createHttpsServer(
    {
      key: await readFile(join(tls.root, "server.key")),
      cert: await readFile(join(tls.root, "server.pem")),
    },
    (request, response) => {
      routes.push(request.url!);
      authorization.push(request.headers.authorization ?? "");
      response.writeHead(status, {
        "content-type": "application/json",
        "x-github-enterprise-version": "3.15.0",
      });
      response.end(
        JSON.stringify(
          status === 200 ? { installed_version: "3.15.0" } : { message: "bad credentials" },
        ),
      );
    },
  );
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  const sockets = new Set<import("node:stream").Duplex>();
  const tunnels: string[] = [];
  const proxy = createServer();
  proxy.on("connect", (request, downstream, head) => {
    tunnels.push(request.url!);
    sockets.add(downstream);
    const upstream = connect((target.address() as AddressInfo).port, "127.0.0.1", () => {
      downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      downstream.pipe(upstream);
      upstream.pipe(downstream);
    });
    sockets.add(upstream);
    downstream.on("error", () => upstream.destroy());
    upstream.on("error", () => downstream.destroy());
    downstream.on("close", () => {
      sockets.delete(downstream);
      upstream.destroy();
    });
    upstream.on("close", () => {
      sockets.delete(upstream);
      downstream.destroy();
    });
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  try {
    const bin = join(root, "bin"),
      markerPath = join(root, "gh-invocations");
    await mkdir(bin);
    await writeFile(
      join(bin, "gh"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> '${markerPath}'\nprintf '%s\\n' enterprise-token-sentinel\n`,
      { mode: 0o755 },
    );
    const env = {
      PROXY: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
      PATH: `${bin}:${process.env.PATH}`,
      NODE_EXTRA_CA_CERTS: tls.ca,
    };
    await client(
      `
const api = await resolveGitHubApi('https://enterprise.invalid/acme/skills',undefined,undefined,operation);
expect(api.baseUrl).toBe('https://enterprise.invalid/api/v3');
expect(api.token).toBe('enterprise-token-sentinel');
`,
      env,
    );
    status = 401;
    await client(
      `await expect(resolveGitHubApi('https://enterprise.invalid/acme/skills',undefined,undefined,operation)).rejects.toMatchObject({code:'PROVIDER_AUTH_FAILED'});`,
      env,
    );
    await client(
      `await expect(resolveGitHubApi('https://enterprise.invalid/acme/skills',undefined,undefined,operation)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});`,
      { ...env, NODE_EXTRA_CA_CERTS: "" },
    );
    expect(routes).toEqual(["/api/v3/meta", "/api/v3/meta"]);
    expect(authorization).toEqual([
      "Bearer enterprise-token-sentinel",
      "Bearer enterprise-token-sentinel",
    ]);
    expect(tunnels).toEqual([
      "enterprise.invalid:443",
      "enterprise.invalid:443",
      "enterprise.invalid:443",
    ]);
    expect((await readFile(markerPath, "utf8")).trim().split("\n")).toEqual(
      Array(3).fill("auth token --hostname enterprise.invalid"),
    );
  } finally {
    for (const socket of sockets) socket.destroy();
    proxy.closeAllConnections();
    target.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => proxy.close(() => resolve())),
      new Promise<void>((resolve) => target.close(() => resolve())),
    ]);
    await tls.close();
    await rm(root, { recursive: true, force: true });
  }
});
