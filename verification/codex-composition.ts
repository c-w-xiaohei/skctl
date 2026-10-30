import { mkdir, mkdtemp, readFile, writeFile, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

// The binary must be copied into the checkout before entering resource-run.
// Keep real host execution, config parsing, hook commands and request assembly;
// replace only the remote Responses endpoint with a local recorder.
if (!(await Bun.file("/.dockerenv").exists()))
  throw new Error("Run this probe through scripts/resource-run.sh");
const codex = resolve(process.argv[2] ?? "tmp/codex-real-host-20261027/codex");
const evidence = resolve(process.argv[3] ?? "tmp/codex-real-host-20261027");
await mkdir(evidence, { recursive: true });
const skctl = resolve("dist/skctl-linux-x64");
const root = await mkdtemp(join(evidence, "run-"));
const project = join(root, "project");
const home = join(root, "home");
const codexHome = join(home, ".codex");
const bin = join(root, "bin");
await Promise.all([mkdir(project), mkdir(codexHome, { recursive: true }), mkdir(bin)]);
const env = {
  PATH: `${bin}:/usr/local/bin:/usr/bin:/bin`,
  HOME: home,
  CODEX_HOME: codexHome,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local/share"),
  XDG_CACHE_HOME: join(home, ".cache"),
  XDG_STATE_HOME: join(home, ".local/state"),
  SKCTL_STATE_DIR: join(root, "skctl-state"),
  NO_COLOR: "1",
  TERM: "dumb",
  RUST_LOG: "warn",
  GIT_TERMINAL_PROMPT: "0",
};
const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
await writeFile(
  join(bin, "skctl"),
  `#!/bin/sh\npwd >> ${shellQuote(join(root, "hook-cwd.log"))}\ncat >> ${shellQuote(join(root, "hook-stdin.log"))}\nprintf '\\n' >> ${shellQuote(join(root, "hook-stdin.log"))}\nexec ${shellQuote(skctl)} "$@"\n`,
);
await chmod(join(bin, "skctl"), 0o755);
const marker = "SKCTL_REAL_HOST_CATALOG_8c931a";
await writeFile(
  join(project, "skctl.jsonc"),
  JSON.stringify({
    collections: { verification: { description: marker } },
    use: ["verification"],
  }),
);

async function command(name: string, argv: string[], cwd = project, timeout = 20_000) {
  const child = Bun.spawn(argv, { cwd, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeout);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    await writeFile(
      join(root, `${name}.json`),
      JSON.stringify({ argv, code, timedOut, stdout, stderr }, null, 2),
    );
    return { code, timedOut, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

const requests: { case: string; body: unknown }[] = [];
let current = "setup";
let serial = 0;
let spawnIssued = false;
let childRequest: (() => void) | undefined;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (!url.pathname.endsWith("/responses")) return new Response("unsupported", { status: 404 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    const raw =
      request.headers.get("content-encoding") === "zstd" ? Bun.zstdDecompressSync(bytes) : bytes;
    const body = JSON.parse(new TextDecoder().decode(raw));
    requests.push({ case: current, body });
    if (
      current === "app-subagent" &&
      JSON.stringify(body.input).includes("SKCTL_CHILD_PROBE") &&
      JSON.stringify(body.input).includes(marker + "_CHILD_FRESH")
    )
      childRequest?.();
    const id = `resp_${++serial}`;
    const spawn = current === "app-subagent" && !spawnIssued;
    if (spawn) spawnIssued = true;
    const item = spawn
      ? {
          id: `fc_${serial}`,
          type: "function_call",
          status: "completed",
          call_id: `call_${serial}`,
          name: "spawn_agent",
          namespace: "multi_agent_v1",
          arguments: JSON.stringify({
            message: "SKCTL_CHILD_PROBE: Reply OK without tools.",
            fork_context: false,
          }),
        }
      : {
          id: `msg_${serial}`,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: "LOCAL_TRANSPORT_OK", annotations: [] }],
        };
    const response = {
      id,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model: "gpt-5.1-codex",
      output: [item],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    };
    const events = spawn
      ? [
          {
            type: "response.created",
            response: { ...response, status: "in_progress", output: [] },
          },
          { type: "response.output_item.added", output_index: 0, item },
          { type: "response.output_item.done", output_index: 0, item },
          { type: "response.completed", response },
        ]
      : [
          {
            type: "response.created",
            response: { ...response, status: "in_progress", output: [] },
          },
          {
            type: "response.output_item.added",
            output_index: 0,
            item: { ...item, status: "in_progress", content: [] },
          },
          {
            type: "response.content_part.added",
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          },
          {
            type: "response.output_text.delta",
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            delta: "LOCAL_TRANSPORT_OK",
          },
          {
            type: "response.output_text.done",
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            text: "LOCAL_TRANSPORT_OK",
          },
          { type: "response.output_item.done", output_index: 0, item },
          { type: "response.completed", response },
        ];
    return new Response(
      events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
      { headers: { "content-type": "text/event-stream" } },
    );
  },
});

const config = (enabled: boolean, trusted = true) =>
  `model = "gpt-5.1-codex"\nmodel_provider = "local_verification"\n[model_providers.local_verification]\nname = "Local request capture"\nbase_url = "http://127.0.0.1:${server.port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n[features]\ncodex_hooks = ${enabled}\nshell_snapshot = false\nplugins = false\n[projects.${JSON.stringify(project)}]\ntrust_level = "${trusted ? "trusted" : "untrusted"}"\n`;
const cases: {
  name: string;
  exit: number;
  timedOut: boolean;
  requests: number;
  catalogInRequest: boolean;
  exactCatalogInDeveloper: boolean;
  freshMarkerInRequest: boolean;
  newHookInputs: string;
}[] = [];
const verdict = {
  basicTransport: "not-checked",
  compatibility: "not-checked",
  failures: [] as string[],
};
let freshMarker = marker;
const hookInputs = () => readFile(join(root, "hook-stdin.log"), "utf8").catch(() => "");
const catalog = async () =>
  (await command("expected-catalog", [skctl, "agent", "browse"])).stdout.trim();
async function changeCatalog(value: string) {
  freshMarker = value;
  await writeFile(
    join(project, "skctl.jsonc"),
    JSON.stringify({
      collections: { verification: { description: value } },
      use: ["verification"],
    }),
  );
}
async function execCase(name: string, resume?: string, cwd = project) {
  current = name;
  const before = requests.length;
  const previousInputs = await hookInputs();
  const expected = await catalog();
  const result = await command(
    name,
    [
      codex,
      "exec",
      ...(resume ? ["resume", resume] : []),
      "--skip-git-repo-check",
      "--json",
      "Reply OK without tools.",
    ],
    cwd,
  );
  const sent = requests.slice(before);
  const serialized = JSON.stringify(sent);
  const exactCatalogInDeveloper = sent.some(({ body }: any) =>
    body.input?.some(
      (item: any) =>
        item.role === "developer" && item.content?.some((part: any) => part.text === expected),
    ),
  );
  const summary = {
    name,
    exit: result.code,
    timedOut: result.timedOut,
    requests: sent.length,
    catalogInRequest: serialized.includes(marker),
    exactCatalogInDeveloper,
    freshMarkerInRequest: serialized.includes(freshMarker),
    newHookInputs: (await hookInputs()).slice(previousInputs.length),
  };
  cases.push(summary);
  console.log(
    JSON.stringify({
      ...summary,
      newHookInputs: summary.newHookInputs
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line).source),
    }),
  );
  const thread = result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return {};
      }
    })
    .find((e) => e.type === "thread.started");
  return thread?.thread_id as string | undefined;
}

let appError: string | undefined;
async function appServerCases(reviewOnly = false) {
  const child = Bun.spawn([codex, "app-server"], {
    cwd: project,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = new Response(child.stderr).text();
  const events: any[] = [];
  const pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: unknown) => void }
  >();
  const listeners = new Set<(message: any) => void>();
  let sequence = 0;
  const read = (async () => {
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const value = await reader.read();
      if (value.done) break;
      buffer += decoder.decode(value.value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        events.push(message);
        if (message.id !== undefined && pending.has(message.id)) {
          const waiter = pending.get(message.id)!;
          pending.delete(message.id);
          if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
          else waiter.resolve(message.result);
        }
        for (const listener of listeners) listener(message);
      }
    }
  })();
  async function rpc(method: string, params: unknown) {
    const id = ++sequence;
    let timer: ReturnType<typeof setTimeout>;
    const answer = new Promise<any>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, 15_000);
    });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    try {
      return await answer;
    } finally {
      clearTimeout(timer!);
    }
  }
  function completed(threadId: string) {
    return new Promise<void>((resolve, reject) => {
      const listener = (message: any) => {
        if (message.method !== "turn/completed" || message.params.threadId !== threadId) return;
        listeners.delete(listener);
        clearTimeout(timer);
        if (message.params.turn?.error)
          reject(new Error(JSON.stringify(message.params.turn.error)));
        else resolve();
      };
      const timer = setTimeout(() => {
        listeners.delete(listener);
        reject(new Error("turn completion timeout"));
      }, 15_000);
      listeners.add(listener);
    });
  }
  async function turn(threadId: string) {
    const done = completed(threadId);
    await Promise.all([
      done,
      rpc("turn/start", { threadId, input: [{ type: "text", text: "Reply OK without tools." }] }),
    ]);
  }
  try {
    await rpc("initialize", {
      clientInfo: { name: "skctl_verification", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    if (reviewOnly) {
      const listed = await rpc("hooks/list", { cwds: [project] });
      await writeFile(join(root, `review-${serial}.json`), JSON.stringify(listed, null, 2));
      const hooks = listed.data
        .flatMap((entry: any) => entry.hooks)
        .filter((hook: any) => hook.command === "skctl agent browse");
      assert.ok(hooks.length, "The host must discover installed hooks before review");
      await rpc("config/batchWrite", {
        edits: [
          {
            keyPath: "hooks.state",
            value: Object.fromEntries(
              hooks.map((hook: any) => [hook.key, { trusted_hash: hook.currentHash }]),
            ),
            mergeStrategy: "upsert",
          },
        ],
        reloadUserConfig: true,
      });
      return;
    }
    current = "app-startup";
    const started = await rpc("thread/start", {
      cwd: project,
      approvalPolicy: "never",
      sandbox: "read-only",
    });
    const id = started.thread.id;
    await turn(id);
    await changeCatalog(marker + "_FORK_FRESH");
    current = "app-fork";
    const beforeFork = await hookInputs();
    const forked = await rpc("thread/fork", { threadId: id, cwd: project });
    await turn(forked.thread.id);
    const forkInputs = (await hookInputs()).slice(beforeFork.length);
    await changeCatalog(marker + "_COMPACT_FRESH");
    current = "app-compact";
    const beforeCompact = await hookInputs();
    await Promise.all([completed(id), rpc("thread/compact/start", { threadId: id })]);
    current = "app-after-compact";
    await turn(id);
    const compactInputs = (await hookInputs()).slice(beforeCompact.length);
    await changeCatalog(marker + "_CLEAR_FRESH");
    current = "app-clear";
    const beforeClear = await hookInputs();
    const cleared = await rpc("thread/start", { cwd: project, sessionStartSource: "clear" });
    await turn(cleared.thread.id);
    const clearInputs = (await hookInputs()).slice(beforeClear.length);
    await changeCatalog(marker + "_CHILD_FRESH");
    current = "app-subagent";
    const beforeChild = await hookInputs();
    let childTimer: ReturnType<typeof setTimeout>;
    const delivered = new Promise<void>((resolve, reject) => {
      childRequest = resolve;
      childTimer = setTimeout(() => reject(new Error("Child context delivery timed out")), 15_000);
    });
    try {
      await Promise.all([turn(id), delivered]);
    } finally {
      clearTimeout(childTimer!);
      childRequest = undefined;
    }
    const childInputs = (await hookInputs()).slice(beforeChild.length);
    await writeFile(
      join(root, "app-lifecycle-summary.json"),
      JSON.stringify(
        {
          forkInputs,
          compactInputs,
          clearInputs,
          clearFreshContext: JSON.stringify(
            requests.filter((r) => r.case === "app-clear"),
          ).includes(marker + "_CLEAR_FRESH"),
          childInputs,
          childFreshContext: requests.some(
            (r: any) =>
              r.case === "app-subagent" &&
              r.body.input?.some(
                (item: any) =>
                  item.role === "developer" &&
                  JSON.stringify(item).includes(marker + "_CHILD_FRESH"),
              ),
          ),
          forkFreshContext: JSON.stringify(requests.filter((r) => r.case === "app-fork")).includes(
            marker + "_FORK_FRESH",
          ),
          compactFreshContext: JSON.stringify(
            requests.filter((r) => r.case === "app-after-compact"),
          ).includes(marker + "_COMPACT_FRESH"),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    appError = String(error);
    await writeFile(join(root, "app-error.txt"), String(error));
    console.error("App lifecycle verification:", error);
  } finally {
    child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
    await child.exited;
    clearTimeout(timer);
    await read;
    await writeFile(join(root, "app-stderr.txt"), await stderr);
    await writeFile(join(root, "app-events.json"), JSON.stringify(events, null, 2));
  }
}
async function verifyHost() {
  const version = await command("version", [codex, "--version"]);
  assert.equal((await command("git-init", ["git", "init", "-q", project])).code, 0);
  const features = await command("features-default", [codex, "features", "list"]);
  if (version.stdout.trim() === "codex-cli 0.118.0") {
    await writeFile(join(codexHome, "config.toml"), config(false));
    const args = [
      skctl,
      "integration",
      "connect",
      "codex",
      "--scope",
      "global",
      "--config-dir",
      codexHome,
      "--executable",
      codex,
      "--json",
    ];
    const installed = await command("connect-default", args);
    assert.equal(JSON.parse(installed.stdout).mechanism, "default");
    assert.equal(JSON.parse((await command("repeat-default", args)).stdout).outcome, "unchanged");
    await execCase("default-guidance");
    assert.ok(
      JSON.stringify(requests).includes("skctl agent browse"),
      "Real host must load the default instructions",
    );
    const removed = await command("disconnect-default", [
      skctl,
      "integration",
      "disconnect",
      "codex",
      "--scope",
      "global",
      "--config-dir",
      codexHome,
      "--executable",
      codex,
      "--file",
      join(codexHome, "AGENTS.md"),
      "--ack-file-impact",
      "--json",
    ]);
    assert.equal(removed.code, 0, removed.stdout + removed.stderr);
    const before = requests.length;
    await execCase("after-default-disconnect");
    assert.ok(!JSON.stringify(requests.slice(before)).includes("skctl agent browse"));
    assert.ok(!(await Bun.file(join(codexHome, "hooks.json")).exists()));
    await writeFile(join(root, "requests.json"), JSON.stringify(requests, null, 2));
    await writeFile(
      join(root, "summary.json"),
      JSON.stringify(
        { version: version.stdout.trim(), verdict: "default-guidance-delivery-passed", cases },
        null,
        2,
      ),
    );
    console.log("Default guidance delivery and removal passed:", root);
    return;
  }
  assert.equal(
    version.stdout.trim(),
    "codex-cli 0.164.0",
    "This native probe targets the verified release",
  );
  await writeFile(join(codexHome, "config.toml"), config(false));
  const connection = await command("connect", [
    skctl,
    "integration",
    "connect",
    "codex",
    "--scope",
    "global",
    "--config-dir",
    codexHome,
    "--executable",
    codex,
    "--json",
  ]);
  assert.equal(connection.code, 0, connection.stdout + connection.stderr);
  assert.equal(JSON.parse(connection.stdout).outcome, "applied");
  const repeat = await command("connect-again", [
    skctl,
    "integration",
    "connect",
    "codex",
    "--scope",
    "global",
    "--config-dir",
    codexHome,
    "--executable",
    codex,
    "--json",
  ]);
  assert.equal(JSON.parse(repeat.stdout).outcome, "unchanged");
  await command("expected-catalog", [skctl, "agent", "browse"]);
  const hooks = await readFile(join(codexHome, "hooks.json"), "utf8");
  await writeFile(join(root, "installed-hooks.json"), hooks);
  await execCase("disabled-installed");
  await writeFile(join(codexHome, "config.toml"), config(true));
  await execCase("unreviewed-installed");
  await appServerCases(true);
  const installedThread = await execCase("enabled-installed");
  const reviewedConfig = await readFile(join(codexHome, "config.toml"), "utf8");
  await writeFile(
    join(codexHome, "config.toml"),
    reviewedConfig.replace(/(codex_hooks|hooks) = true/, "$1 = false"),
  );
  await execCase("disabled-reviewed");
  await writeFile(join(codexHome, "config.toml"), reviewedConfig);
  const changed = JSON.parse(hooks);
  changed.hooks.SessionStart[0].hooks[0].statusMessage = "skctl: changed definition";
  await writeFile(join(codexHome, "hooks.json"), JSON.stringify(changed));
  await execCase("changed-unreviewed");
  await writeFile(join(codexHome, "hooks.json"), hooks);
  await changeCatalog(marker + "_RESUME_FRESH");
  if (installedThread) await execCase("resume-installed", installedThread);
  await mkdir(join(project, "nested"));
  await execCase("nested-cwd", undefined, join(project, "nested"));
  // Diagnostic control: exercise SessionStart without a SubagentStart handler.
  const control = JSON.parse(hooks);
  delete control.hooks.SubagentStart;
  await writeFile(join(codexHome, "hooks.json"), JSON.stringify(control));
  const thread = await execCase("sessionstart-only-control");
  if (thread) await execCase("resume-control", thread);
  await writeFile(join(codexHome, "hooks.json"), hooks);
  await command("inspect", [
    skctl,
    "integration",
    "inspect",
    "codex",
    "--scope",
    "global",
    "--config-dir",
    codexHome,
    "--executable",
    codex,
    "--json",
  ]);
  await command("disconnect", [
    skctl,
    "integration",
    "disconnect",
    "codex",
    "--scope",
    "global",
    "--config-dir",
    codexHome,
    "--executable",
    codex,
    "--json",
  ]);
  await execCase("after-disconnect");
  await writeFile(
    join(codexHome, "config.toml"),
    config(true) + '\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "true"\n',
  );
  const inline = await command("connect-inline", [
    skctl,
    "integration",
    "connect",
    "codex",
    "--scope",
    "global",
    "--config-dir",
    codexHome,
    "--executable",
    codex,
    "--json",
  ]);
  assert.equal(JSON.parse(inline.stdout).outcome, "applied", inline.stdout);
  await writeFile(
    join(root, "installed-inline.toml"),
    await readFile(join(codexHome, "config.toml")),
  );
  await appServerCases(true);
  await execCase("inline-toml");
  await command("disconnect-inline", [
    skctl,
    "integration",
    "disconnect",
    "codex",
    "--scope",
    "global",
    "--config-dir",
    codexHome,
    "--executable",
    codex,
    "--json",
  ]);
  await writeFile(join(codexHome, "config.toml"), config(true));
  await command("connect-project", [
    skctl,
    "integration",
    "connect",
    "codex",
    "--scope",
    "project",
    "--project",
    project,
    "--config-dir",
    codexHome,
    "--executable",
    codex,
    "--json",
  ]);
  await appServerCases(true);
  await execCase("project-trusted");
  await writeFile(
    join(codexHome, "config.toml"),
    (await readFile(join(codexHome, "config.toml"), "utf8")).replace(
      'trust_level = "trusted"',
      'trust_level = "untrusted"',
    ),
  );
  await execCase("project-untrusted");
  await command("disconnect-project", [
    skctl,
    "integration",
    "disconnect",
    "codex",
    "--scope",
    "project",
    "--project",
    project,
    "--config-dir",
    codexHome,
    "--executable",
    codex,
    "--json",
  ]);
  await writeFile(join(codexHome, "config.toml"), config(true));
  await command("reconnect-global", [
    skctl,
    "integration",
    "connect",
    "codex",
    "--scope",
    "global",
    "--config-dir",
    codexHome,
    "--executable",
    codex,
    "--json",
  ]);
  await appServerCases(true);
  await appServerCases();
  const longCollections = Object.fromEntries(
    Array.from({ length: 90 }, (_, i) => [
      `catalog-${String(i).padStart(3, "0")}`,
      { description: `${marker}_${i} ` + "0123456789abcdef ".repeat(12) },
    ]),
  );
  freshMarker = marker + "_89";
  await writeFile(
    join(project, "skctl.jsonc"),
    JSON.stringify({ collections: longCollections, use: Object.keys(longCollections) }),
  );
  await execCase("large-catalog");
  await writeFile(join(root, "large-catalog-expected.txt"), await catalog());
  await writeFile(join(root, "requests.json"), JSON.stringify(requests, null, 2));
  const hash = async (file: string) =>
    createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  const summary = {
    version: version.stdout.trim(),
    codexSha256: await hash(codex),
    skctlSha256: await hash(skctl),
    featureList: features.stdout,
    root,
    cases,
    verdict,
    network:
      "Docker network=none, loopback stub Responses endpoint; no remote model or credentials",
  };
  await writeFile(join(root, "summary.json"), JSON.stringify(summary, null, 2));
  console.log("Evidence:", root);
  assert.equal(appError, undefined, appError);
  for (const item of cases) {
    assert.equal(item.exit, 0, item.name);
    assert.equal(item.timedOut, false, item.name);
    assert.equal(item.requests, 1, item.name);
  }
  for (const name of [
    "enabled-installed",
    "resume-installed",
    "nested-cwd",
    "project-trusted",
    "inline-toml",
    "large-catalog",
  ]) {
    const item = cases.find((item) => item.name === name)!;
    assert.equal(item.exactCatalogInDeveloper, true, name);
    assert.ok(item.newHookInputs, name);
  }
  for (const name of [
    "disabled-installed",
    "disabled-reviewed",
    "changed-unreviewed",
    "unreviewed-installed",
    "after-disconnect",
    "project-untrusted",
  ])
    assert.equal(cases.find((item) => item.name === name)!.newHookInputs, "", name);
  verdict.basicTransport = "passed";
  if (!cases.find((item) => item.name === "inline-toml")!.exactCatalogInDeveloper)
    verdict.failures.push(
      "Installer accepts inline TOML hooks, but the host does not deliver their catalog.",
    );
  const lifecycle = JSON.parse(await readFile(join(root, "app-lifecycle-summary.json"), "utf8"));
  if (!lifecycle.clearFreshContext || !lifecycle.clearInputs.includes('"source":"clear"'))
    verdict.failures.push("Clear did not receive fresh context through the clear hook.");
  if (
    !lifecycle.childFreshContext ||
    !lifecycle.childInputs.includes('"hook_event_name":"SubagentStart"')
  )
    verdict.failures.push("A real child agent did not receive fresh hook context.");
  if (!lifecycle.forkFreshContext || !lifecycle.forkInputs.includes('"source":"fork"'))
    verdict.failures.push("Fork did not receive fresh context through the fork hook.");
  if (!lifecycle.compactFreshContext)
    verdict.failures.push(
      "Compaction completes without refreshing the root catalog before the next request.",
    );
  verdict.compatibility = verdict.failures.length ? "failed" : "passed-for-exercised-cases";
  await writeFile(join(root, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(verdict, null, 2));
  if (verdict.failures.length) process.exitCode = 1;
}
try {
  await verifyHost();
} finally {
  server.stop(true);
}
