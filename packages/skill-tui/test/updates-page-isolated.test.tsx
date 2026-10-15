/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { createFocusRegistry } from "../src/focus";
import { parseNavKey } from "../src/navigation";
import { UpdatesPage } from "../src/updates/page";
import { buildUpdateScope, createUpdatesState } from "../src/updates/model";
import { workspaceProjection } from "./direct-source.fixture";

async function parsedPageKey(
  setup: Awaited<ReturnType<typeof testRender>>,
  key: "right" | "down" | "up" | "space" | "enter",
) {
  await new Promise<void>((resolve) => {
    const listener = (event: { readonly name: string }) => {
      const parsed = parseNavKey(event);
      const matches =
        key === "space"
          ? parsed.name === "character" && parsed.char === " "
          : key === "enter"
            ? parsed.name === "enter"
            : parsed.name === key;
      if (!matches) return;
      setup.renderer.keyInput.off("keypress", listener);
      resolve();
    };
    setup.renderer.keyInput.prependListener("keypress", listener);
    if (key === "right") setup.mockInput.pressArrow("right");
    else if (key === "down") setup.mockInput.pressArrow("down");
    else if (key === "up") setup.mockInput.pressArrow("up");
    else if (key === "space") setup.mockInput.pressKey(" ");
    else setup.mockInput.pressEnter();
  });
  // Keypress observers run before the renderer completes focused-target dispatch.
  // Let that synchronous input turn and Solid's scheduled reconciliation settle.
  await new Promise<void>((resolve) => setImmediate(resolve));
  await setup.renderOnce();
}

function browserCheckpoint(
  setup: Awaited<ReturnType<typeof testRender>>,
  updates: ReturnType<typeof state>,
  expected: number,
  label: string,
) {
  const browser = setup.renderer.root.findDescendantById("updates-browser");
  const actual = browser instanceof SelectRenderable ? browser.getSelectedIndex() : undefined;
  if (actual === expected) return;
  throw new Error(
    `${label}: expected index ${expected}, received ${actual}; key=${updates.focusedRowKey()}; focus=${setup.renderer.currentFocusedRenderable?.id}; options=${browser instanceof SelectRenderable ? browser.options.map((option) => option.value).join(",") : "unmounted"}\n${setup.captureCharFrame()}`,
  );
}

async function settleBrowserRestore(setup: Awaited<ReturnType<typeof testRender>>) {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await setup.renderOnce();
}

function state() {
  const address = { source: "team-main", path: "guide" };
  const snapshot = workspaceProjection();
  const guide = {
    address,
    name: "guide",
    description: "Guide",
    owner: { source: "team-main", health: "healthy" as const },
    collections: [],
    selectors: [],
    selectorViews: { status: "complete" as const, values: [] },
    aliases: [],
    problems: [],
  };
  const value = createUpdatesState(
    buildUpdateScope(
      {
        ...snapshot,
        installedSkills: [
          guide,
          {
            ...guide,
            address: { source: "team-main", path: "reference" },
            name: "reference",
            description: "Reference",
          },
        ],
      },
      { kind: "workspace" },
    ),
  );
  value.observe({
    source: "team-main",
    kind: "github",
    changed: [
      { path: "guide", name: "guide", description: "Guide" },
      { path: "reference", name: "reference", description: "Reference" },
    ],
    added: [{ path: "new", name: "new", description: "New" }],
    removed: [{ path: "old", name: "old", description: "Old" }],
    unchanged: [{ path: "same", name: "same", description: "Same" }],
  });
  return value;
}

test("RENDER UpdatesPage exposes one native browser and survives required terminal bounds", async () => {
  const updates = state();
  const setup = await testRender(
    () => (
      <UpdatesPage
        state={updates}
        onCheck={() => {}}
        onUpdate={() => {}}
        onStop={() => {}}
        onRetry={() => {}}
        onOpen={() => {}}
        submittable={() => updates.eligible()}
        retryable={() => updates.retryable()}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    for (const [width, height] of [
      [120, 40],
      [80, 24],
      [80, 16],
      [43, 30],
    ] as const) {
      setup.resize(width, height);
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("Updates");
      expect(setup.renderer.root.findDescendantById("updates-browser")).toBeDefined();
    }
    expect(setup.captureCharFrame()).toContain("Scope: current workspace");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER UpdatesPage native arrows, Space and Enter preserve exact row actions and remount state", async () => {
  const updates = state();
  const opened: { source: string; path: string }[] = [];
  const submitted: (readonly { source: string; path: string }[])[] = [];
  const registry = createFocusRegistry();
  const [remount, setRemount] = createSignal(false);
  const setup = await testRender(
    () => (
      <Show
        when={remount()}
        keyed
        fallback={
          <UpdatesPage
            state={updates}
            onCheck={() => {}}
            onUpdate={(addresses) => submitted.push(addresses)}
            onStop={() => {}}
            onRetry={() => {}}
            onOpen={(address) => opened.push(address)}
            submittable={() => updates.eligible()}
            retryable={() => updates.retryable()}
            focusRegistry={registry}
          />
        }
      >
        <UpdatesPage
          state={updates}
          onCheck={() => {}}
          onUpdate={(addresses) => submitted.push(addresses)}
          onStop={() => {}}
          onRetry={() => {}}
          onOpen={(address) => opened.push(address)}
          submittable={() => updates.eligible()}
          retryable={() => updates.retryable()}
          focusRegistry={registry}
        />
      </Show>
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.renderOnce();
    const currentUpdate = setup.renderer.root.findDescendantById("updates-submit")!;
    await setup.mockMouse.click(currentUpdate.screenX + 2, currentUpdate.screenY);
    expect(submitted).toEqual([
      [
        { source: "team-main", path: "guide" },
        { source: "team-main", path: "reference" },
      ],
    ]);
    submitted.length = 0;
    let browser = setup.renderer.root.findDescendantById("updates-browser");
    if (!(browser instanceof SelectRenderable))
      throw new Error("Updates browser is not a native Select");
    expect(registry.ownerOf(browser)).toBe("browser");
    browser.focus();
    await parsedPageKey(setup, "right");
    expect(updates.group("team-main")?.expanded).toBe(true);
    await parsedPageKey(setup, "down");
    browserCheckpoint(setup, updates, 1, "first Skill after Down");
    await parsedPageKey(setup, "down");
    browserCheckpoint(setup, updates, 2, "second Skill after Down");
    await parsedPageKey(setup, "up");
    browserCheckpoint(setup, updates, 1, "first Skill after Up");
    await parsedPageKey(setup, "space");
    expect(updates.selected()).toEqual([{ source: "team-main", path: "reference" }]);
    updates.observe({
      source: "team-main",
      kind: "github",
      changed: [
        { path: "guide", name: "guide", description: "Updated guide summary" },
        { path: "reference", name: "reference", description: "Updated reference summary" },
      ],
      added: [],
      removed: [],
      unchanged: [],
    });
    await setup.renderOnce();
    browserCheckpoint(setup, updates, 1, "first Skill after observation refresh");
    await parsedPageKey(setup, "space");
    expect(updates.selected()).toEqual([
      { source: "team-main", path: "reference" },
      { source: "team-main", path: "guide" },
    ]);
    await parsedPageKey(setup, "space");
    expect(updates.selected()).toEqual([{ source: "team-main", path: "reference" }]);
    expect(setup.captureCharFrame()).toContain("Updated guide summary");
    expect(setup.captureCharFrame()).not.toContain("Updated reference summary");
    await parsedPageKey(setup, "enter");
    expect(opened).toEqual([{ source: "team-main", path: "guide" }]);
    expect(submitted).toEqual([]);
    setRemount(true);
    await setup.renderOnce();
    await settleBrowserRestore(setup);
    const remountedBrowser = setup.renderer.root.findDescendantById("updates-browser");
    if (!(remountedBrowser instanceof SelectRenderable))
      throw new Error("Updates browser did not remount as a native Select");
    browser = remountedBrowser;
    expect(remountedBrowser.options).toHaveLength(3);
    browserCheckpoint(setup, updates, 1, "retained Skill after keyed remount");
    const updateCurrent = setup.renderer.root.findDescendantById("updates-submit")!;
    await setup.mockMouse.click(updateCurrent.screenX + 2, updateCurrent.screenY);
    expect(submitted).toEqual([[{ source: "team-main", path: "reference" }]]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER UpdatesPage accepts only controller-guarded submissions and exposes stale detail separately", async () => {
  const updates = state();
  const submitted: (readonly { source: string; path: string }[])[] = [];
  const setup = await testRender(
    () => (
      <UpdatesPage
        state={updates}
        onCheck={() => {}}
        onUpdate={(addresses) => submitted.push(addresses)}
        onStop={() => {}}
        onRetry={() => {}}
        onOpen={() => {}}
        submittable={() => []}
        retryable={() => []}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.renderOnce();
    const submit = setup.renderer.root.findDescendantById("updates-submit")!;
    await setup.mockMouse.click(submit.screenX + 2, submit.screenY);
    submit.focus();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(submitted).toEqual([]);
    expect(setup.captureCharFrame()).toContain("Check this Source again before updating");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER UpdatesPage pointer disclosure toggles only its glyph and ordinary Skill press only selects", async () => {
  const updates = state();
  const opened: { source: string; path: string }[] = [];
  const setup = await testRender(
    () => (
      <UpdatesPage
        state={updates}
        onCheck={() => {}}
        onUpdate={() => {}}
        onStop={() => {}}
        onRetry={() => {}}
        onOpen={(address) => opened.push(address)}
        submittable={() => updates.eligible()}
        retryable={() => updates.retryable()}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.renderOnce();
    const browser = setup.renderer.root.findDescendantById("updates-browser");
    if (!(browser instanceof SelectRenderable))
      throw new Error("Updates browser is not a native Select");
    // x=2 is the selected-indicator gutter, not the disclosure glyph.
    await setup.mockMouse.click(browser.screenX + 2, browser.screenY);
    await setup.renderOnce();
    expect(updates.group("team-main")?.expanded).toBe(false);
    await setup.mockMouse.click(browser.screenX + 3, browser.screenY);
    await setup.renderOnce();
    expect(updates.group("team-main")?.expanded).toBe(true);
    expect(opened).toEqual([]);
    await setup.mockMouse.click(browser.screenX + 5, browser.screenY + 1);
    await setup.renderOnce();
    expect(browser.getSelectedIndex()).toBe(1);
    expect(opened).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
