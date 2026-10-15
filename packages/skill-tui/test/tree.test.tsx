/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { type KeyEvent, type Renderable, ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { testRender, useKeyboard, useRenderer } from "@opentui/solid";
import { ButtonRenderable } from "@tuiparts/core/button";
import { createMemo, createSignal, Show } from "solid-js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFocusRegistry } from "../src/focus";
import { parseNavKey } from "../src/navigation";
import { createPanelNavigation } from "../src/panel-navigation";
import { Button } from "../src/ui/button";
import { Dialog, DialogContent } from "../src/ui/dialog";
import { Tree, type TreeRow } from "../src/ui/tree";

type Setup = Awaited<ReturnType<typeof testRender>>;
const rowId = (key: string) => `tree-row-${encodeURIComponent(key)}`;
const disclosureId = (key: string) => `${rowId(key)}-disclosure`;
const collection = (key: string, parentKey?: string): TreeRow => ({
  key,
  parentKey,
  depth: parentKey ? 1 : 0,
  kind: parentKey ? "reference" : "collection",
  name: key,
  expandable: true,
});
const skill = (key: string, parentKey?: string): TreeRow => ({
  key,
  parentKey,
  depth: parentKey ? 1 : 0,
  kind: "skill",
  name: key,
  expandable: false,
});

async function fixture(
  options: {
    readonly rows?: readonly TreeRow[];
    readonly selected?: string;
    readonly expanded?: readonly string[];
    readonly initialScrollTop?: number;
    readonly width?: number;
    readonly height?: number;
    readonly onToggle?: () => void;
    readonly onActivate?: () => void;
  } = {},
) {
  const registry = createFocusRegistry();
  const [allRows, setRows] = createSignal<readonly TreeRow[]>(
    options.rows ?? [
      collection("root"),
      collection("branch", "root"),
      { ...skill("nested", "branch"), depth: 2 },
      skill("leaf", "root"),
      { ...collection("empty"), expandable: false },
    ],
  );
  const [selected, setSelected] = createSignal<string | undefined>(options.selected ?? "root");
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set(options.expanded));
  const [active, setActive] = createSignal(true);
  const [visible, setVisible] = createSignal(true);
  const [paneHeight, setPaneHeight] = createSignal<number>();
  const [mounted, setMounted] = createSignal(true);
  const [modal, setModal] = createSignal(false);
  const selections: { key: string; reason: string }[] = [];
  const toggles: { key: string; expanded: boolean }[] = [];
  const activations: string[] = [];
  const scrolls: number[] = [];
  let root: ScrollBoxRenderable | undefined;
  const Surface = () => {
    const renderer = useRenderer();
    // The real App dispatches before native controls. Tree installs no global key listener.
    useKeyboard((event) => {
      if (event.defaultPrevented || modal()) return;
      const focused = renderer.currentFocusedRenderable;
      if (event.name === "tab") {
        const panels = createPanelNavigation(renderer.root, registry, () => true);
        const next = panels.next(focused, event.shift);
        if (next) registry.applyFocus(next);
        event.preventDefault();
        event.stopPropagation();
      } else if (registry.dispatchMode(focused ?? undefined, parseNavKey(event)) !== "declined") {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    const rows = createMemo(() => {
      const byKey = new Map(allRows().map((row) => [row.key, row]));
      return allRows().filter((row) => {
        const seen = new Set<string>();
        for (let parent = row.parentKey; parent; parent = byKey.get(parent)?.parentKey) {
          if (seen.has(parent) || !expanded().has(parent)) return false;
          seen.add(parent);
        }
        return true;
      });
    });
    return (
      <box id="route-shell" width="100%" height="100%" flexDirection="column">
        <box
          id="tree-pane"
          visible={visible()}
          height={paneHeight()}
          flexGrow={paneHeight() === undefined ? 1 : 0}
          minHeight={0}
        >
          <Show when={mounted()}>
            <Tree
              id="tree"
              rows={rows()}
              selectedKey={selected()}
              expandedKeys={expanded()}
              active={active()}
              focusOwner="browser"
              focusRegistry={registry}
              initialScrollTop={options.initialScrollTop}
              ref={(target) => {
                root = target;
              }}
              onScrollChange={(offset) => scrolls.push(offset)}
              onSelect={(key, reason) => {
                selections.push({ key, reason });
                setSelected(key);
              }}
              onExpandedChange={(key, next) => {
                toggles.push({ key, expanded: next });
                setExpanded((previous) => {
                  const updated = new Set(previous);
                  if (next) updated.add(key);
                  else updated.delete(key);
                  return updated;
                });
                options.onToggle?.();
              }}
              onActivate={(key) => {
                activations.push(key);
                options.onActivate?.();
              }}
              empty={<text content="No nodes" />}
            />
          </Show>
        </box>
        <box id="other-pane" height={1} flexShrink={0}>
          <Button id="other" label="Other" ref={(target) => registry.register("reader", target)} />
        </box>
        <Dialog open={modal()} onOpenChange={(open) => setModal(open)}>
          <DialogContent id="tree-test-dialog">
            <Button id="modal-button" label="Modal" />
          </DialogContent>
        </Dialog>
      </box>
    );
  };
  const setup = await testRender(() => <Surface />, {
    width: options.width ?? 60,
    height: options.height ?? 12,
  });
  await setup.waitFor(() => !!root?.focusable && root.viewport.height > 0);
  await setup.flush();
  const tree = () => {
    if (!root) throw new Error("Missing Tree root");
    return root;
  };
  const live = (id: string): Renderable => {
    const target = setup.renderer.root.findDescendantById(id);
    if (!target || target.isDestroyed) throw new Error(`Missing ${id}`);
    return target;
  };
  return {
    ...setup,
    registry,
    tree,
    live,
    selected,
    expanded,
    selections,
    toggles,
    activations,
    scrolls,
    setSelected,
    setExpanded,
    setRows,
    setActive,
    setVisible,
    setPaneHeight,
    setMounted,
    setModal,
  };
}

async function press(setup: Setup, name: string) {
  await new Promise<void>((resolve) => {
    const observed = (_event: KeyEvent) => {
      setup.renderer.keyInput.off("keypress", observed);
      resolve();
    };
    setup.renderer.keyInput.prependListener("keypress", observed);
    setup.mockInput.pressKey(name);
  });
  await setup.flush();
}

test("Tree owns arrows and Enter, stops at boundaries, and never activates an invalid key", async () => {
  const setup = await fixture();
  try {
    setup.tree().focus();
    await press(setup, "ARROW_UP");
    expect(setup.selected()).toBe("root");
    expect(setup.renderer.currentFocusedRenderable).toBe(setup.tree());
    await press(setup, "RETURN");
    expect(setup.toggles).toEqual([{ key: "root", expanded: true }]);
    expect(setup.activations).toEqual([]);
    await press(setup, "ARROW_RIGHT");
    expect(setup.selected()).toBe("branch");
    await press(setup, "ARROW_RIGHT");
    expect(setup.expanded().has("branch")).toBe(true);
    await press(setup, "ARROW_RIGHT");
    expect(setup.selected()).toBe("nested");
    await press(setup, "RETURN");
    expect(setup.activations).toEqual(["nested"]);
    await press(setup, "ARROW_LEFT");
    expect(setup.selected()).toBe("branch");
    await press(setup, "ARROW_LEFT");
    expect(setup.expanded().has("branch")).toBe(false);
    await press(setup, "ARROW_LEFT");
    expect(setup.selected()).toBe("root");
    await press(setup, "END");
    expect(setup.selected()).toBe("empty");
    const toggles = setup.toggles.length;
    await press(setup, "ARROW_DOWN");
    await press(setup, "RETURN");
    expect(setup.selected()).toBe("empty");
    expect(setup.toggles).toHaveLength(toggles);
    expect(setup.renderer.currentFocusedRenderable).toBe(setup.tree());
    setup.setSelected("removed");
    await press(setup, "RETURN");
    await press(setup, "ARROW_DOWN");
    expect(setup.selected()).toBe("removed");
    expect(setup.activations).toEqual(["nested"]);
  } finally {
    setup.renderer.destroy();
  }
});

test("all three disclosure cells press a real Button without selection or page activation", async () => {
  const setup = await fixture({ selected: "empty" });
  try {
    const button = setup.live(disclosureId("root"));
    expect(button).toBeInstanceOf(ButtonRenderable);
    expect(button.width).toBe(3);
    expect(button.height).toBe(1);
    for (let cell = 0; cell < 3; cell++) {
      const before = setup.toggles.length;
      await setup.mockMouse.click(button.screenX + cell, button.screenY);
      await setup.flush();
      expect(setup.toggles).toHaveLength(before + 1);
      expect(setup.selected()).toBe("empty");
      expect(setup.renderer.currentFocusedRenderable).toBe(setup.tree());
    }
    expect(setup.activations).toEqual([]);
    const name = setup.live(`${rowId("root")}-name`);
    const before = setup.toggles.length;
    await setup.mockMouse.click(name.screenX + 1, name.screenY);
    await setup.flush();
    expect(setup.selected()).toBe("root");
    expect(setup.toggles).toHaveLength(before);
    expect(setup.selections.at(-1)).toEqual({ key: "root", reason: "pointer" });
    expect(setup.renderer.root.findDescendantById(disclosureId("empty"))).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("collapse falls back to the ancestor before removing its selected descendant", async () => {
  const setup = await fixture({ expanded: ["root", "branch"], selected: "nested" });
  try {
    const button = setup.live(disclosureId("root"));
    await setup.mockMouse.click(button.screenX, button.screenY);
    await setup.flush();
    expect(setup.selected()).toBe("root");
    expect(setup.selections.at(-1)).toEqual({ key: "root", reason: "collapse" });
    expect(setup.expanded().has("root")).toBe(false);
    expect(setup.expanded().has("branch")).toBe(true);
    expect(setup.renderer.root.findDescendantById(rowId("nested"))).toBeUndefined();
    expect(setup.tree().scrollTop).toBe(0);
    expect(setup.renderer.currentFocusedRenderable).toBe(setup.tree());
  } finally {
    setup.renderer.destroy();
  }
});

test("mixed Button focus obeys controlled selection, consumes Enter once, and has one Tab region", async () => {
  const setup = await fixture({ expanded: ["root"], selected: "leaf" });
  try {
    const button = setup.live(disclosureId("branch"));
    button.focus();
    expect(setup.registry.ownerOf(button)).toBe("browser");
    expect(setup.registry.target("browser")).toBe(setup.tree());
    await press(setup, "RETURN");
    expect(setup.activations).toEqual(["leaf"]);
    expect(setup.toggles).toEqual([]);
    await press(setup, "ARROW_UP");
    expect(setup.selected()).toBe("branch");
    await press(setup, "RETURN");
    expect(setup.toggles).toEqual([{ key: "branch", expanded: true }]);
    await press(setup, " ");
    expect(setup.toggles).toHaveLength(1);
    await press(setup, "TAB");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("other");
    await press(setup, "TAB");
    expect(setup.renderer.currentFocusedRenderable).toBe(setup.tree());
  } finally {
    setup.renderer.destroy();
  }
});

test("stable key rows preserve native Button identity while labels and callbacks use fresh data", async () => {
  const setup = await fixture({ expanded: ["root"], selected: "branch" });
  try {
    const button = setup.live(disclosureId("branch"));
    button.focus();
    setup.setRows([
      collection("root"),
      { ...collection("branch", "root"), name: "Changed branch" },
      skill("new-child", "branch"),
      skill("leaf", "root"),
    ]);
    await setup.flush();
    expect(setup.live(disclosureId("branch"))).toBe(button);
    expect(setup.renderer.currentFocusedRenderable).toBe(button);
    const name = setup.live(`${rowId("branch")}-name`) as TextRenderable;
    expect(name.chunks.map((chunk) => chunk.text).join("")).toContain("Changed branch");
    await press(setup, "RETURN");
    await press(setup, "ARROW_RIGHT");
    expect(setup.selected()).toBe("new-child");
    await press(setup, "RETURN");
    expect(setup.activations).toEqual(["new-child"]);
  } finally {
    setup.renderer.destroy();
  }
});

test("deactivation blurs native descendants, gates controls, and reactivation never steals focus", async () => {
  const setup = await fixture();
  try {
    const button = setup.live(disclosureId("root")) as ButtonRenderable;
    button.focus();
    setup.setActive(false);
    await setup.flush();
    expect(button.focused).toBe(false);
    expect(button.disabled).toBe(true);
    expect(setup.tree().focused).toBe(false);
    expect(setup.tree().focusable).toBe(false);
    expect(setup.tree().verticalScrollBar.focusable).toBe(false);
    expect(setup.tree().verticalScrollBar.visible).toBe(false);
    button.press();
    await press(setup, "RETURN");
    await setup.mockMouse.click(button.screenX, button.screenY);
    await setup.flush();
    expect(setup.toggles).toEqual([]);
    setup.live("other").focus();
    setup.setActive(true);
    await setup.flush();
    expect(setup.tree().focusable).toBe(true);
    expect(button.disabled).toBe(false);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("other");
  } finally {
    setup.renderer.destroy();
  }
});

test("hidden ancestors suppress native focus/input and geometry telemetry without clearing saved position", async () => {
  const rows = [
    collection("root"),
    ...Array.from({ length: 80 }, (_, index) => skill(`item-${index}`, "root")),
  ];
  const setup = await fixture({ rows, expanded: ["root"], initialScrollTop: 30 });
  try {
    setup.tree().verticalScrollBar.focus();
    const saved = setup.tree().scrollTop;
    const telemetry = setup.scrolls.length;
    setup.setVisible(false);
    await setup.flush();
    expect(setup.tree().verticalScrollBar.focused).toBe(false);
    expect(setup.tree().focusable).toBe(false);
    expect(setup.scrolls).toHaveLength(telemetry);
    expect(
      setup.registry.dispatchMode(setup.tree().verticalScrollBar, parseNavKey({ name: "down" })),
    ).toBe("declined");
    setup.live("other").focus();
    setup.setVisible(true);
    await setup.flush();
    expect(setup.tree().scrollTop).toBe(saved);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("other");
  } finally {
    setup.renderer.destroy();
  }
});

test("page collapse deactivates before hiding despite normalized native height and preserves viewport persistence", async () => {
  const rows = [
    collection("root"),
    ...Array.from({ length: 80 }, (_, index) => skill(`item-${index}`, "root")),
  ];
  const setup = await fixture({ rows, expanded: ["root"], initialScrollTop: 35 });
  try {
    const saved = setup.tree().scrollTop;
    const count = setup.scrolls.length;
    const disclosure = setup.live(disclosureId("root")) as ButtonRenderable;
    disclosure.focus();
    // Match the page contract: deactivate before hiding or reallocating a pane.
    // OpenTUI 0.5.14 Renderable.updateFromLayout normalizes both public
    // dimensions with Math.max(computedSize, 1), even for height={0}.
    setup.setActive(false);
    setup.setPaneHeight(0);
    setup.setVisible(false);
    await setup.flush();
    expect(setup.live("tree-pane").visible).toBe(false);
    expect(setup.live("tree-pane").height).toBeGreaterThanOrEqual(1);
    expect(setup.tree().focusable).toBe(false);
    expect(disclosure.focused).toBe(false);
    expect(disclosure.disabled).toBe(true);
    expect(setup.tree().verticalScrollBar.focusable).toBe(false);
    expect(setup.scrolls).toHaveLength(count);
    // Native hidden layout may clamp its transport; this must not publish a
    // new saved offset, and hidden input must not change that transport further.
    const collapsedOffset = setup.tree().scrollTop;
    disclosure.focus();
    disclosure.press();
    setup.tree().verticalScrollBar.focus();
    expect(disclosure.focused).toBe(false);
    expect(setup.tree().verticalScrollBar.focused).toBe(false);
    expect(setup.toggles).toEqual([]);
    setup.live("other").focus();
    await press(setup, "ARROW_DOWN");
    await setup.mockMouse.scroll(
      setup.tree().viewport.screenX + 5,
      setup.tree().viewport.screenY + 2,
      "down",
    );
    await setup.flush();
    expect(setup.tree().scrollTop).toBe(collapsedOffset);
    expect(setup.scrolls).toHaveLength(count);
    expect(setup.selected()).toBe("root");
    expect(setup.activations).toEqual([]);
    setup.setPaneHeight(undefined);
    setup.setVisible(true);
    setup.setActive(true);
    await setup.flush();
    expect(setup.tree().scrollTop).toBe(saved);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("other");
  } finally {
    setup.renderer.destroy();
  }
});

test("a captured native scrollbar drag cannot mutate a deactivated Tree", async () => {
  const rows = [
    collection("root"),
    ...Array.from({ length: 120 }, (_, index) => skill(`item-${index}`, "root")),
  ];
  const setup = await fixture({ rows, expanded: ["root"], initialScrollTop: 30 });
  try {
    const slider = setup.tree().verticalScrollBar.slider;
    const x = slider.screenX;
    const y = slider.screenY + 2;
    await setup.mockMouse.pressDown(x, y);
    await setup.mockMouse.emitMouseEvent("drag", x, y + 1);
    await setup.flush();
    setup.setActive(false);
    await setup.flush();
    const saved = setup.tree().scrollTop;
    const telemetry = setup.scrolls.length;
    await setup.mockMouse.emitMouseEvent("drag", x, y + 5);
    await setup.mockMouse.release(x, y + 5);
    await setup.flush();
    expect(setup.tree().scrollTop).toBe(saved);
    expect(setup.scrolls).toHaveLength(telemetry);
    expect(setup.selected()).toBe("root");
  } finally {
    setup.renderer.destroy();
  }
});

test("modal focus opened by a disclosure callback is not stolen by Tree restoration or reveal", async () => {
  let openModal = () => {};
  const setup = await fixture({ onToggle: () => openModal() });
  openModal = () => setup.setModal(true);
  try {
    const button = setup.live(disclosureId("root"));
    await setup.mockMouse.click(button.screenX + 1, button.screenY);
    // TuiParts 0.0.6 DialogPopup.focusInitial chooses its first live child,
    // not the popup itself when a focusable native Button is present.
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "modal-button");
    await setup.flush();
    const modal = setup.renderer.currentFocusedRenderable;
    expect(modal).toBe(setup.live("modal-button"));
    expect(setup.live("tree-test-dialog").visible).toBe(true);
    expect(setup.toggles).toEqual([{ key: "root", expanded: true }]);
    setup.setSelected("leaf");
    setup.resize(43, 13);
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable).toBe(modal);
    await press(setup, "ARROW_DOWN");
    expect(setup.selected()).toBe("leaf");
    expect(setup.toggles).toHaveLength(1);
    expect(setup.activations).toEqual([]);
    expect(setup.renderer.currentFocusedRenderable).toBe(modal);
  } finally {
    setup.renderer.destroy();
  }
});

test("synchronous callback focus transfer wins over disclosure focus restoration", async () => {
  let transfer = () => {};
  const setup = await fixture({ onToggle: () => transfer() });
  transfer = () => setup.live("other").focus();
  try {
    const button = setup.live(disclosureId("root"));
    await setup.mockMouse.click(button.screenX + 2, button.screenY);
    await setup.flush();
    expect(setup.expanded().has("root")).toBe(true);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("other");
  } finally {
    setup.renderer.destroy();
  }
});

test("restored scrolling, wheel and native scrollbar preserve selection until tree navigation reveals it", async () => {
  const rows = [
    collection("root"),
    ...Array.from({ length: 240 }, (_, index) => skill(`item-${index}`, "root")),
  ];
  const setup = await fixture({ rows, expanded: ["root"], initialScrollTop: 70, height: 13 });
  try {
    const tree = setup.tree();
    expect(tree).toBeInstanceOf(ScrollBoxRenderable);
    expect(tree.scrollTop).toBe(70);
    const before = tree.scrollTop;
    await setup.mockMouse.scroll(tree.viewport.screenX + 5, tree.viewport.screenY + 2, "down");
    await setup.flush();
    expect(tree.scrollTop).toBeGreaterThan(before);
    expect(setup.selected()).toBe("root");
    const slider = tree.verticalScrollBar.slider;
    const bar = tree.verticalScrollBar;
    expect(setup.registry.ownerOf(bar)).toBe("browser");
    expect(setup.registry.ownerOf(slider)).toBe("browser");
    await setup.mockMouse.click(slider.screenX, slider.screenY + slider.height - 2);
    await setup.flush();
    expect(tree.scrollTop).toBeGreaterThan(before);
    expect(setup.selected()).toBe("root");
    expect(setup.renderer.currentFocusedRenderable).toBe(bar);
    expect(setup.registry.target("browser")).toBe(tree);
    await press(setup, "ARROW_DOWN");
    expect(setup.selected()).toBe("item-0");
    expect(tree.scrollTop).toBeLessThanOrEqual(1);
    await press(setup, "RETURN");
    expect(setup.activations).toEqual(["item-0"]);
    await press(setup, "END");
    expect(setup.selected()).toBe("item-239");
    const row = setup.live(rowId("item-239"));
    expect(row.screenY).toBeGreaterThanOrEqual(tree.viewport.screenY);
    expect(row.screenY).toBeLessThan(tree.viewport.screenY + tree.viewport.height);
    expect(setup.scrolls.at(-1)).toBe(tree.scrollTop);
  } finally {
    setup.renderer.destroy();
  }
});

test("branch insertion preserves top-key position instead of jumping to the selected row", async () => {
  const root = collection("root");
  const rows = [root, ...Array.from({ length: 80 }, (_, index) => skill(`item-${index}`, "root"))];
  const setup = await fixture({ rows, expanded: ["root"], initialScrollTop: 40 });
  try {
    const tree = setup.tree();
    const anchor = setup.live(rowId("item-39"));
    const position = anchor.screenY;
    setup.setRows([root, skill("inserted", "root"), ...rows.slice(1).map((row) => ({ ...row }))]);
    await setup.flush();
    expect(tree.scrollTop).toBe(41);
    expect(setup.live(rowId("item-39"))).toBe(anchor);
    expect(anchor.screenY).toBe(position);
    expect(setup.selected()).toBe("root");
    setup.resize(43, 13);
    await setup.flush();
    expect(tree.scrollTop).toBe(41);
    expect(setup.selected()).toBe("root");
  } finally {
    setup.renderer.destroy();
  }
});

test("unmount removes frame work, member ownership and modes without reviving deferred restoration", async () => {
  const setup = await fixture();
  try {
    const tree = setup.tree();
    const button = setup.live(disclosureId("root"));
    const frameListeners = setup.renderer.listenerCount("frame");
    const scrolls = setup.scrolls.length;
    setup.setSelected("empty");
    setup.setMounted(false);
    await setup.flush();
    expect(setup.renderer.listenerCount("frame")).toBe(frameListeners - 1);
    expect(setup.registry.target("browser")).toBeUndefined();
    expect(setup.registry.ownerOf(button)).toBeUndefined();
    expect(setup.registry.dispatchMode(button, parseNavKey({ name: "enter" }))).toBe("declined");
    expect(tree.isDestroyed).toBe(true);
    expect(setup.scrolls).toHaveLength(scrolls);
  } finally {
    setup.renderer.destroy();
  }
});

test("empty rows retain the region without inventing a selected or activatable object", async () => {
  const setup = await fixture({ rows: [], selected: "absent" });
  try {
    setup.tree().focus();
    await press(setup, "RETURN");
    await press(setup, "ARROW_RIGHT");
    expect(setup.activations).toEqual([]);
    expect(setup.toggles).toEqual([]);
    expect(setup.selections).toEqual([]);
    expect(setup.selected()).toBe("absent");
    expect(setup.registry.target("browser")).toBe(setup.tree());
    expect(setup.renderer.currentFocusedRenderable).toBe(setup.tree());
  } finally {
    setup.renderer.destroy();
  }
});

test("dense, long and exceptional rows stay single-line at the required terminal sizes", async () => {
  for (const [width, height] of [
    [144, 40],
    [100, 24],
    [80, 24],
    [43, 13],
  ] as const) {
    const rows = [
      collection("root"),
      ...Array.from({ length: 220 }, (_, index) => ({
        ...skill(`item-${index}`, "root"),
        name: `长名称-${index}-${"wide-name-".repeat(12)}`,
        issue: index === 0 ? "Installed content is unavailable" : undefined,
      })),
    ];
    const setup = await fixture({ width, height, rows, expanded: ["root"], selected: "item-0" });
    try {
      for (const key of ["root", "item-0", "item-1"]) expect(setup.live(rowId(key)).height).toBe(1);
      expect(setup.live(`${rowId("item-0")}-name`).width).toBeGreaterThan(0);
      const row = setup.live(rowId("item-0"));
      expect(row.width).toBeLessThanOrEqual(setup.tree().viewport.width);
      expect(setup.tree().viewport.height).toBeGreaterThan(0);
      const name = setup.live(`${rowId("item-0")}-name`) as TextRenderable;
      expect(Bun.stringWidth(name.chunks.map((chunk) => chunk.text).join(""))).toBeLessThanOrEqual(
        name.width,
      );
      expect(setup.live(disclosureId("root")).width).toBe(3);
      const directory = process.env.QUIET_UPDATE_CAPTURE_DIR;
      if (directory) {
        await mkdir(directory, { recursive: true });
        await setup.renderOnce();
        await writeFile(
          join(directory, `tree-dense-${width}x${height}.txt`),
          setup.captureCharFrame(),
        );
      }
    } finally {
      setup.renderer.destroy();
    }
  }
});
