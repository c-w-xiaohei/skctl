import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile, rm, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

if (!(await Bun.file("/.dockerenv").exists())) throw new Error("Use scripts/resource-run.sh");
const hostBinary = resolve(process.argv[2] ?? "tmp/opencode-v2-host/opencode");
const native = resolve("dist/skctl-linux-x64");
const evidence = await mkdtemp(resolve("tmp/opencode-v2-host/run-"));
const root = await mkdtemp("/tmp/skctl-opencode-");
const home = join(root, "home");
const configHome = join(home, ".config/opencode");
const project = join(root, "project");
const moved = join(root, "other");
// Docker's /tmp tmpfs is noexec; executable fixtures live in the checkout mount.
const bin = join(evidence, "bin");
await Promise.all([
  mkdir(configHome, { recursive: true }),
  mkdir(project),
  mkdir(moved),
  mkdir(bin),
]);
const env = {
  PATH: `${bin}:/usr/local/bin:/usr/bin:/bin`,
  HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local/share"),
  XDG_STATE_HOME: join(home, ".local/state"),
  XDG_CACHE_HOME: join(home, ".cache"),
  OPENCODE_CONFIG_DIR: configHome,
  SKCTL_STATE_DIR: join(root, "state"),
  NO_COLOR: "1",
  GIT_TERMINAL_PROMPT: "0",
  TERM: "dumb",
};
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
await writeFile(
  join(bin, "skctl"),
  `#!/bin/sh\nprintf '%s\\n' "$PWD" >> ${quote(join(evidence, "browse-cwd.log"))}\nexec ${quote(native)} "$@"\n`,
);
await chmod(join(bin, "skctl"), 0o755);
async function command(name: string, argv: string[], cwd = project) {
  const child = Bun.spawn(argv, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    await writeFile(
      join(evidence, `${name}.json`),
      JSON.stringify({ argv, code, stdout, stderr }, null, 2),
    );
    assert.equal(code, 0, `${name}: ${stdout}\n${stderr}`);
    return stdout;
  } finally {
    clearTimeout(timer);
  }
}
const marker = "SKCTL_OPENCODE_V2_REAL";
async function catalog(directory: string, suffix: string) {
  await writeFile(
    join(directory, "skctl.jsonc"),
    JSON.stringify({ collections: { verify: { description: marker + suffix } }, use: ["verify"] }),
  );
  return (await command("catalog-" + suffix, [native, "agent", "browse"], directory)).trim();
}
const requests: { phase: string; body: any }[] = [];
let phase = "startup";
const llm = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const body = await request.json();
    requests.push({ phase, body });
    const chunks = [
      {
        choices: [
          { index: 0, delta: { role: "assistant", content: "LOCAL_OK" }, finish_reason: null },
        ],
      },
      {
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      },
    ];
    return new Response(
      chunks
        .map(
          (chunk) =>
            `data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "probe", ...chunk })}\n\n`,
        )
        .join("") + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    );
  },
});
await writeFile(
  join(configHome, "opencode.jsonc"),
  JSON.stringify({
    model: "probe/probe",
    update: "disable",
    snapshots: false,
    policies: [
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "probe", effect: "allow" },
    ],
    providers: {
      probe: {
        name: "Local recorder",
        package: "@opencode/ai/providers/openai-compatible",
        settings: {
          baseURL: `http://127.0.0.1:${llm.port}/v1`,
          apiKey: "fixture",
          timeout: 10_000,
        },
        models: {
          probe: { limit: { context: 100000, output: 1000 }, capabilities: { tools: true } },
        },
      },
    },
  }),
);
const reserve = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const port = reserve.port;
reserve.stop(true);
let host: ReturnType<typeof Bun.spawn> | undefined;
let logs: Promise<void>[] = [];
let password: string | undefined;
async function api(path: string, body?: unknown) {
  const method = body === undefined ? "GET" : "POST";
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...(body === undefined ? { method: "GET" } : { method: "POST", body: JSON.stringify(body) }),
    headers: {
      "content-type": "application/json",
      ...(password
        ? { authorization: "Basic " + Buffer.from(`opencode:${password}`).toString("base64") }
        : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}
async function start() {
  const child = Bun.spawn(
    [hostBinary, "serve", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: project,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  host = child;
  logs = (
    [
      ["stdout", child.stdout],
      ["stderr", child.stderr],
    ] as const
  ).map(async ([name, stream]) => {
    const reader = stream.getReader();
    let text = "";
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      text += new TextDecoder().decode(next.value);
      password = /server password (\S+)/.exec(text)?.[1] ?? password;
    }
    await writeFile(
      join(evidence, `server-${name}.log`),
      text.replace(/server password \S+/g, "server password [fixture credential redacted]"),
    );
  });
  const until = Date.now() + 20_000;
  while (true) {
    try {
      await api("/api/info");
      return;
    } catch (error) {
      if (Date.now() > until || host.exitCode !== null) throw error;
      await Bun.sleep(100);
    }
  }
}
const systemText = (body: any) =>
  body.messages
    ?.filter((m: any) => m.role === "system" || m.role === "developer")
    .map((m: any) =>
      typeof m.content === "string"
        ? m.content
        : m.content?.map((p: any) => p.text ?? "").join("\n"),
    )
    .join("\n") ?? "";
async function prompt(id: string, name: string, expected?: string) {
  phase = name;
  const before = requests.length;
  await api(`/api/session/${id}/prompt`, { text: "Reply LOCAL_OK without tools." });
  await api(`/api/experimental/session/${id}/wait`, {});
  const context = await api(`/api/session/${id}/context`);
  await writeFile(join(evidence, `${name}-context.json`), JSON.stringify(context, null, 2));
  const sent = requests.slice(before);
  assert.ok(sent.length, `${name}: no model requests`);
  assert.ok(
    expected
      ? sent.some((r) => systemText(r.body).includes(expected))
      : sent.every((r) => !systemText(r.body).includes(marker)),
    `${name}: catalog mismatch`,
  );
  console.log(name, "passed");
}
try {
  const version = (await command("version", [hostBinary, "--version"])).trim();
  assert.equal(version, "opencode v2.0.32");
  const initial = await catalog(project, "_INITIAL");
  const integration = [
    "opencode",
    "--scope",
    "global",
    "--config-dir",
    configHome,
    "--executable",
    hostBinary,
    "--json",
  ];
  const connected = JSON.parse(
    await command("connect", [native, "integration", "connect", ...integration]),
  );
  assert.equal(connected.outcome, "applied");
  assert.equal(connected.mechanism, "opencode-v2");
  assert.equal(
    JSON.parse(await command("repeat", [native, "integration", "connect", ...integration])).outcome,
    "unchanged",
  );
  await start();
  await writeFile(
    join(evidence, "config.json"),
    JSON.stringify(
      await api(`/api/config?location[directory]=${encodeURIComponent(project)}`),
      null,
      2,
    ),
  );
  await writeFile(join(evidence, "host-openapi.json"), JSON.stringify(await api("/openapi.json")));
  const plugins = await api(`/api/plugin?location[directory]=${encodeURIComponent(project)}`);
  await writeFile(join(evidence, "plugins.json"), JSON.stringify(plugins, null, 2));
  const created = await api("/api/session", {
    title: "skctl host probe",
    location: { directory: project },
    model: { providerID: "probe", id: "probe" },
  });
  const id = created.data.id;
  await prompt(id, "startup", initial);
  const loaded = await api(`/api/plugin?location[directory]=${encodeURIComponent(project)}`);
  await writeFile(join(evidence, "plugins-loaded.json"), JSON.stringify(loaded, null, 2));
  const active = loaded.data.find(
    (plugin: { id: string }) => plugin.id === "skctl.managed-catalog",
  );
  assert.equal(active?.state.status, "active", "Runtime did not activate the adapter");
  const fresh = await catalog(project, "_REFRESH");
  await prompt(id, "refresh", fresh);
  const compact = await catalog(project, "_COMPACT");
  phase = "compaction";
  const beforeCompact = requests.length;
  await api(`/api/session/${id}/compact`, {});
  await api(`/api/experimental/session/${id}/wait`, {});
  assert.ok(
    requests.slice(beforeCompact).some((r) => systemText(r.body).includes(compact)),
    "Compaction did not receive fresh catalog",
  );
  await prompt(id, "after-compact", compact);
  const movedCatalog = await catalog(moved, "_MOVED");
  await api(`/api/session/${id}/move`, { directory: moved });
  await api(`/api/experimental/session/${id}/wait`, {});
  await prompt(id, "moved", movedCatalog);
  const removed = JSON.parse(
    await command("disconnect", [native, "integration", "disconnect", ...integration]),
  );
  assert.equal(removed.outcome, "applied");
  await api("/api/location/reload", {});
  await prompt(id, "disconnected");
  // Exercise project-only installation using the same packaged adapter.
  const projectIntegration = [
    "opencode",
    "--scope",
    "project",
    "--project",
    moved,
    "--config-dir",
    configHome,
    "--executable",
    hostBinary,
    "--json",
  ];
  const projectConnected = JSON.parse(
    await command("connect-project", [native, "integration", "connect", ...projectIntegration]),
  );
  const projectArtifact = projectConnected.inspection.entries[0].artifact;
  assert.deepEqual(
    await readFile(projectArtifact),
    await readFile(resolve("dist/opencode-adapter.js")),
  );
  await api("/api/location/reload", {});
  await prompt(id, "project-installed", movedCatalog);
  // The runtime must fail open when its CLI cannot provide a catalog.
  await writeFile(join(bin, "skctl"), "#!/bin/sh\nexit 7\n");
  await prompt(id, "cli-failure");
  // V2 defers Promise-plugin cleanup until an active hook returns. Its CLI must
  // still terminate within the adapter's 30-second timeout and cleanup allowance.
  const pidFile = join(evidence, "blocked-child.pid");
  const slow = join(evidence, "slow.ts");
  await writeFile(
    slow,
    `await Bun.write(${JSON.stringify(pidFile)}, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));\nawait new Promise(() => {});\n`,
  );
  await writeFile(join(bin, "skctl"), `#!/bin/sh\nexec /usr/local/bin/bun ${quote(slow)}\n`);
  phase = "unload-running";
  await api(`/api/session/${id}/prompt`, { text: "Reply without tools." });
  const startedBy = Date.now() + 5000;
  while (!(await Bun.file(pidFile).exists())) {
    assert.ok(Date.now() < startedBy, "Blocking CLI did not start");
    await Bun.sleep(25);
  }
  const { pid, startedAt } = JSON.parse(await readFile(pidFile, "utf8"));
  process.kill(pid, 0);
  await command("disconnect-project", [native, "integration", "disconnect", ...projectIntegration]);
  await api("/api/location/reload", {});
  const reloadedAt = Date.now();
  await writeFile(
    join(evidence, "plugins-unloaded.json"),
    JSON.stringify(
      await api(`/api/plugin?location[directory]=${encodeURIComponent(moved)}`),
      null,
      2,
    ),
  );
  const cleanupAllowanceMs = 5000;
  const lifetimeLimitMs = 30_000 + cleanupAllowanceMs;
  const stoppedBy = startedAt + lifetimeLimitMs;
  while (true) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
      break;
    }
    if (Date.now() >= stoppedBy) {
      await writeFile(
        join(evidence, "child-status.txt"),
        await readFile(`/proc/${pid}/status`, "utf8"),
      );
      assert.fail("Plugin unload left its CLI process alive");
    }
    await Bun.sleep(25);
  }
  const exitedAt = Date.now();
  await writeFile(
    join(evidence, "unload.json"),
    JSON.stringify(
      {
        pid,
        startedAt,
        reloadedAt,
        exitedAt,
        lifetimeLimitMs,
        elapsedMs: exitedAt - startedAt,
        aliveBeforeReload: true,
        stoppedAfterReload: true,
        terminationCause: "not-observed; bounded by adapter timeout",
      },
      null,
      2,
    ),
  );
  // Location reload interrupts the in-flight session; test the next session separately.
  const afterUnload = await api("/api/session", {
    location: { directory: moved },
    model: { providerID: "probe", id: "probe" },
  });
  await prompt(afterUnload.data.id, "after-unload");
  const hash = async (file: string) =>
    createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  await writeFile(
    join(evidence, "summary.json"),
    JSON.stringify(
      {
        version,
        hostSha256: await hash(hostBinary),
        skctlSha256: await hash(native),
        adapterSha256: await hash(resolve("dist/opencode-adapter.js")),
        projectAdapterSha256: await hash(projectArtifact),
        instrumented: false,
        verdict: "passed",
        cases: [
          "install",
          "repeat",
          "startup",
          "refresh",
          "compaction",
          "move",
          "disconnect-reload",
          "project-install",
          "cli-failure",
          "inflight-process-bounded",
          "post-unload-no-injection",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (host) {
    host.kill("SIGTERM");
    const timer = setTimeout(() => host!.kill("SIGKILL"), 2000);
    await host.exited;
    clearTimeout(timer);
    await Promise.all(logs);
  }
  llm.stop(true);
  await writeFile(join(evidence, "requests.json"), JSON.stringify(requests, null, 2));
  console.log("Evidence:", evidence);
  await cp(join(home, ".local/share/opencode/log"), join(evidence, "logs"), {
    recursive: true,
  }).catch(() => {});
  await cp(configHome, join(evidence, "config"), { recursive: true });
  await rm(root, { recursive: true, force: true });
}
