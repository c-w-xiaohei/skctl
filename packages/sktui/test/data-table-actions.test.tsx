/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { BoxRenderable } from "@opentui/core";
import { testRender, useKeyboard, useRenderer } from "@opentui/solid";
import { createSignal, onCleanup } from "solid-js";
import { DataTable } from "../src/ui/data-table";
import { createFocusRegistry } from "../src/focus";
import { parseNavKey } from "../src/navigation";
import type { CommandRecord } from "../src/types";
import { parsedEscape } from "./reader-test-controls";

const rows = [
  { id: "one", name: "long-member-中文👨‍👩‍👧‍👦-one", removable: true },
  { id: "two", name: "second-member", removable: false },
];
const actionId = (row: string, action: string) =>
  `action-table-row-${row}:action-${encodeURIComponent(`${row}.${action}`)}`;

async function fixture(width: number) {
  const registry = createFocusRegistry();
  const [current, setCurrent] = createSignal<string | undefined>("one");
  const [checked, setChecked] = createSignal<ReadonlySet<string>>(new Set(["two"]));
  const calls: string[] = [];
  const records = new Map<
    string,
    { record: CommandRecord; controlId: string; execute: () => void }
  >();
  const Surface = () => {
    const renderer = useRenderer();
    useKeyboard((event) => {
      const key = parseNavKey(event);
      const target = renderer.currentFocusedRenderable;
      const result = registry.dispatchMode(target ?? undefined, key);
      const command = [...records.values()].find((item) => item.controlId === target?.id);
      if (result !== "declined") {
        event.preventDefault();
        event.stopPropagation();
      } else if (key.name === "enter" && command) {
        if (command.record.enabled) command.execute();
        event.preventDefault();
        event.stopPropagation();
      }
    });
    return (
      <DataTable
        id="action-table"
        rows={rows}
        columns={[
          { id: "name", header: "Name", minWidth: 8, cell: (row) => row.name },
          { id: "type", header: "Type", width: 10, optional: true, cell: () => "Skill" },
        ]}
        rowKey={(row) => row.id}
        currentKey={current()}
        onCurrentChange={setCurrent}
        selection={{
          keys: checked(),
          onToggle: (row) =>
            setChecked(
              (prior) =>
                new Set(
                  prior.has(row.id) ? [...prior].filter((id) => id !== row.id) : [...prior, row.id],
                ),
            ),
        }}
        onActivate={(row) => calls.push(`open:${row.id}`)}
        focusRegistry={registry}
        ref={(root) => {
          const release = registry.register("browser", root);
          onCleanup(release);
        }}
        actions={{
          width: 29,
          compactWidth: 8,
          items: (row, compact) =>
            (compact ? ["manage"] : ["read", "manage", "remove"]).map((action) => ({
              key: action,
              record: {
                id: `${row.id}.${action}`,
                verb:
                  action === "read"
                    ? "Read"
                    : action === "manage"
                      ? compact
                        ? "Manage"
                        : "Membership"
                      : "Remove…",
                destination: row.id,
                keys: ["enter", "return"],
                scope: "page",
                enabled: action !== "remove" || row.removable,
                danger: action === "remove",
                disabledReason:
                  action === "remove" && !row.removable
                    ? "Read-only inherited membership"
                    : undefined,
              },
              execute: () => calls.push(`${action}:${row.id}`),
            })),
          registerCommand: (record, _owner, controlId, execute) => {
            const entry = { record, controlId, execute };
            records.set(record.id, entry);
            return () => {
              if (records.get(record.id) === entry) records.delete(record.id);
            };
          },
        }}
      />
    );
  };
  const setup = await testRender(() => <Surface />, { width, height: 10 });
  await setup.flush();
  return { setup, calls, current, checked, records };
}

test.each([144, 100, 80, 43])(
  "native action column stays aligned, usable and inside %i terminal columns",
  async (width) => {
    const { setup } = await fixture(width);
    try {
      const header = setup.renderer.root.findDescendantById("action-table-header-actions")!;
      const cell = setup.renderer.root.findDescendantById("action-table-row-one:actions")!;
      expect(header).toBeDefined();
      expect(cell.screenX).toBe(header.screenX);
      expect(cell.screenX + cell.width).toBeLessThanOrEqual(width);
      expect(setup.renderer.root.findDescendantById(actionId("one", "manage"))).toBeDefined();
      const name = setup.renderer.root.findDescendantById("action-table-row-one:cell-name")!;
      expect(name.screenX + name.width).toBeLessThanOrEqual(cell.screenX);
      expect(cell.height).toBe(1);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("row actions use the clicked structural row, never a checked batch; plain row clicks remain select-only", async () => {
  const { setup, calls, current, checked } = await fixture(100);
  try {
    const name = setup.renderer.root.findDescendantById("action-table-row-two:cell-name")!;
    await setup.mockMouse.click(name.screenX + 1, name.screenY);
    expect(current()).toBe("two");
    expect(calls).toEqual([]);
    const read = setup.renderer.root.findDescendantById(actionId("one", "read"))!;
    await setup.mockMouse.click(read.screenX + 1, read.screenY);
    expect(calls).toEqual(["read:one"]);
    expect(current()).toBe("one");
    expect([...checked()]).toEqual(["two"]);
    const blocked = setup.renderer.root.findDescendantById(actionId("two", "remove"))!;
    await setup.mockMouse.click(blocked.screenX + 1, blocked.screenY);
    expect(calls).toEqual(["read:one"]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Right enters current-row actions, Enter runs once, Left and Escape return to the row without changing checks", async () => {
  const { setup, calls, checked } = await fixture(100);
  try {
    const root = setup.renderer.root.findDescendantById("action-table") as BoxRenderable;
    root.focus();
    setup.mockInput.pressArrow("right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === actionId("one", "read"),
    );
    setup.mockInput.pressEnter();
    await setup.flush();
    expect(calls).toEqual(["read:one"]);
    setup.mockInput.pressArrow("right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === actionId("one", "manage"),
    );
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === root);
    expect([...checked()]).toEqual(["two"]);
    setup.mockInput.pressArrow("right");
    await setup.flush();
    setup.mockInput.pressArrow("left");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === root);
  } finally {
    setup.renderer.destroy();
  }
});

test("action focus follows row navigation and resize removes unavailable controls without stale focus or batch changes", async () => {
  const { setup, current, checked, calls, records } = await fixture(100);
  try {
    const root = setup.renderer.root.findDescendantById("action-table") as BoxRenderable;
    expect([...records.keys()]).toEqual(["one.read", "one.manage", "one.remove"]);
    root.focus();
    setup.mockInput.pressArrow("right");
    await setup.flush();
    setup.mockInput.pressArrow("down");
    await setup.flush();
    expect(current()).toBe("two");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(actionId("two", "read"));
    expect([...records.keys()]).toEqual(["two.read", "two.manage", "two.remove"]);
    setup.resize(43, 10);
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable === root).toBe(true);
    setup.mockInput.pressArrow("right");
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(actionId("two", "manage"));
    expect(calls).toEqual([]);
    expect([...checked()]).toEqual(["two"]);
    expect([...records.keys()]).toEqual(["two.manage"]);
    setup.resize(100, 10);
    await setup.flush();
    await parsedEscape(setup);
    setup.mockInput.pressArrow("right");
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(actionId("two", "read"));
    setup.mockInput.pressArrow("right");
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(actionId("two", "manage"));
  } finally {
    setup.renderer.destroy();
  }
});
