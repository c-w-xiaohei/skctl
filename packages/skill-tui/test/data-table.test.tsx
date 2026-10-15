/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BoxRenderable, ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { KeyCodes } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { DataTable, type DataTableColumn } from "../src/ui/data-table";
import { createFocusRegistry } from "../src/focus";
import { parseNavKey } from "../src/navigation";
import { workspaceProjection } from "./direct-source.fixture";
import { theme } from "../src/ui/theme";

type Row = { id: string; name: string; status: string; count: number; selectable?: boolean };
const columns: readonly DataTableColumn<Row>[] = [
  { id: "name", header: "Source", cell: (row) => row.name, minWidth: 12 },
  {
    id: "status",
    header: "Status",
    cell: (row) => ({ text: row.status, tone: "success" }),
    width: 10,
  },
  {
    id: "count",
    header: "Updates",
    cell: (row) => String(row.count),
    width: 7,
    align: "right",
    optional: true,
  },
];
const rows: readonly Row[] = [
  { id: "a", name: "aaron-marketing", status: "Ready", count: 120 },
  { id: "b", name: "dev-kit", status: "Up to date", count: 0, selectable: false },
  { id: "c", name: "中文👨‍👩‍👧‍👦工具", status: "Ready", count: 3 },
];
type Setup = Awaited<ReturnType<typeof testRender>>;
async function frames(setup: Setup) {
  // Layout measurement and reveal both use native frame boundaries.
  for (let i = 0; i < 3; i++) await setup.renderOnce();
}

test("RENDER table aligns headers and data using container width, and adapts without losing the current row", async () => {
  const [width, setWidth] = createSignal(50);
  const [current, setCurrent] = createSignal<string | undefined>("c");
  const setup = await testRender(
    () => (
      <box width={width()} height={8}>
        <DataTable
          id="table"
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          currentKey={current()}
          onCurrentChange={setCurrent}
        />
      </box>
    ),
    { width: 100, height: 10 },
  );
  try {
    await frames(setup);
    const header = setup.renderer.root.findDescendantById("table-header-status") as TextRenderable;
    const cell = setup.renderer.root.findDescendantById(
      "table-row-a:cell-status",
    ) as TextRenderable;
    expect(header.screenX).toBe(cell.screenX);
    const count = setup.renderer.root.findDescendantById(
      "table-row-a:cell-count",
    ) as TextRenderable;
    expect(count.screenX + count.width).toBeLessThanOrEqual(50);
    const frame = setup.captureCharFrame().split("\n");
    expect(frame[0]!.indexOf("Updates")).toBe(frame[1]!.indexOf("120") - 4);
    setWidth(27);
    await frames(setup);
    expect(setup.renderer.root.findDescendantById("table-header-count")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("table-header-status")).toBeDefined();
    expect(current()).toBe("c");
    expect(setup.captureCharFrame()).toContain("中文");
    setWidth(10);
    await frames(setup);
    expect(setup.renderer.root.findDescendantById("table-size-warning")).toBeDefined();
    expect(current()).toBe("c");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER keyboard navigation never activates a row until Enter, and leaves Tab and modified keys to the app", async () => {
  const [current, setCurrent] = createSignal<string | undefined>("a");
  const activated: string[] = [];
  const setup = await testRender(
    () => (
      <DataTable
        id="table"
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        currentKey={current()}
        onCurrentChange={setCurrent}
        onActivate={(row) => activated.push(row.id)}
      />
    ),
    { width: 60, height: 8 },
  );
  try {
    await frames(setup);
    const root = setup.renderer.root.findDescendantById("table") as BoxRenderable;
    root.focus();
    setup.mockInput.pressArrow("down");
    expect(current()).toBe("b");
    setup.mockInput.pressArrow("down", { ctrl: true });
    expect(current()).toBe("b");
    setup.mockInput.pressTab();
    expect(current()).toBe("b");
    expect(activated).toEqual([]);
    setup.mockInput.pressEnter();
    expect(activated).toEqual(["b"]);
    setup.mockInput.pressKey(KeyCodes.HOME);
    expect(current()).toBe("a");
    setup.mockInput.pressKey(KeyCodes.END);
    expect(current()).toBe("c");
    expect(activated).toEqual(["b"]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER pointer row presses only locate; checkbox and Space request controlled selection once", async () => {
  const [current, setCurrent] = createSignal<string | undefined>("a");
  const [keys, setKeys] = createSignal<ReadonlySet<string>>(new Set(["hidden"]));
  const toggled: string[] = [],
    activated: string[] = [];
  const toggle = (row: Row) => {
    toggled.push(row.id);
    setKeys((prior) => {
      const next = new Set(prior);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  };
  const setup = await testRender(
    () => (
      <DataTable
        id="table"
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        currentKey={current()}
        onCurrentChange={setCurrent}
        onActivate={(row) => activated.push(row.id)}
        selection={{ keys: keys(), canSelect: (row) => row.selectable !== false, onToggle: toggle }}
      />
    ),
    { width: 60, height: 8 },
  );
  try {
    await frames(setup);
    const name = setup.renderer.root.findDescendantById("table-row-c:cell-name")!;
    await setup.mockMouse.click(name.screenX + 1, name.screenY);
    expect(current()).toBe("c");
    expect(toggled).toEqual([]);
    expect(activated).toEqual([]);
    setup.mockInput.pressKey(" ");
    expect(toggled).toEqual(["c"]);
    expect(keys().has("hidden")).toBe(true);
    await frames(setup);
    const checkbox = setup.renderer.root.findDescendantById("table-row-a:check")!;
    await setup.mockMouse.click(checkbox.screenX + 1, checkbox.screenY);
    expect(toggled).toEqual(["c", "a"]);
    expect(current()).toBe("a");
    const disabled = setup.renderer.root.findDescendantById("table-row-b:check")!;
    await setup.mockMouse.click(disabled.screenX + 1, disabled.screenY);
    expect(current()).toBe("b");
    setup.mockInput.pressKey(" ");
    expect(toggled).toEqual(["c", "a"]);
    expect(activated).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER 120 rows scroll by native viewport, keep the header fixed, and mouse scrolling does not steal focus", async () => {
  const many = Array.from({ length: 120 }, (_, index) => ({
    ...rows[0]!,
    id: String(index),
    name: `Skill ${index}`,
  }));
  const [current, setCurrent] = createSignal<string | undefined>("0");
  const setup = await testRender(
    () => (
      <DataTable
        id="table"
        rows={many}
        columns={columns}
        rowKey={(row) => row.id}
        currentKey={current()}
        onCurrentChange={setCurrent}
      />
    ),
    { width: 60, height: 10 },
  );
  try {
    await frames(setup);
    const root = setup.renderer.root.findDescendantById("table") as BoxRenderable;
    const body = setup.renderer.root.findDescendantById("table-body") as ScrollBoxRenderable;
    root.focus();
    setup.mockInput.pressKey("\u001b[6~");
    await setup.waitFor(() => current() !== "0");
    expect(current()).toBe(String(body.viewport.height));
    setup.mockInput.pressKey(KeyCodes.END);
    await frames(setup);
    expect(current()).toBe("119");
    expect(body.scrollTop).toBeGreaterThan(100);
    expect(setup.captureCharFrame()).toContain("Skill 119");
    expect(setup.captureCharFrame().split("\n")[0]).toContain("Source");
    const row = setup.renderer.root.findDescendantById("table-row-119")!;
    expect(row.screenY).toBeGreaterThanOrEqual(body.viewport.screenY);
    expect(row.screenY + row.height).toBeLessThanOrEqual(
      body.viewport.screenY + body.viewport.height,
    );
    await setup.mockMouse.scroll(body.viewport.screenX + 3, body.viewport.screenY + 2, "up");
    await frames(setup);
    expect(current()).toBe("119");
    expect(setup.renderer.currentFocusedRenderable).toBe(root);
    expect(body.scrollTop).toBeLessThan(111);
    const visible = body.content
      .getChildren()
      .find(
        (item) =>
          item.screenY >= body.viewport.screenY &&
          item.screenY < body.viewport.screenY + body.viewport.height,
      )!;
    const wanted = visible.id.slice("table-row-".length);
    await setup.mockMouse.click(visible.screenX + 3, visible.screenY);
    expect(current()).toBe(wanted);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER stable row keys survive reordering, choose the nearest remaining row, and clear an empty table safely", async () => {
  const [data, setData] = createSignal<readonly Row[]>(rows);
  const [current, setCurrent] = createSignal<string | undefined>("b");
  const activated: string[] = [];
  const setup = await testRender(
    () => (
      <DataTable
        id="table"
        rows={data()}
        columns={columns}
        rowKey={(row) => row.id}
        currentKey={current()}
        onCurrentChange={setCurrent}
        onActivate={(row) => activated.push(row.id)}
        emptyText="No Sources"
      />
    ),
    { width: 60, height: 8 },
  );
  try {
    await frames(setup);
    setData([rows[2]!, rows[0]!, rows[1]!]);
    await frames(setup);
    expect(current()).toBe("b");
    setData([rows[2]!, rows[0]!]);
    await frames(setup);
    expect(current()).toBe("a");
    setData([]);
    await frames(setup);
    expect(current()).toBeUndefined();
    const root = setup.renderer.root.findDescendantById("table") as BoxRenderable;
    root.focus();
    setup.mockInput.pressEnter();
    setup.mockInput.pressArrow("down");
    expect(activated).toEqual([]);
    expect(setup.captureCharFrame()).toContain("No Sources");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER table hands boundary arrows to adjacent page controls without replacing its navigation owner", async () => {
  const [current, setCurrent] = createSignal<string | undefined>("a");
  const boundaries: string[] = [];
  const setup = await testRender(
    () => (
      <DataTable
        id="table"
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        currentKey={current()}
        onCurrentChange={setCurrent}
        onBoundary={(direction) => boundaries.push(direction)}
      />
    ),
    { width: 60, height: 8 },
  );
  try {
    await frames(setup);
    (setup.renderer.root.findDescendantById("table") as BoxRenderable).focus();
    setup.mockInput.pressArrow("up");
    expect(boundaries).toEqual(["up"]);
    setup.mockInput.pressArrow("down");
    expect(current()).toBe("b");
    expect(boundaries).toEqual(["up"]);
    setup.mockInput.pressKey(KeyCodes.END);
    setup.mockInput.pressArrow("down");
    expect(current()).toBe("c");
    expect(boundaries).toEqual(["up", "down"]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER table restores a page-owned viewport across remounts without resetting it on status changes", async () => {
  const many = Array.from({ length: 120 }, (_, index) => ({
    ...rows[0]!,
    id: String(index),
    name: `Skill ${index}`,
  }));
  const [data, setData] = createSignal(many);
  const [mounted, setMounted] = createSignal(true);
  const [current, setCurrent] = createSignal<string | undefined>("64");
  let savedScroll = 60;
  const setup = await testRender(
    () => (
      <Show when={mounted()}>
        <DataTable
          id="table"
          rows={data()}
          columns={columns}
          rowKey={(row) => row.id}
          currentKey={current()}
          onCurrentChange={setCurrent}
          initialScrollTop={savedScroll}
          onScroll={(top) => {
            savedScroll = top;
          }}
        />
      </Show>
    ),
    { width: 60, height: 10 },
  );
  try {
    await frames(setup);
    const body = setup.renderer.root.findDescendantById("table-body") as ScrollBoxRenderable;
    expect(body.scrollTop).toBe(60);
    body.scrollTo(80);
    await frames(setup);
    expect(savedScroll).toBe(80);
    setData(many.map((row) => ({ ...row, status: "Checking" })));
    await frames(setup);
    expect(body.scrollTop).toBe(80);
    setMounted(false);
    await frames(setup);
    setMounted(true);
    await frames(setup);
    const restored = setup.renderer.root.findDescendantById("table-body") as ScrollBoxRenderable;
    expect(restored.scrollTop).toBe(80);
    expect(current()).toBe("64");
    (setup.renderer.root.findDescendantById("table") as BoxRenderable).focus();
    setup.mockInput.pressArrow("up");
    await frames(setup);
    expect(current()).toBe("63");
    expect(restored.scrollTop).toBe(63);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER application mode dispatch consumes each event once and unregisters on unmount", async () => {
  const registry = createFocusRegistry();
  const [mounted, setMounted] = createSignal(true);
  const [current, setCurrent] = createSignal<string | undefined>("a");
  const activated: string[] = [];
  const setup = await testRender(
    () => (
      <Show when={mounted()} fallback={<text>Unmounted</text>}>
        <DataTable
          id="table"
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          currentKey={current()}
          onCurrentChange={setCurrent}
          onActivate={(row) => activated.push(row.id)}
          focusRegistry={registry}
        />
      </Show>
    ),
    { width: 60, height: 8 },
  );
  try {
    await frames(setup);
    const root = setup.renderer.root.findDescendantById("table") as BoxRenderable;
    const mountedListeners = setup.renderer.listenerCount("frame");
    root.focus();
    const dispatch = (
      event: Parameters<typeof parseNavKey>[0] & {
        preventDefault(): void;
        stopPropagation(): void;
      },
    ) => {
      if (
        registry.dispatchMode(
          setup.renderer.currentFocusedRenderable ?? undefined,
          parseNavKey(event),
        ) === "consumed"
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    setup.renderer.keyInput.on("keypress", dispatch);
    try {
      setup.mockInput.pressArrow("down");
      expect(current()).toBe("b");
      setup.mockInput.pressEnter();
      expect(activated).toEqual(["b"]);
      expect(registry.dispatchMode(root, parseNavKey({ name: "tab" }))).toBe("declined");
      setMounted(false);
      await frames(setup);
      expect(registry.dispatchMode(root, parseNavKey({ name: "enter" }))).toBe("declined");
      expect(setup.renderer.listenerCount("frame")).toBeLessThan(mountedListeners);
    } finally {
      setup.renderer.keyInput.off("keypress", dispatch);
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER actual workspace Source and installed-Skill types share one table without exposing Core to the component", async () => {
  const projection = workspaceProjection();
  const [source, setSource] = createSignal<string | undefined>();
  const [skill, setSkill] = createSignal<string | undefined>();
  const sourceColumns: readonly DataTableColumn<(typeof projection.effective.sources)[number]>[] = [
    { id: "source", header: "Source", cell: (row) => row.id },
    { id: "kind", header: "Kind", cell: (row) => row.kind, width: 8 },
  ];
  const skillColumns: readonly DataTableColumn<(typeof projection.installedSkills)[number]>[] = [
    { id: "skill", header: "Skill", cell: (row) => row.name },
    { id: "source", header: "Source", cell: (row) => row.address.source, width: 18 },
  ];
  const setup = await testRender(
    () => (
      <box flexDirection="row" height={8}>
        <DataTable
          id="sources"
          width="50%"
          rows={projection.effective.sources}
          columns={sourceColumns}
          rowKey={(row) => row.id}
          currentKey={source()}
          onCurrentChange={setSource}
        />
        <DataTable
          id="skills"
          width="50%"
          rows={projection.installedSkills}
          columns={skillColumns}
          rowKey={(row) => `${row.address.source}/${row.address.path}`}
          currentKey={skill()}
          onCurrentChange={setSkill}
          emptyText="No installed Skills"
        />
      </box>
    ),
    { width: 100, height: 10 },
  );
  try {
    await frames(setup);
    expect(source()).toBe(projection.effective.sources[0]!.id);
    expect(setup.captureCharFrame()).toContain("team-main");
    expect(setup.renderer.root.findDescendantById("sources-header-source")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("skills-header-skill")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER row/cell identities cannot collide and clipped tables cannot activate hidden content", async () => {
  const data = [{ ...rows[0]!, id: "a:cell-status" }, rows[0]!];
  const [height, setHeight] = createSignal(8);
  const [current, setCurrent] = createSignal<string | undefined>("a");
  let activated = 0,
    toggled = 0;
  const setup = await testRender(
    () => (
      <DataTable
        id="table"
        height={height()}
        rows={data}
        columns={columns}
        rowKey={(row) => row.id}
        currentKey={current()}
        onCurrentChange={setCurrent}
        onActivate={() => activated++}
        selection={{ keys: new Set(), onToggle: () => toggled++ }}
      />
    ),
    { width: 60, height: 8 },
  );
  try {
    await frames(setup);
    expect(setup.renderer.root.findDescendantById("table-row-a%3Acell-status")).toBeInstanceOf(
      BoxRenderable,
    );
    expect(setup.renderer.root.findDescendantById("table-row-a:cell-status")).toBeInstanceOf(
      TextRenderable,
    );
    setHeight(1);
    await frames(setup);
    const root = setup.renderer.root.findDescendantById("table") as BoxRenderable;
    expect(root.height).toBe(1);
    expect(setup.renderer.root.findDescendantById("table-row-a")).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("More height needed");
    root.focus();
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey(" ");
    expect(activated).toBe(0);
    expect(toggled).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER terminal frames cover themes, compact containers and selection without a second renderer", async () => {
  const output = process.env.DATA_TABLE_CAPTURE_DIR;
  const priorTokens = theme.get();
  const modes = ["dark", "light"] as const;
  try {
    for (const mode of modes) {
      theme.setMode(mode);
      for (const width of [80, 43, 27]) {
        const [current, setCurrent] = createSignal<string | undefined>("a");
        const setup = await testRender(
          () => (
            <DataTable
              id="table"
              rows={rows}
              columns={columns}
              rowKey={(row) => row.id}
              currentKey={current()}
              onCurrentChange={setCurrent}
            />
          ),
          { width, height: 12 },
        );
        try {
          await frames(setup);
          (setup.renderer.root.findDescendantById("table") as BoxRenderable).focus();
          await frames(setup);
          const root = setup.renderer.root.findDescendantById("table")!;
          const body = setup.renderer.root.findDescendantById("table-body") as ScrollBoxRenderable;
          const cell = setup.renderer.root.findDescendantById(
            "table-row-a:cell-status",
          ) as TextRenderable;
          expect(cell.screenX + cell.width).toBeLessThanOrEqual(root.screenX + root.width);
          expect(body.verticalScrollBar.focusable).toBe(false);
          expect(body.verticalScrollBar.slider.focusable).toBe(false);
          const focused = setup.captureSpans();
          expect(focused.cols).toBe(width);
          const value = setup.captureCharFrame();
          expect(value).toContain("Ready");
          if (output) {
            await mkdir(output, { recursive: true });
            const name = `${mode}-${width}x12`;
            await writeFile(join(output, `${name}.txt`), value);
            await writeFile(join(output, `${name}.json`), JSON.stringify(focused, null, 2));
          }
          root.blur();
          await frames(setup);
          expect(setup.captureSpans().lines).not.toEqual(focused.lines);
        } finally {
          setup.renderer.destroy();
        }
      }
    }
  } finally {
    theme.setMode("system");
    // Restore the terminal/system baseline shared by renderer tests.
    expect(theme.get()).toEqual(priorTokens);
  }
});
