import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import * as core from "@skctl/core";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { networkFixture } from "../../skill-core/test/provider/network-fixture";
import { createTuiSession } from "../src/session";
import { createOperationState } from "../src/operation-state";

test("real TUI sessions restore cached Core comparisons without HTTP; expired manual checks resolve only the ref", async () => {
  const fixture = await networkFixture();
  const saved = new Map(
    ["SKCTL_STATE_DIR", "SKCTL_SOURCE_CACHE_DIR", "SKTUI_UPDATE_SCHEDULE_DIR"].map((key) => [
      key,
      process.env[key],
    ]),
  );
  const root = fixture.root;
  process.env.SKCTL_STATE_DIR = join(root, "state");
  process.env.SKCTL_SOURCE_CACHE_DIR = join(root, "cache");
  process.env.SKTUI_UPDATE_SCHEDULE_DIR = join(root, "schedule");
  const environment = { cwd: root, project: root, userConfigPath: join(root, "user.jsonc") };
  const sessions: ReturnType<typeof createTuiSession>[] = [];
  const disposers: (() => void)[] = [];
  function session(workspace: core.WorkspaceView) {
    const value = createRoot((dispose) => {
      disposers.push(dispose);
      return createTuiSession(
        {
          ...core,
          getUpdateBaseline: async () => {
            throw new Error("Core checkUpdate already validates its baseline");
          },
        },
        createOperationState(),
        {
          loading() {},
          applyProjection() {},
          failed(error) {
            throw new Error(error.message);
          },
        },
        environment,
      );
    });
    value.selectUpdatesScope({ kind: "workspace" }, workspace);
    sessions.push(value);
    return value;
  }
  try {
    await core.registerSource(environment, {
      level: "project",
      id: "team",
      binding: { kind: "git", origin: fixture.targetUrl, root: "", ref: "main" },
    });
    const discovery = (await core.discoverSkills(environment, { source: "team" })).value;
    await core.installSkills(environment, {
      source: "team",
      paths: [""],
      exactRevision: discovery.exactRevision,
    });
    const workspace = (await core.getWorkspace(environment)).value;
    const first = session(workspace);
    const before = { requests: fixture.direct, packs: fixture.transfers.length };
    expect(await first.checkUpdates()).toBe(true);
    expect(first.updates()?.group("team")?.status).toBe("no-changes");
    await first.teardown();
    expect(fixture.direct).toBe(before.requests);
    const schedule = await readFile(join(root, "schedule/update-schedule-v1.json"), "utf8");
    const state = await readFile(join(root, "state/state.json"), "utf8");
    const key = new Bun.CryptoHasher("sha256").update(fixture.targetUrl).digest("hex");
    const indexPath = join(root, "cache/origins", key, "cache.json");
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    index.refs.main.observedAt = Date.now() - 31_000;
    await writeFile(indexPath, JSON.stringify(index));
    // The Core ref TTL has expired but the TUI schedule has not. A mistaken
    // current check now makes real HTTP requests and fails the zero-I/O assertion.
    const second = session(workspace);
    await second.startUpdateChecks(workspace);
    for (let pass = 0; second.checkingActive() && pass < 300; pass++) await Bun.sleep(10);
    expect(second.checkingActive()).toBe(false);
    expect(second.updates()?.group("team")?.status).toBe("no-changes");
    expect(fixture.direct).toBe(before.requests);
    expect(fixture.transfers).toHaveLength(before.packs);
    await second.teardown();
    expect(await readFile(join(root, "schedule/update-schedule-v1.json"), "utf8")).toBe(schedule);

    const third = session(workspace);
    expect(await third.checkUpdates()).toBe(true);
    expect(fixture.direct).toBeGreaterThan(before.requests);
    expect(fixture.transfers).toHaveLength(before.packs);
    expect(third.updates()?.group("team")?.status).toBe("no-changes");
    expect(await readFile(join(root, "state/state.json"), "utf8")).toBe(state);
  } finally {
    await Promise.all(sessions.map((value) => value.teardown()));
    for (const dispose of disposers) dispose();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fixture.close();
  }
}, 30_000);
