import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openGitSource, resolveGitRef, runProviderChild } from "../../src/source/git";
import { createSourceOperation } from "../../src/source/network";
import { networkFixture, tlsFixture } from "./network-fixture";

const provenance = {
  source: "network",
  origin: "git" as const,
  declaration: { level: "project" as const },
  stability: "immutable" as const,
};
test("real smart HTTP Git ref, exact fetch and blob acquisition override hostile proxy configuration", async () => {
  const fixture = await networkFixture();
  const operation = createSourceOperation({
    source: "network",
    proxy: fixture.proxyUrl,
    budgetMs: 5000,
  });
  const previous = { ...process.env };
  let snapshot: Awaited<ReturnType<typeof openGitSource>> | undefined;
  try {
    const config = join(fixture.root, "gitconfig");
    await writeFile(
      config,
      `[http "${fixture.targetUrl}"]\n proxy = http://127.0.0.1:1\n[http]\n proxy = http://127.0.0.1:2\n`,
    );
    process.env.GIT_CONFIG_GLOBAL = config;
    process.env.GIT_CONFIG_COUNT = "2";
    process.env.GIT_CONFIG_KEY_0 = `http.${fixture.targetUrl}.proxy`;
    process.env.GIT_CONFIG_VALUE_0 = "http://127.0.0.1:3";
    process.env.GIT_CONFIG_KEY_1 = "credential.helper";
    process.env.GIT_CONFIG_VALUE_1 = "";
    for (const key of [
      "HTTP_PROXY",
      "http_proxy",
      "HTTPS_PROXY",
      "https_proxy",
      "ALL_PROXY",
      "all_proxy",
    ])
      process.env[key] = "http://127.0.0.1:4";
    process.env.NO_PROXY = "*";
    process.env.no_proxy = "*";
    const before = { ...process.env };
    expect(await resolveGitRef(fixture.targetUrl, "main", undefined, undefined, operation)).toBe(
      fixture.commit,
    );
    snapshot = await openGitSource(
      "network",
      fixture.targetUrl,
      fixture.commit,
      "",
      provenance,
      undefined,
      operation,
    );
    expect((await snapshot.inspectRoots([""]))[0]?.status).toBe("present");
    expect(fixture.direct).toBe(0);
    expect(fixture.routes.some((route) => route.includes("git-upload-pack"))).toBe(true);
    console.log("Git proxy routes before blob acquisition", fixture.routes);
    const contents = await snapshot.readMany!(["SKILL.md", "copy.md", "SKILL.md"]);
    expect(contents.map((content) => content.entry.path)).toEqual(["SKILL.md", "copy.md"]);
    expect(
      contents.every((content) =>
        new TextDecoder().decode(content.bytes).includes("name: network"),
      ),
    ).toBe(true);
    expect(fixture.transfers.map((transfer) => transfer.wants)).toEqual([
      [fixture.commit],
      [fixture.selectedBlob],
    ]);
    expect(fixture.transfers[1]!.objects).toEqual([`${fixture.selectedBlob} blob`]);
    expect(fixture.transfers[0]!.objects.every((object) => !object.endsWith(" blob"))).toBe(true);
    expect(fixture.transfers.flatMap((transfer) => transfer.objects).join("\n")).not.toMatch(
      new RegExp(
        [fixture.unrelatedBlob, fixture.historicalBlob, fixture.historicalCommit].join("|"),
      ),
    );
    const transfers = fixture.transfers.length;
    await snapshot.read("SKILL.md");
    expect(fixture.transfers).toHaveLength(transfers);
    expect(
      fixture.routes.filter((route) => route.includes("info/refs")).length,
    ).toBeGreaterThanOrEqual(2);
    expect(fixture.routes.some((route) => route.includes("git-upload-pack"))).toBe(true);
    expect(fixture.direct).toBe(0);
    expect(process.env).toEqual(before);
    expect(await readFile(config, "utf8")).toContain("proxy = http://127.0.0.1:1");
  } finally {
    await snapshot?.close();
    operation.dispose();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    await fixture.close();
  }
});

test("real Bun HTTPS target via HTTP and HTTPS proxy trusts fixture CA and rejects untrusted CA", async () => {
  const fixture = await tlsFixture();
  try {
    const script = join(fixture.root, "client.ts");
    await writeFile(
      script,
      `import { createSourceOperation, sourceFetch } from '${join(import.meta.dir, "../../src/source/network.ts")}';
const op = createSourceOperation({ source: 'tls', proxy: process.env.PROXY, budgetMs: 1500 });
try { const response = await sourceFetch(op)(process.env.TARGET ?? 'https://target.invalid/content'); console.log(await response.text()); }
catch (error) { op.throwIfAborted('TLS'); console.error(String(error)); process.exitCode = 7; }
finally { op.dispose(); }`,
    );
    const results = [];
    for (const [label, proxy, bypass, target] of [
      ["direct trusted TLS control", undefined, "", fixture.targetUrl],
      ["HTTP proxy trusted TLS control", fixture.httpProxy, "", undefined],
      ["HTTP proxy hostile NO_PROXY", fixture.httpProxy, "*", undefined],
      ["HTTPS proxy trusted TLS control", fixture.httpsProxy, "", undefined],
      ["HTTPS proxy hostile NO_PROXY", fixture.httpsProxy, "*", undefined],
    ] as const) {
      const env = {
        ...process.env,
        NODE_EXTRA_CA_CERTS: fixture.ca,
        PROXY: proxy,
        TARGET: target,
        NO_PROXY: bypass,
        no_proxy: bypass,
        HTTPS_PROXY: proxy ? "http://127.0.0.1:1" : "",
        https_proxy: "",
        ALL_PROXY: "",
        all_proxy: "",
      };
      const result = await runProviderChild({
        cmd: ["bun", script],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const evidence = {
        label,
        status: result.status,
        stdout: new TextDecoder().decode(result.stdout),
        stderr: new TextDecoder().decode(result.stderr),
        routes: fixture.routes.slice(),
      };
      console.log("TLS runtime evidence", evidence);
      results.push(evidence);
    }
    const env = { ...process.env, NODE_EXTRA_CA_CERTS: "", PROXY: fixture.httpProxy };
    const result = await runProviderChild({
      cmd: ["bun", script],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.status).toBe(7);
    expect(new TextDecoder().decode(result.stderr)).toMatch(/certificate|cert|TLS/iu);
    console.log("untrusted TLS runtime evidence", {
      status: result.status,
      stderr: new TextDecoder().decode(result.stderr),
    });
    expect(
      results.every(
        (result) => result.status === 0 && result.stdout.trim() === "trusted transport",
      ),
    ).toBe(true);
    expect(fixture.routes.filter((route) => route === "target.invalid:443")).toHaveLength(5);
  } finally {
    await fixture.close();
  }
});
