import { createServer as httpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as httpsServer } from "node:https";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function command(
  cwd: string,
  cmd: string[],
  env?: Record<string, string | undefined>,
) {
  const child = Bun.spawn(cmd, { cwd, env: env ?? process.env, stdout: "pipe", stderr: "pipe" });
  const [out, err, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (status) throw new Error(`${cmd[0]} exited ${status}: ${err}`);
  return out.trim();
}
export async function networkFixture() {
  const root = await mkdtemp(join(tmpdir(), "provider-network-"));
  const git = (...args: string[]) => command(root, ["/usr/bin/git", ...args]);
  const work = join(root, "work"),
    bare = join(root, "remote.git");
  await mkdir(work);
  await command(work, ["/usr/bin/git", "init"]);
  await command(work, ["/usr/bin/git", "config", "user.email", "test@example.test"]);
  await command(work, ["/usr/bin/git", "config", "user.name", "Test"]);
  await writeFile(join(work, "history-only.txt"), "historical content must not be acquired\n");
  await command(work, ["/usr/bin/git", "add", "."]);
  await command(work, ["/usr/bin/git", "commit", "-m", "history"]);
  const historicalCommit = await command(work, ["/usr/bin/git", "rev-parse", "HEAD"]);
  const historicalBlob = await command(work, [
    "/usr/bin/git",
    "rev-parse",
    "HEAD:history-only.txt",
  ]);
  await command(work, ["/usr/bin/git", "tag", "historical"]);
  await rm(join(work, "history-only.txt"));
  await mkdir(join(work, "unrelated"));
  await writeFile(
    join(work, "unrelated", "SKILL.md"),
    "---\nname: unrelated\ndescription: Unrelated\n---\n",
  );
  await writeFile(join(work, "unrelated", "resource.txt"), "unselected resource\n".repeat(4096));
  await writeFile(join(work, "SKILL.md"), "---\nname: network\ndescription: Network\n---\n");
  await writeFile(join(work, "copy.md"), "---\nname: network\ndescription: Network\n---\n");
  await command(work, ["/usr/bin/git", "add", "."]);
  await command(work, ["/usr/bin/git", "commit", "-m", "fixture"]);
  const commit = await command(work, ["/usr/bin/git", "rev-parse", "HEAD"]);
  const selectedBlob = await command(work, ["/usr/bin/git", "rev-parse", "HEAD:SKILL.md"]);
  const unrelatedBlob = await command(work, [
    "/usr/bin/git",
    "rev-parse",
    "HEAD:unrelated/resource.txt",
  ]);
  await git("init", "--bare", bare);
  await git(`--git-dir=${bare}`, "config", "uploadpack.allowFilter", "true");
  await git(`--git-dir=${bare}`, "config", "uploadpack.allowAnySHA1InWant", "true");
  await command(work, ["/usr/bin/git", "push", bare, "HEAD:main"]);
  await command(work, ["/usr/bin/git", "push", bare, "refs/tags/historical"]);
  const routes: string[] = [];
  const transfers: { wants: string[]; objects: string[]; bytes: number }[] = [];
  let direct = 0;
  async function smart(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url!, "http://fixture.invalid");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const wants = [...body.toString().matchAll(/want ([0-9a-f]{40})/gu)].map((match) => match[1]!);
    const child = Bun.spawn(["/usr/lib/git-core/git-http-backend"], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: request.method!,
        CONTENT_TYPE: request.headers["content-type"] ?? "",
        CONTENT_LENGTH: String(body.length),
        HTTP_GIT_PROTOCOL: (request.headers["git-protocol"] as string) ?? "",
        REMOTE_ADDR: "127.0.0.1",
      },
      stdin: body,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, status] = await Promise.all([
      new Response(child.stdout).arrayBuffer(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (status) {
      response.writeHead(500);
      response.end(err);
      return;
    }
    const bytes = Buffer.from(out),
      end = bytes.indexOf("\r\n\r\n");
    const headers = bytes.subarray(0, end).toString().split("\r\n");
    let code = 200;
    for (const header of headers) {
      const colon = header.indexOf(":");
      if (colon < 0) continue;
      const key = header.slice(0, colon),
        value = header.slice(colon + 1).trim();
      if (key.toLowerCase() === "status") code = Number(value.split(" ")[0]);
      else response.setHeader(key, value);
    }
    const payload = bytes.subarray(end + 4);
    if (wants.length) {
      // Decode Git's sideband channel 1 to audit the actual returned pack, not argv.
      const packChunks: Buffer[] = [];
      let shallowOnly = true,
        shallowBoundaries = 0;
      for (let offset = 0; offset + 4 <= payload.length;) {
        if (payload.subarray(offset, offset + 4).toString() === "PACK") {
          packChunks.push(payload.subarray(offset));
          break;
        }
        const length = Number.parseInt(payload.subarray(offset, offset + 4).toString(), 16);
        if (!Number.isFinite(length)) break;
        if (length <= 4) {
          offset += 4;
          continue;
        }
        const packet = payload.subarray(offset + 4, offset + length);
        if (packet[0] === 1) packChunks.push(packet.subarray(1));
        else if (/^(?:un)?shallow [0-9a-f]{40}\n?$/u.test(packet.toString())) shallowBoundaries++;
        else shallowOnly = false;
        offset += length;
      }
      const pack = Buffer.concat(packChunks);
      // Protocol v0 can negotiate shallow boundaries before the subsequent done/pack request.
      const negotiationOnly =
        !pack.length &&
        shallowOnly &&
        shallowBoundaries > 0 &&
        !body.includes(Buffer.from("0009done\n"));
      if (!negotiationOnly) {
        if (pack.subarray(0, 4).toString() !== "PACK") throw new Error("Fixture expected Git pack");
        const audit = join(root, `audit-${transfers.length}.git`);
        await git("init", "--bare", audit);
        const index = Bun.spawn(["/usr/bin/git", `--git-dir=${audit}`, "index-pack", "--stdin"], {
          stdin: pack,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [status, , error] = await Promise.all([
          index.exited,
          new Response(index.stdout).text(),
          new Response(index.stderr).text(),
        ]);
        if (status) throw new Error(error);
        const objects = (
          await git(
            `--git-dir=${audit}`,
            "cat-file",
            "--batch-all-objects",
            "--batch-check=%(objectname) %(objecttype)",
          )
        ).split("\n");
        transfers.push({ wants, objects, bytes: pack.length });
      }
    }
    response.writeHead(code);
    response.end(payload);
  }
  const target = httpServer((request, response) => {
    direct++;
    void smart(request, response);
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  const proxy = httpServer((request, response) => {
    routes.push(request.url!);
    void smart(request, response);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const port = (server: typeof proxy) => (server.address() as AddressInfo).port;
  return {
    root,
    commit,
    routes,
    transfers,
    selectedBlob,
    unrelatedBlob,
    historicalBlob,
    historicalCommit,
    get direct() {
      return direct;
    },
    targetUrl: `http://127.0.0.1:${port(target)}/remote.git`,
    proxyUrl: `http://127.0.0.1:${port(proxy)}`,
    async close() {
      proxy.closeAllConnections();
      target.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => proxy.close(() => resolve())),
        new Promise<void>((resolve) => target.close(() => resolve())),
      ]);
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function tlsFixture() {
  const root = await mkdtemp(join(tmpdir(), "provider-tls-"));
  await command(root, ["openssl", "help"]);
  await command(root, [
    "openssl",
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
    "-days",
    "1",
    "-subj",
    "/CN=Provider Fixture CA",
  ]);
  await command(root, [
    "openssl",
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "server.key",
    "-out",
    "server.csr",
    "-subj",
    "/CN=localhost",
  ]);
  await writeFile(
    join(root, "extensions"),
    "subjectAltName=DNS:localhost,DNS:target.invalid,DNS:enterprise.invalid,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n",
  );
  await command(root, [
    "openssl",
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "ca.pem",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "server.pem",
    "-days",
    "1",
    "-extfile",
    "extensions",
  ]);
  const options = {
    key: await readFile(join(root, "server.key")),
    cert: await readFile(join(root, "server.pem")),
  };
  const routes: string[] = [];
  const target = httpsServer(options, (_request, response) => {
    response.end("trusted transport");
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  function tunnel(request: IncomingMessage, client: import("node:stream").Duplex, head: Buffer) {
    routes.push(request.url!);
    const upstream = connect((target.address() as AddressInfo).port, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    client.on("close", () => upstream.destroy());
  }
  const http = httpServer();
  http.on("connect", tunnel);
  const https = httpsServer(options);
  https.on("connect", tunnel);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => https.listen(0, "127.0.0.1", resolve));
  return {
    root,
    routes,
    ca: join(root, "ca.pem"),
    targetUrl: `https://127.0.0.1:${(target.address() as AddressInfo).port}`,
    httpProxy: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
    httpsProxy: `https://127.0.0.1:${(https.address() as AddressInfo).port}`,
    async close() {
      for (const server of [http, https, target]) {
        server.closeAllConnections();
        server.close();
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}
