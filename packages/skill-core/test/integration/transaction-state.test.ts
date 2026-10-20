import * as api from "../../src/index";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateCoordinator } from "../../src/storage/state";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "skctl-transaction-"));
  const state = join(root, "state");
  const project = join(root, "project");
  const global = join(root, "global.jsonc");
  await Bun.write(join(project, "skctl.jsonc"), "{}\n");
  await Bun.write(global, "{}\n");
  return { root, state, project, global };
}
async function snapshot(root: string) {
  const state = join(root, "state");
  async function collect(path: string): Promise<Record<string, string>> {
    const output: Record<string, string> = {};
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) Object.assign(output, await collect(child));
      else output[child.slice(root.length)] = await readFile(child, "utf8");
    }
    return output;
  }
  return {
    config: await readFile(join(root, "project", "skctl.jsonc"), "utf8"),
    private: await collect(state),
  };
}
const registerTeamSource =
  'registerSource(environment, { level: "project", id: "team", binding: { kind: "local", path: "./skills", root: "" } })';
const installReview = 'installSkills(environment, { source: "team", paths: ["review"] })';
const uninstallReview = 'uninstallSkills(environment, { source: "team", paths: ["review"] })';
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function expectTransactionCrash(value: Fixture, operation: string, hook: string) {
  const entry = join(import.meta.dir, "../../src/index.ts");
  const script = `import * as api from ${JSON.stringify(entry)};
    ${hook === "stage-synced" ? `import {spyOn} from 'bun:test';import * as fs from 'node:fs/promises';const rename=fs.rename;spyOn(fs,'rename').mockImplementation(async(a,b)=>{if(String(b).includes('/transactions/'))process.exit(97);return rename(a,b)});` : ""}
    const environment = { cwd: ${JSON.stringify(value.project)}, userConfigPath: ${JSON.stringify(value.global)} }; await api.${operation};`;
  const child = Bun.spawn({
    cmd: [process.execPath, "--eval", script],
    env: { ...process.env, SKCTL_STATE_DIR: value.state, SKCTL_TEST_CRASH_AT: hook },
    stdout: "pipe",
    stderr: "pipe",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const exit = await Promise.race([
    child.exited,
    new Promise<-1>((resolve) => {
      timer = setTimeout(() => resolve(-1), 15000);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (exit === -1) {
    child.kill("SIGTERM");
    const stopped = await Promise.race([
      child.exited.then(() => true),
      Bun.sleep(1000).then(() => false),
    ]);
    if (!stopped) {
      child.kill("SIGKILL");
      const killed = await Promise.race([
        child.exited.then(() => true),
        Bun.sleep(1000).then(() => false),
      ]);
      if (!killed) throw new Error("Timed-out transaction child did not exit after SIGKILL");
    }
  }
  expect(exit).toBe(97);
}
async function childGuardCrash(state: string, atPublication = false) {
  const entry = join(import.meta.dir, "../../src/storage/state.ts");
  const script = `import { StateCoordinator } from ${JSON.stringify(entry)};
    ${atPublication ? `import {spyOn} from 'bun:test';import * as fs from 'node:fs/promises';const link=fs.link;spyOn(fs,'link').mockImplementation(async(a,b)=>{await link(a,b);if(String(b).endsWith('mutation.lock'))process.exit(97)});` : ""}
    await new StateCoordinator(${JSON.stringify(state)}).withLock(async () => {process.exit(97)});`;
  const child = Bun.spawn({
    cmd: [process.execPath, "--eval", script],
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(
    await Promise.race([
      child.exited,
      Bun.sleep(15000).then(() => {
        child.kill();
        return -1;
      }),
    ]),
  ).toBe(97);
}
function childWorkspace(project: string, state: string, global: string, output: string) {
  const entry = join(import.meta.dir, "../../src/index.ts");
  const script = `import { getWorkspace } from ${JSON.stringify(entry)}; const result = await getWorkspace({ cwd: ${JSON.stringify(project)}, userConfigPath: ${JSON.stringify(global)} }); await Bun.write(${JSON.stringify(output)}, JSON.stringify(result.value));`;
  return Bun.spawn({
    cmd: [process.execPath, "--eval", script],
    env: { ...process.env, SKCTL_STATE_DIR: state },
    stdout: "pipe",
    stderr: "pipe",
  });
}
async function installFixture() {
  const value = await fixture();
  await mkdir(join(value.project, "skills", "review"), { recursive: true });
  await writeFile(
    join(value.project, "skills", "review", "SKILL.md"),
    "---\nname: review\ndescription: Review\n---\n",
  );
  await writeFile(
    join(value.project, "skctl.jsonc"),
    '{ "sources": { "team": { "kind": "local", "path": "./skills", "root": "" } } }\n',
  );
  return value;
}
test("TX-003 public committed-marker crash rolls a declaration forward on fresh workspace read", async () => {
  const value = await fixture();
  try {
    await expectTransactionCrash(value, registerTeamSource, "transaction-committed");
    expect(await readFile(join(value.project, "skctl.jsonc"), "utf8")).toBe("{}\n");
    process.env.SKCTL_STATE_DIR = value.state;
    const core = { cwd: value.project, userConfigPath: value.global };
    await api.getWorkspace(core);
    expect(await readFile(join(value.project, "skctl.jsonc"), "utf8")).toContain('"team"');
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});
test("TX-005 a crashed lock owner is reclaimed without retaining a fence", async () => {
  const value = await fixture();
  try {
    await childGuardCrash(value.state);
    expect(await Bun.file(join(value.state, "mutation.lock")).exists()).toBe(true);
    await new StateCoordinator(value.state).withLock(async () => undefined);
    expect(await Bun.file(join(value.state, "mutation.lock")).exists()).toBe(false);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
test("TX-005 a crash at atomic lock publication leaves a live owned guard that is reclaimed", async () => {
  const value = await fixture();
  try {
    await childGuardCrash(value.state, true);
    const owner = JSON.parse(await readFile(join(value.state, "mutation.lock"), "utf8"));
    expect(owner).toMatchObject({ pid: expect.any(Number), nonce: expect.any(String) });
    await new StateCoordinator(value.state).withLock(async () => undefined);
    expect(await Bun.file(join(value.state, "mutation.lock")).exists()).toBe(false);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
test("TX-004 fresh public workspace read never overwrites an unknown declaration edit", async () => {
  const value = await fixture();
  try {
    await expectTransactionCrash(value, registerTeamSource, "transaction-committed");
    const config = join(value.project, "skctl.jsonc");
    await writeFile(config, "{\n  // human edit\n}\n");
    process.env.SKCTL_STATE_DIR = value.state;
    await expect(
      api.getWorkspace({ cwd: value.project, userConfigPath: value.global }),
    ).rejects.toMatchObject({
      code: "TRANSACTION_CONFLICT",
    });
    expect(await readFile(config, "utf8")).toBe("{\n  // human edit\n}\n");
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});
test("TX-002/TX-003 stage, immutable, and marker boundaries are recovered only through fresh public workspace reads", async () => {
  for (const hook of [
    "stage-synced",
    "transaction-prepared",
    "transaction-committed",
    "transaction-config-replaced",
  ]) {
    const value = await fixture();
    try {
      await expectTransactionCrash(value, registerTeamSource, hook);
      process.env.SKCTL_STATE_DIR = value.state;
      await api.getWorkspace({
        cwd: value.project,
        userConfigPath: value.global,
      });
      const text = await readFile(join(value.project, "skctl.jsonc"), "utf8");
      expect(text === "{}\n").toBe(hook === "stage-synced" || hook === "transaction-prepared");
    } finally {
      delete process.env.SKCTL_STATE_DIR;
      await rm(value.root, { recursive: true, force: true });
    }
  }
}, 30000);
test("TX-003/ST-003 state replacement crash rolls forward a valid public install and rejects stale generation", async () => {
  const value = await installFixture();
  try {
    await expectTransactionCrash(value, installReview, "transaction-committed");
    const statePath = join(value.state, "state.json");
    await writeFile(
      statePath,
      JSON.stringify({ version: 1, generation: 7, installed: [], configs: {} }),
    );
    process.env.SKCTL_STATE_DIR = value.state;
    await expect(
      api.getWorkspace({ cwd: value.project, userConfigPath: value.global }),
    ).rejects.toMatchObject({
      code: "TRANSACTION_CONFLICT",
    });
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});
test("TX-003 state replacement crash rolls installed state forward through an untouched public workspace read", async () => {
  const value = await installFixture();
  try {
    await expectTransactionCrash(value, installReview, "transaction-state-replaced");
    process.env.SKCTL_STATE_DIR = value.state;
    await api.getWorkspace({ cwd: value.project, userConfigPath: value.global });
    const state = JSON.parse(await readFile(join(value.state, "state.json"), "utf8"));
    expect(state.generation).toBe(1);
    expect(state.installed).toHaveLength(1);
    expect(state.installed[0]).toMatchObject({ source: "team", path: "review", kind: "local" });
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});
test("TX-003 a legacy migration combined with uninstall rolls forward once and preserves an unknown state edit", async () => {
  const value = await installFixture();
  try {
    const origin = join(value.project, "skills");
    await mkdir(value.state, { recursive: true });
    await writeFile(
      join(value.state, "state.json"),
      `${JSON.stringify({
        version: 1,
        generation: 4,
        installed: [
          {
            kind: "local",
            source: "team",
            path: "review",
            root: join(origin, "review"),
            name: "review",
            description: "Review",
            digest: "a".repeat(64),
            bindingDigest: new Bun.CryptoHasher("sha256")
              .update(`local\0${origin}\0\0${origin}`)
              .digest("hex"),
          },
        ],
        configs: {},
      })}\n`,
    );
    await expectTransactionCrash(value, uninstallReview, "transaction-committed");
    await writeFile(
      join(value.state, "state.json"),
      JSON.stringify({ version: 1, generation: 9, installed: [], configs: {} }),
    );
    process.env.SKCTL_STATE_DIR = value.state;
    await expect(
      api.getWorkspace({ cwd: value.project, userConfigPath: value.global }),
    ).rejects.toMatchObject({
      code: "TRANSACTION_CONFLICT",
    });
    expect(JSON.parse(await readFile(join(value.state, "state.json"), "utf8"))).toMatchObject({
      version: 1,
      generation: 9,
    });
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});
test("TX-003 a crashed legacy migration and uninstall recovers as one v3 generation advance", async () => {
  const value = await installFixture();
  try {
    const origin = join(value.project, "skills");
    await mkdir(value.state, { recursive: true });
    await writeFile(
      join(value.state, "state.json"),
      `${JSON.stringify({
        version: 1,
        generation: 4,
        installed: [
          {
            kind: "local",
            source: "team",
            path: "review",
            root: join(origin, "review"),
            name: "review",
            description: "Review",
            digest: "a".repeat(64),
            bindingDigest: new Bun.CryptoHasher("sha256")
              .update(`local\0${origin}\0\0${origin}`)
              .digest("hex"),
          },
        ],
        configs: {},
      })}\n`,
    );
    await expectTransactionCrash(value, uninstallReview, "transaction-state-replaced");
    process.env.SKCTL_STATE_DIR = value.state;
    await api.getWorkspace({ cwd: value.project, userConfigPath: value.global });
    expect(JSON.parse(await readFile(join(value.state, "state.json"), "utf8"))).toEqual({
      version: 3,
      generation: 5,
      installed: [],
      configs: {},
    });
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});
test("SCH-001/SCH-002 compose Local and immutable cached Remote Config Sources under public workspace reads", async () => {
  const value = await fixture();
  try {
    const reusable = join(value.root, "reusable");
    await mkdir(reusable, { recursive: true });
    await writeFile(
      join(reusable, "config.jsonc"),
      '{ "sources": { "local": { "kind": "local", "path": "./skills", "root": "" } }, "collections": { "engineering": {} } }\n',
    );
    await writeFile(
      join(value.project, "skctl.jsonc"),
      '{ "configSources": { "local-config": { "kind": "local", "path": "../reusable", "root": "" }, "remote-config": { "kind": "git", "origin": "https://example.test/config.git", "root": "", "ref": "main" } } }\n',
    );
    const digest = "a".repeat(64);
    await mkdir(join(value.state, "configs", digest), { recursive: true });
    await writeFile(
      join(value.state, "configs", digest, "config.jsonc"),
      '{ "sources": { "remote": { "kind": "local", "path": "./skills", "root": "" } }, "collections": { "shared": {} } }\n',
    );
    await writeFile(
      join(value.state, "state.json"),
      JSON.stringify({
        version: 1,
        generation: 0,
        installed: [],
        configs: { "remote-config": { commit: "b".repeat(40), digest } },
      }),
    );
    process.env.SKCTL_STATE_DIR = value.state;
    const workspace = (await api.getWorkspace({ cwd: value.project, userConfigPath: value.global }))
      .value;
    expect(workspace.effective.sources.map((source) => source.id)).toEqual([
      "local-config/local",
      "remote-config/remote",
    ]);
    expect(
      workspace.effective.sources.find((source) => source.id === "remote-config/remote"),
    ).toMatchObject({
      kind: "git",
      origin: "https://example.test/config.git",
      root: "skills",
      ref: "b".repeat(40),
    });
    expect(workspace.effective.collections).toEqual([
      "local-config/engineering",
      "remote-config/shared",
    ]);
    const cache = join(value.state, "configs", digest, "config.jsonc");
    const before = await readFile(cache, "utf8");
    await expect(
      api.registerSource(
        { cwd: value.project, userConfigPath: value.global },
        {
          level: "project",
          id: "remote-config/remote",
          binding: { kind: "local", path: "./skills", root: "" },
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(await readFile(cache, "utf8")).toBe(before);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});
test("SCH-003 rejects duplicate Sources and every duplicate JSONC Collection declaration without mutation", async () => {
  const value = await fixture();
  const user = join(value.root, "user.jsonc");
  try {
    await writeFile(
      user,
      '{ "sources": { "shared": { "kind": "local", "path": "./one", "root": "" } }, "collections": { "one": {} }, "use": ["one"] }\n',
    );
    await writeFile(
      join(value.project, "skctl.jsonc"),
      '{ "sources": { "shared": { "kind": "local", "path": "./two", "root": "" } }, "collections": { "two": {} }, "use": ["two"] }\n',
    );
    process.env.SKCTL_STATE_DIR = value.state;
    await expect(
      api.getWorkspace({ cwd: value.project, userConfigPath: user }),
    ).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    const project = '{ "collections": { "one": {} }, "use": ["two"] }\n';
    await writeFile(join(value.project, "skctl.jsonc"), project);
    await expect(
      api.getWorkspace({ cwd: value.project, userConfigPath: user }),
    ).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
      message: "Collection is declared more than once: one",
    });
    expect(await readFile(join(value.project, "skctl.jsonc"), "utf8")).toBe(project);
    await writeFile(user, "{}\n");
    const local = '{ "collections": { "one": {} } }\n';
    await writeFile(join(value.project, "skctl.local.jsonc"), local);
    await expect(
      api.getWorkspace({ cwd: value.project, userConfigPath: user }),
    ).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
      message: "Collection is declared more than once: one",
    });
    expect(await readFile(join(value.project, "skctl.local.jsonc"), "utf8")).toBe(local);
    const reusable = join(value.root, "reusable");
    await mkdir(reusable);
    await writeFile(join(reusable, "config.jsonc"), '{ "collections": { "shared": {} } }\n');
    const contributed =
      '{ "collections": { "team/shared": {} }, "configSources": { "team": { "kind": "local", "path": "../reusable", "root": "" } } }\n';
    await writeFile(join(value.project, "skctl.jsonc"), contributed);
    await rm(join(value.project, "skctl.local.jsonc"));
    await expect(
      api.getWorkspace({ cwd: value.project, userConfigPath: user }),
    ).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
      message: "Collection is declared more than once: team/shared",
    });
    expect(await readFile(join(value.project, "skctl.jsonc"), "utf8")).toBe(contributed);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});
test("TX-005 reader waits behind a publisher barrier and captures one coherent public workspace", async () => {
  const value = await fixture();
  const release = join(value.root, "release");
  const output = join(value.root, "reader.json");
  try {
    const entry = join(import.meta.dir, "../../src/index.ts");
    const script = `import { registerSource } from ${JSON.stringify(entry)}; await registerSource({ cwd: ${JSON.stringify(value.project)} }, { level: "project", id: "team", binding: { kind: "local", path: "./skills", root: "" } });`;
    const publisher = Bun.spawn({
      cmd: [process.execPath, "--eval", script],
      env: {
        ...process.env,
        SKCTL_STATE_DIR: value.state,
        SKCTL_TEST_BARRIER_AT: "transaction-committed",
        SKCTL_TEST_BARRIER_RELEASE: release,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const lock = join(value.state, "mutation.lock");
    for (let index = 0; index < 500 && !(await Bun.file(lock).exists()); index += 1)
      await Bun.sleep(10);
    expect(await Bun.file(lock).exists()).toBe(true);
    const reader = childWorkspace(value.project, value.state, value.global, output);
    expect(
      await Promise.race([
        reader.exited.then(() => "exited"),
        Bun.sleep(100).then(() => "waiting"),
      ]),
    ).toBe("waiting");
    await writeFile(release, "go");
    expect(
      await Promise.race([
        publisher.exited,
        Bun.sleep(15000).then(() => {
          publisher.kill();
          return -1;
        }),
      ]),
    ).toBe(0);
    expect(
      await Promise.race([
        reader.exited,
        Bun.sleep(15000).then(() => {
          reader.kill();
          return -1;
        }),
      ]),
    ).toBe(0);
    expect(
      JSON.parse(await readFile(output, "utf8")).effective.sources.map(
        (source: { id: string }) => source.id,
      ),
    ).toEqual(["team"]);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
test("TX-001 unmarked orphan staging is removed by a fresh public workspace operation", async () => {
  const value = await fixture();
  try {
    await mkdir(join(value.state, "staging", "orphan"), { recursive: true });
    await writeFile(join(value.state, "staging", "orphan", "0"), "orphan");
    process.env.SKCTL_STATE_DIR = value.state;
    await api.getWorkspace({ cwd: value.project, userConfigPath: value.global });
    await expect(readFile(join(value.state, "staging", "orphan", "0"))).rejects.toThrow();
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});
test("TX-004 tampered marker stage or target conflicts before changing any bytes", async () => {
  const value = await fixture();
  try {
    await expectTransactionCrash(value, registerTeamSource, "transaction-committed");
    const transaction = (await readdir(join(value.state, "transactions"))).find((name) =>
      name.endsWith(".json"),
    )!;
    const markerPath = join(value.state, "transactions", transaction);
    const before = await snapshot(value.root);
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as {
      targets: {
        target: string;
        stage: string;
      }[];
    };
    marker.targets[0]!.stage = join(value.root, "outside");
    await writeFile(markerPath, JSON.stringify(marker));
    process.env.SKCTL_STATE_DIR = value.state;
    await expect(
      api.getWorkspace({ cwd: value.project, userConfigPath: value.global }),
    ).rejects.toMatchObject({
      code: "TRANSACTION_CONFLICT",
    });
    expect(await readFile(join(value.project, "skctl.jsonc"), "utf8")).toBe(before.config);
    marker.targets[0]!.target = join(value.root, "outside-target");
    await writeFile(markerPath, JSON.stringify(marker));
    await expect(
      api.getWorkspace({ cwd: value.project, userConfigPath: value.global }),
    ).rejects.toMatchObject({
      code: "TRANSACTION_CONFLICT",
    });
    expect(await readFile(join(value.project, "skctl.jsonc"), "utf8")).toBe(before.config);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});
test("CFG-001/ST-002 Remote Config adoption publishes cache before pointer and recovers offline after pointer crash", async () => {
  const value = await fixture();
  const bytes = Buffer.from(
    '{ "sources": { "shared": { "kind": "local", "path": "./skills", "root": "" } } }\n',
  );
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  try {
    await writeFile(
      join(value.project, "skctl.jsonc"),
      '{ "configSources": { "remote": { "kind": "git", "origin": "https://example.test/config", "root": "", "ref": "main" } } }\n',
    );
    const entry = join(import.meta.dir, "../../src/storage/state.ts");
    const script = `import {StateCoordinator} from ${JSON.stringify(entry)};const c=new StateCoordinator(${JSON.stringify(value.state)});
      await c.withLock(async()=>{const digest=await c.publishConfig(new Uint8Array(${JSON.stringify([...bytes])}));await c.write({installed:[],configs:{remote:{commit:'${"c".repeat(40)}',digest}}},0)});`;
    const child = Bun.spawn({
      cmd: [process.execPath, "--eval", script],
      env: {
        ...process.env,
        SKCTL_STATE_DIR: value.state,
        SKCTL_TEST_CRASH_AT: "transaction-committed",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(
      await Promise.race([
        child.exited,
        Bun.sleep(15000).then(() => {
          child.kill();
          return -1;
        }),
      ]),
    ).toBe(97);
    expect(await readFile(join(value.state, "configs", digest, "config.jsonc"))).toEqual(bytes);
    process.env.SKCTL_STATE_DIR = value.state;
    const workspace = await api.getWorkspace({
      cwd: value.project,
      userConfigPath: value.global,
    });
    expect(workspace.value.effective.sources.map((source) => source.id)).toEqual(["remote/shared"]);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});
test("CFG-001 immutable Config cache crash never publishes an adoption pointer", async () => {
  const value = await fixture();
  const bytes = Buffer.from("{}\n");
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  try {
    const entry = join(import.meta.dir, "../../src/storage/state.ts");
    const script = `import {StateCoordinator} from ${JSON.stringify(entry)};await new StateCoordinator(${JSON.stringify(value.state)}).publishConfig(new Uint8Array(${JSON.stringify([...bytes])}));process.exit(97);`;
    const child = Bun.spawn({
      cmd: [process.execPath, "--eval", script],
      env: {
        ...process.env,
        SKCTL_STATE_DIR: value.state,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(
      await Promise.race([
        child.exited,
        Bun.sleep(15000).then(() => {
          child.kill();
          return -1;
        }),
      ]),
    ).toBe(97);
    expect(await readFile(join(value.state, "configs", digest, "config.jsonc"))).toEqual(bytes);
    const state = JSON.parse(
      await readFile(join(value.state, "state.json"), "utf8").catch(() => '{"configs":{}}'),
    );
    expect(state.configs.remote).toBeUndefined();
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
test("CFG-001 state-pointer crash rolls an adopted cache forward for an offline fresh Core", async () => {
  const value = await fixture();
  const bytes = Buffer.from('{ "collections": { "shared": {} } }\n');
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  try {
    await writeFile(
      join(value.project, "skctl.jsonc"),
      '{ "configSources": { "remote": { "kind": "git", "origin": "https://example.test/config", "root": "", "ref": "main" } } }\n',
    );
    const entry = join(import.meta.dir, "../../src/storage/state.ts");
    const script = `import {StateCoordinator} from ${JSON.stringify(entry)};const c=new StateCoordinator(${JSON.stringify(value.state)});
      await c.withLock(async()=>{const digest=await c.publishConfig(new Uint8Array(${JSON.stringify([...bytes])}));await c.write({installed:[],configs:{remote:{commit:'${"e".repeat(40)}',digest}}},0)});`;
    const child = Bun.spawn({
      cmd: [process.execPath, "--eval", script],
      env: {
        ...process.env,
        SKCTL_STATE_DIR: value.state,
        SKCTL_TEST_CRASH_AT: "transaction-state-replaced",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(
      await Promise.race([
        child.exited,
        Bun.sleep(15000).then(() => {
          child.kill();
          return -1;
        }),
      ]),
    ).toBe(97);
    expect(await readFile(join(value.state, "configs", digest, "config.jsonc"))).toEqual(bytes);
    process.env.SKCTL_STATE_DIR = value.state;
    expect(
      (
        await api.getWorkspace({
          cwd: value.project,
          userConfigPath: value.global,
        })
      ).value.effective.collections,
    ).toEqual(["remote/shared"]);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});
