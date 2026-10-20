import * as api from "../../src/index";
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as service from "../../src/source/service";
import { networkFixture } from "../provider/network-fixture";
import { command } from "../provider/network-fixture";
afterEach(() => {
  mock.restore();
  delete process.env.SKCTL_SOURCE_CACHE_DIR;
});
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
    process.env.SKCTL_SOURCE_CACHE_DIR = join(fixture.root, "cache");
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
    const prepare = service.withPreparedSkills;
    const acquisition = spyOn(service, "withPreparedSkills").mockImplementation(function <T>(
      context: service.SourceContext,
      paths: readonly string[],
      revision: string | undefined,
      operation: (skills: readonly service.PreparedSkill[]) => Promise<T>,
    ): Promise<T> {
      writeFileSync(user, "{}\n");
      return prepare(context, paths, revision, operation);
    });
    await api.installSkills(core, { source: "remote", paths: [""], exactRevision: fixture.commit });
    expect(fixture.routes.length).toBeGreaterThan(0);
    expect(fixture.direct).toBe(0);
    const state = JSON.parse(await readFile(join(fixture.root, "state", "state.json"), "utf8"));
    expect(state.installed[0].treeIdentity).toBeDefined();
    acquisition.mockRestore();
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
  process.env.SKCTL_SOURCE_CACHE_DIR = join(fixture.root, "cache");
  let opens = 0;
  try {
    const user = join(fixture.root, "user.jsonc");
    await writeFile(join(fixture.root, "skctl.jsonc"), "{}\n");
    const core = {
      cwd: fixture.root,
      userConfigPath: user,
      sourceTransport: () => {
        opens++;
        return join(fixture.root, "remote.git");
      },
    };
    await api.registerSource(core, {
      level: "project",
      id: "remote",
      binding: { kind: "git", origin: fixture.targetUrl, root: "", ref: "main" },
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
    if (saved === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = saved;
    await fixture.close();
  }
});
test("W3 Config observe, preview and adoption share actual user-proxy acquisition and close before publication", async () => {
  const fixture = await networkFixture();
  const saved = process.env.SKCTL_STATE_DIR;
  process.env.SKCTL_STATE_DIR = join(fixture.root, "state");
  process.env.SKCTL_SOURCE_CACHE_DIR = join(fixture.root, "cache");
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
    const read = service.readSourceConfig;
    let acquisitions = 0;
    spyOn(service, "readSourceConfig").mockImplementation((...args) => {
      acquisitions++;
      writeFileSync(user, "{}\n");
      return read(...args);
    });
    const observation = await api.observeConfigSource(core, { id: "shared" });
    expect(observation.value.exactRevision).toBe(revision);
    await writeFile(user, JSON.stringify({ network: { proxy: fixture.proxyUrl } }));
    expect(
      (await api.previewConfigAdoption(core, { id: "shared", exactRevision: revision })).value
        .allowed,
    ).toBe(true);
    await writeFile(user, JSON.stringify({ network: { proxy: fixture.proxyUrl } }));
    const beforeAdoption = fixture.routes.length;
    await api.adoptConfigSource(core, { id: "shared", exactRevision: revision });
    expect(acquisitions).toBe(3);
    expect(beforeAdoption).toBe(fixture.routes.length);
    expect(fixture.direct).toBe(0);
    expect(
      JSON.parse(await readFile(join(fixture.root, "state", "state.json"), "utf8")).configs.shared
        .commit,
    ).toBe(revision);
  } finally {
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
  process.env.SKCTL_SOURCE_CACHE_DIR = join(fixture.root, "cache");
  let mode: "slow" | "hang" | "fast" = "slow";
  let requests = 0;
  let closed = 0;
  let admitted: (() => void) | undefined;
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 60,
    async fetch(request) {
      requests++;
      admitted?.();
      const delay =
        mode === "slow" ? (requests === 1 ? 27000 : 6000) : mode === "hang" ? 60_000 : 0;
      // Observe cancellation at Bun's actual HTTP boundary; its Node HTTP shim
      // does not reliably emit ServerResponse.close on disconnected peers.
      let finish!: () => void;
      const waiting = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const timer = setTimeout(finish, delay);
      request.signal.addEventListener("abort", finish, { once: true });
      try {
        if (request.signal.aborted) finish();
        await waiting;
        if (request.signal.aborted) return new Response(null, { status: 499 });
        const url = new URL(request.url);
        const body = await fetch(`${fixture.proxyUrl}${url.pathname}${url.search}`, {
          method: request.method,
          body: request.method === "POST" ? await request.arrayBuffer() : undefined,
          headers: request.headers,
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
        });
        return new Response(await body.arrayBuffer(), {
          status: body.status,
          headers: body.headers,
        });
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", finish);
        closed++;
      }
    },
  });
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
    for (const item of state.installed) {
      item.adoptedRevision = "a".repeat(40);
      delete item.treeIdentity;
    }
    await writeFile(stateFile, JSON.stringify(state));
    const before = await readFile(stateFile, "utf8");
    await writeFile(
      user,
      JSON.stringify({
        network: { proxy: proxy.url.toString() },
      }),
    );
    const core = options;
    const start = Date.now();
    const timedOut = await api.checkUpdate(core, { source: "remote" }).catch((error) => error);
    expect(timedOut).toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(timedOut.message).toContain("Git fetch");
    expect(Date.now() - start).toBeGreaterThan(29000);
    expect(Date.now() - start).toBeLessThan(35000);
    expect(requests).toBeGreaterThanOrEqual(2);
    for (let attempt = 0; closed < requests && attempt < 100; attempt++) await Bun.sleep(10);
    expect(closed).toBe(requests);
    expect(await readFile(stateFile, "utf8")).toBe(before);
    mode = "hang";
    const abort = new AbortController();
    const ready = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    const pending = api.checkUpdate(core, { source: "remote" }, { signal: abort.signal }).then(
      () => ({ code: "unexpected-success" }),
      (error: unknown) => error,
    );
    const reached = await Promise.race([ready.then(() => "ready"), pending]);
    expect(reached).toBe("ready");
    admitted = undefined;
    abort.abort();
    expect(await pending).toHaveProperty("code", "CANCELLED");
    for (let attempt = 0; closed < requests && attempt < 100; attempt++) await Bun.sleep(10);
    expect(closed).toBe(requests);
    mode = "fast";
    for (const item of state.installed) item.adoptedRevision = fixture.commit;
    await writeFile(stateFile, JSON.stringify(state));
    expect((await api.checkUpdate(core, { source: "remote" })).value.unchanged).toHaveLength(1);
    expect(fixture.direct).toBe(0);
  } finally {
    await proxy.stop(true);
    if (oldGitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = oldGitConfig;
    if (oldNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = oldNoSystem;
    if (saved === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = saved;
    await fixture.close();
  }
}, 45000);
