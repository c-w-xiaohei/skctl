import * as api from "../../src/index";
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setAcquisitionTrapForTest } from "../../src/source/snapshot";
import { setManagementPublicationHookForTest } from "../../src/installed/update";
import { networkFixture } from "../provider/network-fixture";
import { command } from "../provider/network-fixture";
test("W3 actual management Git acquisition uses frozen user proxy through install, check and discovery", async () => {
  const fixture = await networkFixture();
  const keys = [
    "SKCTL_STATE_DIR",
    "HTTP_PROXY",
    "http_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
    "NO_PROXY",
    "no_proxy",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_NOSYSTEM",
  ];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.SKCTL_STATE_DIR = join(fixture.root, "state");
    process.env.GIT_CONFIG_GLOBAL = join(fixture.root, "gitconfig");
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    await writeFile(process.env.GIT_CONFIG_GLOBAL, "");
    for (const key of keys.filter((key) => key.toLowerCase().endsWith("proxy")))
      process.env[key] = key.toLowerCase() === "no_proxy" ? "*" : "http://127.0.0.1:1";
    const user = join(fixture.root, "user.jsonc");
    await writeFile(user, JSON.stringify({ network: { proxy: fixture.proxyUrl } }));
    await writeFile(join(fixture.root, "skctl.jsonc"), "{}\n");
    const core = { cwd: fixture.root, userConfigPath: user };
    await api.registerSource(core, {
      level: "project",
      id: "remote",
      binding: { kind: "git", origin: fixture.targetUrl, root: "", ref: "main" },
    });
    setAcquisitionTrapForTest(() => writeFileSync(user, "{}\n"));
    setManagementPublicationHookForTest(async () => {
      // Policy edits apply to the next acquisition; publication has no live remote timer.
      await writeFile(user, "{}\n");
    });
    await api.installSkills(core, { source: "remote", paths: [""], exactRevision: fixture.commit });
    expect(fixture.routes.length).toBeGreaterThan(0);
    expect(fixture.direct).toBe(0);
    const state = JSON.parse(await readFile(join(fixture.root, "state", "state.json"), "utf8"));
    expect(state.installed[0].treeIdentity).toBeDefined();
    setManagementPublicationHookForTest();
    await writeFile(user, JSON.stringify({ network: { proxy: fixture.proxyUrl } }));
    const before = fixture.routes.length;
    expect((await api.checkUpdate(core, { source: "remote" })).value.unchanged).toHaveLength(1);
    expect(fixture.routes.length).toBeGreaterThan(before);
    await writeFile(user, JSON.stringify({ network: { proxy: fixture.proxyUrl } }));
    expect((await api.discoverSkills(core, { source: "remote" })).value.exactRevision).toBe(
      fixture.commit,
    );
    const work = join(fixture.root, "work");
    await writeFile(join(work, "copy.md"), "updated selected resource\n");
    for (const args of [
      ["add", "copy.md"],
      ["commit", "-m", "selected update"],
      ["push", join(fixture.root, "remote.git"), "HEAD:main"],
    ])
      await command(work, ["/usr/bin/git", ...args]);
    const revision = await command(work, ["/usr/bin/git", "rev-parse", "HEAD"]);
    await writeFile(user, JSON.stringify({ network: { proxy: fixture.proxyUrl } }));
    await api.updateSkills(core, { source: "remote", paths: [""], exactRevision: revision });
    expect(
      JSON.parse(await readFile(join(fixture.root, "state", "state.json"), "utf8")).installed[0],
    ).toMatchObject({ name: "network", adoptedRevision: revision });
    expect(fixture.direct).toBe(0);
    expect(process.env.NO_PROXY).toBe("*");
  } finally {
    setAcquisitionTrapForTest();
    setManagementPublicationHookForTest();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fixture.close();
  }
});
test("W3 invalid user network and user read errors fail before provider acquisition", async () => {
  const fixture = await networkFixture();
  const saved = process.env.SKCTL_STATE_DIR;
  process.env.SKCTL_STATE_DIR = join(fixture.root, "state");
  let opens = 0;
  try {
    const user = join(fixture.root, "user.jsonc");
    await writeFile(join(fixture.root, "skctl.jsonc"), "{}\n");
    const core = {
      cwd: fixture.root,
      userConfigPath: user,
      sourceTransport: () => join(fixture.root, "remote.git"),
    };
    await api.registerSource(core, {
      level: "project",
      id: "remote",
      binding: { kind: "git", origin: fixture.targetUrl, root: "", ref: "main" },
    });
    setAcquisitionTrapForTest(() => {
      opens++;
    });
    await writeFile(user, '{"network":{"proxy":"socks://invalid"}}');
    await expect(
      api.installSkills(core, { source: "remote", paths: [""], exactRevision: fixture.commit }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(opens).toBe(0);
    const blocked = join(fixture.root, "blocked");
    await mkdir(blocked);
    await writeFile(join(blocked, "config.jsonc"), "{}");
    const { chmod } = await import("node:fs/promises");
    await chmod(blocked, 0);
    try {
      const inaccessible = {
        cwd: fixture.root,
        userConfigPath: join(blocked, "config.jsonc"),
      };
      await expect(api.discoverSkills(inaccessible, { source: "remote" })).rejects.toThrow();
      expect(opens).toBe(0);
    } finally {
      await chmod(blocked, 0o700);
    }
  } finally {
    setAcquisitionTrapForTest();
    if (saved === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = saved;
    await fixture.close();
  }
});
test("W3 Config observe, preview and adoption share actual user-proxy acquisition and close before publication", async () => {
  const fixture = await networkFixture();
  const saved = process.env.SKCTL_STATE_DIR;
  process.env.SKCTL_STATE_DIR = join(fixture.root, "state");
  const user = join(fixture.root, "user.jsonc");
  try {
    const work = join(fixture.root, "work");
    await writeFile(join(work, "config.jsonc"), '{"sources":{},"collections":{}}\n');
    for (const args of [
      ["add", "config.jsonc"],
      ["commit", "-m", "reusable config"],
      ["push", join(fixture.root, "remote.git"), "HEAD:main"],
    ])
      await command(work, ["/usr/bin/git", ...args]);
    const revision = await command(work, ["/usr/bin/git", "rev-parse", "HEAD"]);
    await writeFile(user, JSON.stringify({ network: { proxy: fixture.proxyUrl } }));
    await writeFile(join(fixture.root, "skctl.jsonc"), "{}\n");
    const core = { cwd: fixture.root, userConfigPath: user };
    await api.registerConfigSource(core, {
      level: "project",
      id: "shared",
      binding: { kind: "git", origin: fixture.targetUrl, root: "", ref: "main" },
    });
    let acquisitions = 0;
    setAcquisitionTrapForTest(() => {
      acquisitions++;
      // Synchronous boundary edit must not replace the captured operation policy.
      writeFileSync(user, "{}\n");
    });
    const observation = await api.observeConfigSource(core, { id: "shared" });
    expect(observation.value.exactRevision).toBe(revision);
    await writeFile(user, JSON.stringify({ network: { proxy: fixture.proxyUrl } }));
    expect(
      (await api.previewConfigAdoption(core, { id: "shared", exactRevision: revision })).value
        .allowed,
    ).toBe(true);
    await writeFile(user, JSON.stringify({ network: { proxy: fixture.proxyUrl } }));
    let atPublication = 0;
    setManagementPublicationHookForTest(() => {
      atPublication = fixture.routes.length;
    });
    await api.adoptConfigSource(core, { id: "shared", exactRevision: revision });
    expect(acquisitions).toBe(3);
    expect(atPublication).toBe(fixture.routes.length);
    expect(fixture.direct).toBe(0);
    expect(
      JSON.parse(await readFile(join(fixture.root, "state", "state.json"), "utf8")).configs.shared
        .commit,
    ).toBe(revision);
  } finally {
    setAcquisitionTrapForTest();
    setManagementPublicationHookForTest();
    if (saved === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = saved;
    await fixture.close();
  }
});
test("W3 check deadline covers delayed ref plus acquisition, drains cancellation, then the next check succeeds", async () => {
  const fixture = await networkFixture();
  const saved = process.env.SKCTL_STATE_DIR;
  const oldGitConfig = process.env.GIT_CONFIG_GLOBAL;
  const oldNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
  process.env.SKCTL_STATE_DIR = join(fixture.root, "state");
  let mode: "slow" | "hang" | "fast" = "slow";
  let requests = 0;
  let closed = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let admitted: (() => void) | undefined;
  const proxy = createServer((request, response) => {
    requests++;
    response.on("close", () => {
      closed++;
    });
    admitted?.();
    if (mode === "hang") return;
    const delay = mode === "slow" ? (requests === 1 ? 27000 : 6000) : 0;
    const timer = setTimeout(async () => {
      timers.delete(timer);
      if (response.destroyed) return;
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = await fetch(
          `${fixture.proxyUrl}${new URL(request.url!).pathname}${new URL(request.url!).search}`,
          {
            method: request.method,
            body: request.method === "POST" ? Buffer.concat(chunks) : undefined,
            headers: request.headers as Record<string, string>,
            signal: AbortSignal.timeout(5000),
          },
        );
        response.writeHead(body.status, Object.fromEntries(body.headers));
        response.end(Buffer.from(await body.arrayBuffer()));
      } catch (error) {
        if (!response.destroyed) {
          response.writeHead(502);
          response.end(String(error));
        }
      }
    }, delay);
    timers.add(timer);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  try {
    process.env.GIT_CONFIG_GLOBAL = join(fixture.root, "gitconfig");
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    // A single ref advertisement completes before the second delayed request,
    // so the timeout proves the budget spans ref resolution AND exact fetch.
    await writeFile(process.env.GIT_CONFIG_GLOBAL, "[protocol]\nversion = 0\n");
    const user = join(fixture.root, "user.jsonc");
    await writeFile(join(fixture.root, "skctl.jsonc"), "{}\n");
    const options = { cwd: fixture.root, userConfigPath: user };
    const initial = {
      ...options,
      sourceTransport: () => join(fixture.root, "remote.git"),
    };
    await api.registerSource(initial, {
      level: "project",
      id: "remote",
      binding: { kind: "git", origin: fixture.targetUrl, root: "", ref: "main" },
    });
    await api.installSkills(initial, {
      source: "remote",
      paths: [""],
      exactRevision: fixture.commit,
    });
    const stateFile = join(fixture.root, "state", "state.json");
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    for (const item of state.installed) item.adoptedRevision = "a".repeat(40);
    await writeFile(stateFile, JSON.stringify(state));
    const before = await readFile(stateFile, "utf8");
    await writeFile(
      user,
      JSON.stringify({
        network: { proxy: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}` },
      }),
    );
    const core = options;
    const start = Date.now();
    const timedOut = await api.checkUpdate(core, { source: "remote" }).catch((error) => error);
    expect(timedOut).toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(timedOut.message).toContain("Git acquisition");
    expect(Date.now() - start).toBeGreaterThan(29000);
    expect(Date.now() - start).toBeLessThan(35000);
    expect(requests).toBeGreaterThanOrEqual(2);
    expect(closed).toBe(requests);
    expect(await readFile(stateFile, "utf8")).toBe(before);
    mode = "hang";
    const abort = new AbortController();
    const ready = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    const pending = api.checkUpdate(core, { source: "remote" }, { signal: abort.signal });
    await ready;
    admitted = undefined;
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(closed).toBe(requests);
    mode = "fast";
    for (const item of state.installed) item.adoptedRevision = fixture.commit;
    await writeFile(stateFile, JSON.stringify(state));
    expect((await api.checkUpdate(core, { source: "remote" })).value.unchanged).toHaveLength(1);
    expect(fixture.direct).toBe(0);
  } finally {
    for (const timer of timers) clearTimeout(timer);
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    if (oldGitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = oldGitConfig;
    if (oldNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = oldNoSystem;
    if (saved === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = saved;
    await fixture.close();
  }
}, 45000);
