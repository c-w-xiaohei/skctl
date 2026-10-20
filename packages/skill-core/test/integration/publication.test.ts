import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { StateCoordinator } from "../../src/storage/state";
import { runProcess } from "../../src/runtime/process";

async function fixture() {
  await mkdir("/tmp/opencode", { recursive: true });
  const root = await mkdtemp("/tmp/opencode/skctl-publication-");
  const state = join(root, "state"),
    project = join(root, "skctl.jsonc"),
    global = join(root, "config.jsonc");
  await writeFile(project, "{}\n");
  await writeFile(global, "{}\n");
  return { root, state, project, global };
}

test("committed transactions recover all targets after process death, while prepared transactions leave originals", async () => {
  for (const phase of [
    "transaction-prepared",
    "transaction-committed",
    "transaction-config-replaced",
    "transaction-state-replaced",
  ]) {
    const value = await fixture();
    const source = resolve("packages/skill-core/src/storage/state.ts");
    const next = { version: 3, generation: 1, installed: [], configs: {} };
    const script = `import {StateCoordinator} from ${JSON.stringify(source)};const c=new StateCoordinator(${JSON.stringify(value.state)});await c.publish(${JSON.stringify(
      [
        { target: value.project, bytes: '{"collections":{"new":{}}}\n' },
        { target: value.global, bytes: '{"use":[]}\n' },
        { target: join(value.state, "state.json"), bytes: JSON.stringify(next) },
      ],
    )},0);`;
    const child = await runProcess({
      cmd: [process.execPath, "-e", script],
      env: { ...process.env, SKCTL_TEST_CRASH_AT: phase },
    });
    expect(child.status).toBe(97);
    const coordinator = new StateCoordinator(value.state);
    await coordinator.withLock(async () => {});
    expect(JSON.parse(await readFile(value.project, "utf8"))).toEqual(
      phase === "transaction-prepared" ? {} : { collections: { new: {} } },
    );
    expect((await coordinator.read()).generation).toBe(phase === "transaction-prepared" ? 0 : 1);
    expect(await readdir(join(value.state, "transactions"))).toEqual([]);
    expect(await readdir(join(value.state, "staging"))).toEqual([]);
  }
});

test("recovery never overwrites human edits or publishes any target after a stage is corrupted", async () => {
  for (const failure of ["human-edit", "stage-corruption"]) {
    const value = await fixture();
    const source = resolve("packages/skill-core/src/storage/state.ts");
    const script = `import {StateCoordinator} from ${JSON.stringify(source)};await new StateCoordinator(${JSON.stringify(value.state)}).publish(${JSON.stringify(
      [
        { target: value.project, bytes: '{"collections":{}}\n' },
        { target: value.global, bytes: '{"use":[]}\n' },
      ],
    )});`;
    expect(
      (
        await runProcess({
          cmd: [process.execPath, "-e", script],
          env: { ...process.env, SKCTL_TEST_CRASH_AT: "transaction-committed" },
        })
      ).status,
    ).toBe(97);
    if (failure === "human-edit") await writeFile(value.project, '{"manual":true}');
    else {
      const [id] = await readdir(join(value.state, "staging"));
      await writeFile(join(value.state, "staging", id!, "1"), "corrupted");
    }
    await expect(new StateCoordinator(value.state).withLock(async () => {})).rejects.toHaveProperty(
      "code",
      "TRANSACTION_CONFLICT",
    );
    expect(await readFile(value.global, "utf8")).toBe("{}\n");
  }
});
