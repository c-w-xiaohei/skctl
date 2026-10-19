/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { BoxRenderable, TextRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { batch, createSignal } from "solid-js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DataTable, type DataTableColumn } from "../src/ui/data-table";
import { SourceUpdatesPage } from "../src/updates/page";
import { buildUpdateScope, createUpdatesState } from "../src/updates/model";
import { workspaceProjection } from "./direct-source.fixture";

test("PERF 120 selected Skills cache scope derivations instead of reading them per row or movement", async () => {
  const skills = Array.from({ length: 120 }, (_, index) => ({
    address: { source: "team-main", path: `skill-${index}` },
    name: `Skill ${index}`,
    description: `Installed ${index}`,
    owner: { source: "team-main", health: "healthy" as const },
    collections: [],
    selectors: [],
    selectorViews: { status: "complete" as const, values: [] },
    aliases: [],
    problems: [],
  }));
  const state = createUpdatesState(
    buildUpdateScope(
      { ...workspaceProjection(), installedSkills: skills },
      { kind: "source", source: "team-main" },
    ),
  );
  state.observe({
    source: "team-main",
    kind: "github",
    changed: skills.map((skill) => ({
      path: skill.address.path,
      name: skill.name,
      description: skill.description,
    })),
    unchanged: [],
    removed: [],
    added: [],
    baseline: "baseline:test",
  });
  batch(() => skills.forEach((skill) => state.toggle(skill.address)));
  let guardReads = 0;
  Object.defineProperty(state, "scope", {
    get() {
      guardReads++;
      return state.scopeSnapshot();
    },
  });
  const started = performance.now();
  const setup = await testRender(
    () => (
      <SourceUpdatesPage
        state={state}
        source="team-main"
        skills={skills}
        query=""
        filter="updates"
        onQuery={() => {}}
        onFilter={() => {}}
        onSourceDetails={() => {}}
        onCheck={() => {}}
        onUpdate={() => {}}
        onStop={() => {}}
        onRetry={() => {}}
      />
    ),
    { width: 80, height: 24, gatherStats: true },
  );
  try {
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    const mountMs = performance.now() - started;
    const mountReads = guardReads;
    const root = setup.renderer.root.findDescendantById("source-updates-browser") as BoxRenderable;
    const statusHeader = setup.renderer.root.findDescendantById(
      "source-updates-browser-header-status",
    ) as TextRenderable | undefined;
    expect(statusHeader?.plainText).toBe("Status");
    root.focus();
    const keyStarted = performance.now();
    for (let i = 0; i < 10; i++) {
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
    }
    const navigationMs = performance.now() - keyStarted;
    console.log(
      JSON.stringify({
        scenario: "120 selected Skills",
        mountMs,
        navigationMs,
        mountReads,
        totalScopeReads: guardReads,
        frameStats: setup.renderer.getStats().averageFrameTime,
      }),
    );
    expect(state.selected()).toHaveLength(120);
    expect(mountReads).toBeLessThanOrEqual(8);
    expect(guardReads).toBe(mountReads);
    const capture = process.env.QUIET_UPDATE_CAPTURE_DIR;
    if (capture) {
      state.clearSelection();
      for (let frame = 0; frame < 3; frame++) await setup.renderOnce();
      await mkdir(capture, { recursive: true });
      await writeFile(join(capture, "source-120-skills-80x24.txt"), setup.captureCharFrame());
      await writeFile(
        join(capture, "source-120-skills-80x24.json"),
        JSON.stringify(setup.captureSpans(), null, 2),
      );
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("PERF keyed row renderables survive fresh data objects and cursor movement does not reevaluate cells", async () => {
  const initial = Array.from({ length: 120 }, (_, index) => ({
    id: String(index),
    label: `Skill ${index}`,
  }));
  const [rows, setRows] = createSignal(initial);
  const [current, setCurrent] = createSignal<string | undefined>("0");
  let evaluations = 0;
  const columns: readonly DataTableColumn<(typeof initial)[number]>[] = [
    {
      id: "name",
      header: "Skill",
      cell: (row) => {
        evaluations++;
        return row.label;
      },
    },
  ];
  const setup = await testRender(
    () => (
      <DataTable
        id="table"
        rows={rows()}
        columns={columns}
        rowKey={(row) => row.id}
        currentKey={current()}
        onCurrentChange={setCurrent}
      />
    ),
    { width: 60, height: 12 },
  );
  try {
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    const retained = setup.renderer.root.findDescendantById("table-row-0");
    setRows(initial.map((row) => ({ ...row })));
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("table-row-0") === retained).toBe(true);
    const prior = evaluations;
    (setup.renderer.root.findDescendantById("table") as BoxRenderable).focus();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(evaluations).toBe(prior);
    expect(current()).toBe("1");
    expect(setup.renderer.getSchedulerState().isRunning).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

test("PERF DataTable itself evaluates a reactive selection configuration once and isolates membership from eligibility", async () => {
  const data = Array.from({ length: 120 }, (_, index) => ({ id: String(index) }));
  const [current, setCurrent] = createSignal<string | undefined>("0");
  const [checked, setChecked] = createSignal<ReadonlySet<string>>(new Set());
  const [enabled, setEnabled] = createSignal(true);
  let configurations = 0,
    eligibilityReads = 0;
  const predicate = () => {
    eligibilityReads++;
    return enabled();
  };
  const configure = () => {
    configurations++;
    return {
      keys: checked(),
      canSelect: predicate,
      onToggle: (row: (typeof data)[number]) => setChecked(new Set([row.id])),
    };
  };
  const setup = await testRender(
    () => (
      <DataTable
        id="table"
        rows={data}
        columns={[{ id: "name", header: "Skill", cell: (row) => row.id }]}
        rowKey={(row) => row.id}
        currentKey={current()}
        onCurrentChange={setCurrent}
        selection={configure()}
      />
    ),
    { width: 60, height: 12 },
  );
  try {
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    expect(configurations).toBe(1);
    expect(eligibilityReads).toBe(120);
    (setup.renderer.root.findDescendantById("table") as BoxRenderable).focus();
    for (let i = 0; i < 10; i++) setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(configurations).toBe(1);
    expect(eligibilityReads).toBe(120);
    setChecked(new Set(["10"]));
    await setup.renderOnce();
    expect(configurations).toBe(2);
    expect(eligibilityReads).toBe(120);
    setEnabled(false);
    await setup.renderOnce();
    expect(eligibilityReads).toBe(240);
    setup.mockInput.pressKey(" ");
    expect(checked()).toEqual(new Set(["10"]));
  } finally {
    setup.renderer.destroy();
  }
});

test("PERF resize and column reorder retain visible cells without evaluating row content", async () => {
  const [width, setWidth] = createSignal(60);
  const [current, setCurrent] = createSignal<string | undefined>("a");
  let evaluations = 0;
  const initial: readonly DataTableColumn<{ id: string }>[] = [
    {
      id: "name",
      header: "Skill",
      cell: (row) => {
        evaluations++;
        return row.id;
      },
    },
    {
      id: "status",
      header: "Status",
      width: 10,
      cell: () => {
        evaluations++;
        return { text: "Ready", tone: "success" };
      },
    },
  ];
  const [columns, setColumns] = createSignal(initial);
  const setup = await testRender(
    () => (
      <box width={width()} height={8}>
        <DataTable
          id="table"
          rows={[{ id: "a" }]}
          columns={columns()}
          rowKey={(row) => row.id}
          currentKey={current()}
          onCurrentChange={setCurrent}
        />
      </box>
    ),
    { width: 80, height: 10 },
  );
  try {
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    const cell = setup.renderer.root.findDescendantById("table-row-a:cell-name")!;
    const header = setup.renderer.root.findDescendantById("table-header-name")!;
    const prior = evaluations;
    setWidth(45);
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("table-row-a:cell-name") === cell).toBe(true);
    expect(setup.renderer.root.findDescendantById("table-header-name") === header).toBe(true);
    expect(evaluations).toBe(prior);
    setColumns([initial[1]!, initial[0]!]);
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("table-row-a:cell-name") === cell).toBe(true);
    expect(evaluations).toBe(prior);
    expect(cell.screenX).toBeGreaterThan(
      setup.renderer.root.findDescendantById("table-row-a:cell-status")!.screenX,
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("PERF one replaced row and a reorder only evaluate changed row data", async () => {
  const initial = Array.from({ length: 120 }, (_, index) => ({
    id: String(index),
    label: `Skill ${index}`,
  }));
  const [rows, setRows] = createSignal(initial);
  const [current, setCurrent] = createSignal<string | undefined>("0");
  let evaluations = 0;
  const columns: readonly DataTableColumn<(typeof initial)[number]>[] = [
    {
      id: "name",
      header: "Skill",
      cell: (row) => {
        evaluations++;
        return row.label;
      },
    },
  ];
  const setup = await testRender(
    () => (
      <DataTable
        id="table"
        rows={rows()}
        columns={columns}
        rowKey={(row) => row.id}
        currentKey={current()}
        onCurrentChange={setCurrent}
      />
    ),
    { width: 60, height: 12 },
  );
  try {
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    const prior = evaluations;
    setRows(initial.map((row) => (row.id === "0" ? { ...row, label: "Changed" } : row)));
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    expect(evaluations).toBe(prior + 1);
    expect(
      (setup.renderer.root.findDescendantById("table-row-0:cell-name") as TextRenderable).plainText,
    ).toBe("Changed");
    setRows((rows) => [...rows].reverse());
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    expect(evaluations).toBe(prior + 1);
    expect(current()).toBe("0");
  } finally {
    setup.renderer.destroy();
  }
});

test("PERF parent callback reads do not become cursor reconciliation dependencies", async () => {
  const [unrelated, setUnrelated] = createSignal(0);
  let reports = 0;
  const setup = await testRender(
    () => (
      <DataTable
        id="table"
        rows={[{ id: "a" }]}
        columns={[{ id: "name", header: "Skill", cell: (row) => row.id }]}
        rowKey={(row) => row.id}
        currentKey={undefined}
        onCurrentChange={() => {
          unrelated();
          reports++;
        }}
      />
    ),
    { width: 60, height: 12 },
  );
  try {
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    expect(reports).toBe(1);
    setUnrelated(1);
    await setup.renderOnce();
    expect(reports).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("PERF retained columns receive fresh definitions instead of capturing stale headers and cells", async () => {
  const [current, setCurrent] = createSignal<string | undefined>("a");
  const [columns, setColumns] = createSignal<readonly DataTableColumn<{ id: string }>[]>([
    { id: "name", header: "Skill", cell: (row) => row.id },
  ]);
  const setup = await testRender(
    () => (
      <DataTable
        id="table"
        rows={[{ id: "a" }]}
        columns={columns()}
        rowKey={(row) => row.id}
        currentKey={current()}
        onCurrentChange={setCurrent}
      />
    ),
    { width: 60, height: 12 },
  );
  try {
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    const header = setup.renderer.root.findDescendantById("table-header-name") as TextRenderable;
    const cell = setup.renderer.root.findDescendantById("table-row-a:cell-name") as TextRenderable;
    setColumns([
      {
        id: "name",
        header: "Renamed",
        align: "right",
        cell: (row) => ({ text: `Fresh ${row.id}`, tone: "warning" }),
      },
    ]);
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("table-header-name") === header).toBe(true);
    expect(setup.renderer.root.findDescendantById("table-row-a:cell-name") === cell).toBe(true);
    expect(header.plainText).toBe("Renamed");
    expect(cell.plainText).toBe("Fresh a");
    expect(cell.textAlign).toBe("right");
  } finally {
    setup.renderer.destroy();
  }
});
