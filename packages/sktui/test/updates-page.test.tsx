/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import {
  InputRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { createSignal, Show } from "solid-js";

import { createFocusRegistry } from "../src/focus";
import { SourceUpdatesPage, UpdatesPage } from "../src/updates/page";
import { deriveUpdateScope as buildUpdateScope } from "../src/updates/scope";
import { createUpdatesState } from "../src/updates/state";
import type { UpdateRun } from "../src/updates/state";
import { workspaceProjection } from "./direct-source.fixture";
import { enterLive, focusLive, live, parsedEnter } from "./reader-test-controls";

const nativeText = (node: BaseRenderable): string =>
  node instanceof TextRenderable ? node.plainText : node.getChildren().map(nativeText).join("");

function fixture(count = 3) {
  const snapshot = {
    ...workspaceProjection({ includeContribution: false }),
    installedSkills: Array.from({ length: count }, (_, index) => ({
      address: { source: "team-main", path: `skill-${String(index).padStart(3, "0")}` },
      name: `Skill ${index}`,
      description: `Installed Skill ${index}`,
      owner: { source: "team-main", health: "healthy" as const },
      collections: [],
      selectors: [],
      selectorViews: { status: "complete" as const, values: [] },
      aliases: [],
      problems: [],
    })),
  };
  const observation = {
    source: "team-main",
    kind: "github" as const,
    exactRevision: "a".repeat(40),
    baseline: "checked-page",
    changed: snapshot.installedSkills.map((skill) => ({
      path: skill.address.path,
      name: skill.name,
      description: skill.description,
    })),
    unchanged: [],
    added: [],
    removed: [],
  };
  return { snapshot, observation };
}

test("RENDER overview commands and pointer keep current Source, selection and activation distinct", async () => {
  const { snapshot, observation } = fixture();
  const other = { ...snapshot.installedSkills[0]!, address: { source: "other", path: "guide" } };
  const state = createUpdatesState(
    buildUpdateScope(
      {
        ...snapshot,
        effective: {
          ...snapshot.effective,
          sources: [
            ...snapshot.effective.sources,
            { ...snapshot.effective.sources[0]!, id: "other" },
          ],
        },
        installedSkills: [...snapshot.installedSkills, other],
      },
      { kind: "workspace" },
    ),
  );
  state.observe(observation);
  state.observe({
    ...observation,
    source: "other",
    changed: [{ path: "guide", name: "guide", description: "Guide" }],
  });
  const registry = createFocusRegistry();
  const owners = new Map<string, string>();
  const commands = new Map<string, () => void>();
  const submitted: unknown[] = [];
  const opened: string[] = [];
  const setup = await testRender(
    () => (
      <UpdatesPage
        state={state}
        onCheck={() => {}}
        onUpdate={(items) => submitted.push(items)}
        onStop={() => {}}
        onOpenSource={(source) => opened.push(source)}
        focusRegistry={registry}
        registerCommand={(record, owner, _control, execute) => {
          owners.set(record.id, owner);
          commands.set(record.id, execute);
          return () => commands.delete(record.id);
        }}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("updates-browser-row-other:cell-source"),
    );
    expect(owners.get("updates.update-all")).toBe("command:updates.update-all");
    expect(registry.ownerOf(live(setup, "updates-browser"))).toBe("browser");
    for (const column of ["source", "status", "updates", "installed"])
      expect(live(setup, `updates-browser-header-${column}`)).toBeInstanceOf(TextRenderable);
    expect(live(setup, "updates-browser-row-team-main:cell-status")).toMatchObject({
      plainText: "Updates available",
    });
    expect(live(setup, "updates-browser-row-team-main:cell-updates")).toMatchObject({
      plainText: "3",
    });
    await setup.waitForFrame(
      (frame) => frame.includes("other") && frame.includes("Updates available"),
    );
    await setup.flush();
    const cell = live(setup, "updates-browser-row-other:cell-source");
    const body = live(setup, "updates-browser-body");
    if (!(body instanceof ScrollBoxRenderable))
      throw new Error("Expected native overview viewport");
    expect(cell.screenY).toBeGreaterThanOrEqual(body.viewport.screenY);
    expect(cell.screenY + cell.height).toBeLessThanOrEqual(
      body.viewport.screenY + body.viewport.height,
    );
    await setup.mockMouse.click(cell.screenX + 1, cell.screenY);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("updates-browser");
    expect(state.focusedRowKey()).toBe("other");
    expect(state.selected()).toEqual([]);
    expect(opened).toEqual([]);
    expect(submitted).toEqual([]);
    await parsedEnter(setup);
    expect(opened).toEqual(["other"]);
    commands.get("updates.update-source")!();
    expect(submitted).toEqual([[other.address]]);
    commands.get("updates.update-all")!();
    expect(submitted[1]).toEqual(state.scope.addresses);
    const table = await focusLive(setup, "updates-browser");
    setup.mockInput.pressKey("HOME");
    await setup.waitFor(() => state.focusedRowKey() === "team-main");
    setup.mockInput.pressArrow("down");
    await setup.waitFor(() => state.focusedRowKey() === "other");
    setup.mockInput.pressArrow("up");
    await setup.waitFor(() => state.focusedRowKey() === "team-main");
    expect(state.selected()).toEqual([]);
    expect(
      registry.dispatchMode(table, { name: "enter", ctrl: false, shift: false, alt: false }),
    ).toBe("consumed");
    expect(opened).toEqual(["other", "team-main"]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Source native cursor, hidden draft, read-only preview and remount restore the same nonfirst row", async () => {
  const { snapshot, observation } = fixture(120);
  const guarded = {
    ...snapshot,
    installedSkills: snapshot.installedSkills.map((skill, index) =>
      index ? skill : { ...skill, owner: { source: "team-main", health: "drifted" as const } },
    ),
  };
  const state = createUpdatesState(
    buildUpdateScope(guarded, { kind: "source", source: "team-main" }),
  );
  state.observe(observation);
  const registry = createFocusRegistry();
  const submitted: unknown[] = [];
  const previews: Parameters<typeof import("@skctl/core").previewUpdate>[1][] = [];
  const [mounted, setMounted] = createSignal(true);
  const [query, setQuery] = createSignal("");
  const [filter, setFilter] = createSignal<"all" | "updates">("all");
  const setup = await testRender(
    () => (
      <Show when={mounted()}>
        <SourceUpdatesPage
          state={state}
          source="team-main"
          skills={guarded.installedSkills}
          query={query()}
          filter={filter()}
          onQuery={setQuery}
          onFilter={setFilter}
          onSourceDetails={() => {}}
          onCheck={() => {}}
          onUpdate={(items) => submitted.push(items)}
          onStop={() => {}}
          focusRegistry={registry}
          previewUpdate={async (_environment, request) => {
            previews.push(request);
            return {
              value: {
                address: { source: request.source, path: request.path },
                status: "ready",
                targetRevision: observation.exactRevision,
                removed: false,
                files: [],
              },
              diagnostics: [],
            };
          }}
        />
      </Show>
    ),
    { width: 80, height: 24 },
  );
  const last = snapshot.installedSkills[119]!.address;
  const lastKey = `team-main\u0000${last.path}`;
  const rowId = `source-updates-browser-row-${encodeURIComponent(lastKey)}`;
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById(`${rowId}:cell-skill`));
    expect(state.selected()).toEqual([]);
    await enterLive(setup, "source-updates-update-all");
    expect(submitted).toEqual([state.scope.addresses]);
    const table = await focusLive(setup, "source-updates-browser");
    setup.mockInput.pressKey("HOME");
    setup.mockInput.pressKey(" ");
    await setup.renderOnce();
    expect(state.selected()).toEqual([]); // Captured unhealthy owner is not selectable.
    setup.mockInput.pressKey("END");
    await setup.waitFor(() => state.sourcePosition("team-main")?.currentKey === lastKey);
    setup.mockInput.pressKey(" ");
    await setup.waitFor(() => state.selected().length === 1);
    const body = live(setup, "source-updates-browser-body");
    if (!(body instanceof ScrollBoxRenderable)) throw new Error("Expected native table viewport");
    await setup.waitFor(() => body.scrollTop > 0);
    const row = live(setup, rowId);
    expect(row.screenY).toBeGreaterThanOrEqual(body.viewport.screenY);
    expect(row.screenY + row.height).toBeLessThanOrEqual(
      body.viewport.screenY + body.viewport.height,
    );
    const cell = live(setup, `${rowId}:cell-skill`);
    await setup.mockMouse.click(cell.screenX + 1, cell.screenY);
    expect(state.sourcePosition("team-main")?.currentKey).toBe(lastKey);
    expect(state.selected()).toEqual([last]);
    expect(previews).toEqual([]);
    expect(submitted).toHaveLength(1);
    const scrollTop = body.scrollTop;
    setMounted(false);
    // Solid detaches now; OpenTUI destroys the detached native subtree on nextTick.
    await setup.waitFor(() => table.isDestroyed);
    expect(table.isDestroyed).toBe(true);
    setMounted(true);
    await setup.waitFor(() => {
      const restored = setup.renderer.root.findDescendantById("source-updates-browser-body");
      return restored instanceof ScrollBoxRenderable && restored.scrollTop === scrollTop;
    });
    expect(state.sourcePosition("team-main")?.currentKey).toBe(lastKey);
    expect(state.selected()).toEqual([last]);
    const restored = await focusLive(setup, "source-updates-browser");
    expect(restored).not.toBe(table);
    expect(registry.ownerOf(restored)).toBe("browser");
    await setup.waitFor(() => nativeText(live(setup, rowId)).startsWith("› "));
    expect(nativeText(live(setup, rowId))).toContain("✓");
    state.observe({
      ...observation,
      changed: observation.changed.map((skill) => ({
        ...skill,
        description: `Rechecked ${skill.description}`,
      })),
    });
    await setup.renderOnce();
    expect(state.sourcePosition("team-main")?.currentKey).toBe(lastKey);
    expect(state.selected()).toEqual([last]);
    await enterLive(setup, "source-updates-show-all");
    expect(filter()).toBe("updates");
    expect(state.selected()).toEqual([last]);
    expect(submitted).toHaveLength(1);
    await focusLive(setup, "source-updates-browser");
    setup.mockInput.pressKey("/");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof InputRenderable);
    await setup.mockInput.typeText("skill-001");
    const input = live(setup, "source-updates-query");
    expect(
      registry.dispatchMode(input, { name: "enter", ctrl: false, shift: false, alt: false }),
    ).toBe("consumed");
    await setup.waitForFrame((frame) => frame.includes("1 selected Skills hidden by this view"));
    expect(query()).toBe("skill-001");
    expect(state.selected()).toEqual([last]);
    expect(submitted).toHaveLength(1);
    expect(previews).toEqual([]);
    await enterLive(setup, "source-updates-browser");
    await setup.waitFor(() => previews.length === 1);
    expect(previews).toEqual([
      {
        source: "team-main",
        path: "skill-001",
        exactRevision: observation.exactRevision,
        expectedBaseline: observation.baseline,
      },
    ]);
    expect(submitted).toHaveLength(1);
    await enterLive(setup, "source-updates-preview-back");
    await enterLive(setup, "source-updates-update-all");
    expect(submitted[1]).toEqual([last]); // Filter never becomes the submission scope.
    expect(state.selected()).toEqual([last]);
    await enterLive(setup, "source-updates-clear");
    expect(state.selected()).toEqual([]);
    expect(state.sourcePosition("team-main")?.currentKey).toBe("team-main\u0000skill-001");
    expect(query()).toBe("skill-001");
  } finally {
    setup.renderer.destroy();
  }
});

test.each([
  [80, 24],
  [40, 12],
])(
  "RENDER Source toolbar and active Stop remain within pane and frame at %ix%i",
  async (width, height) => {
    const { snapshot, observation } = fixture(120);
    const state = createUpdatesState(
      buildUpdateScope(snapshot, { kind: "source", source: "team-main" }),
    );
    state.observe(observation);
    const [run, setRun] = createSignal<UpdateRun>();
    let stops = 0;
    const setup = await testRender(
      () => (
        <SourceUpdatesPage
          state={state}
          source="team-main"
          skills={snapshot.installedSkills}
          query=""
          filter="all"
          onQuery={() => {}}
          onFilter={() => {}}
          onSourceDetails={() => {}}
          onCheck={() => {}}
          onUpdate={() => {}}
          onStop={() => stops++}
          active={() => run()?.phase === "updating"}
          run={run}
        />
      ),
      { width, height },
    );
    try {
      for (const active of [false, true]) {
        if (active)
          setRun({
            phase: "updating",
            source: "team-main",
            addresses: state.scope.addresses,
            results: state.scope.addresses.map<UpdateRun["results"][number]>((address) => ({
              address,
              status: "not-run",
            })),
          });
        const id = active ? "source-updates-stop" : "source-updates-update-all";
        await setup.waitFor(() => !!setup.renderer.root.findDescendantById(id));
        await setup.flush();
        const pane = live(setup, "source-updates-page");
        for (const target of [
          live(setup, "source-updates-browser"),
          live(setup, "source-updates-actions-pane"),
          live(setup, id),
        ]) {
          expect(target.screenX).toBeGreaterThanOrEqual(pane.screenX + 1);
          expect(target.screenX + target.width).toBeLessThanOrEqual(pane.screenX + pane.width - 1);
          expect(target.screenY).toBeGreaterThanOrEqual(pane.screenY + 1);
          expect(target.screenY + target.height).toBeLessThanOrEqual(
            pane.screenY + pane.height - 1,
          );
          expect(target.screenY + target.height).toBeLessThanOrEqual(height);
        }
      }
      await focusLive(setup, "source-updates-browser");
      setup.mockInput.pressKey(" ");
      expect(state.selected()).toEqual([]);
      await enterLive(setup, "source-updates-stop");
      expect(stops).toBe(1);
      expect(
        live(setup, "source-updates-browser-row-team-main%00skill-000:cell-status"),
      ).toBeInstanceOf(TextRenderable);
      expect(setup.captureCharFrame()).toContain("Updating");
      expect(setup.renderer.root.findDescendantById("source-updates-update-all")).toBeUndefined();
      const address = state.scope.addresses[0]!;
      const failure = "Source rejected this batch before publication; installed content kept";
      setRun({
        phase: "settled",
        addresses: [address],
        results: [
          {
            address,
            status: "failed",
            message: failure,
            issue: { kind: "metadata", address },
          },
        ],
      });
      await setup.waitFor(() => !setup.renderer.root.findDescendantById("source-updates-stop"));
      await enterLive(setup, "source-updates-feedback-details");
      const detail = live(setup, "source-updates-feedback-pane");
      await setup.waitFor(() => nativeText(detail).includes(failure));
      expect(nativeText(detail)).toContain(failure);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test.each(["updates", "source"] as const)(
  "RENDER %s feedback keeps committed refresh diagnostics reachable in native Details",
  async (surface) => {
    const { snapshot, observation } = fixture();
    const state = createUpdatesState(
      buildUpdateScope(snapshot, { kind: "source", source: "team-main" }),
    );
    state.observe(observation);
    const message = `Updated; could not refresh workspace: ${"fixture refresh failure detail. ".repeat(20)}`;
    state.setResult("team-main", "succeeded");
    state.setStatus("team-main", "succeeded", message);
    state.markCommitted("team-main", message);
    const shared = { state, onCheck: () => {}, onUpdate: () => {}, onStop: () => {} };
    const setup = await testRender(
      () =>
        surface === "updates" ? (
          <UpdatesPage {...shared} />
        ) : (
          <SourceUpdatesPage
            {...shared}
            source="team-main"
            skills={snapshot.installedSkills}
            query=""
            filter="all"
            onQuery={() => {}}
            onFilter={() => {}}
            onSourceDetails={() => {}}
          />
        ),
      { width: 80, height: 24 },
    );
    try {
      await setup.waitForFrame((frame) => frame.includes("Updated; status unavailable"));
      const prefix = surface === "source" ? "source-updates" : "updates";
      const statusId =
        surface === "source"
          ? "source-updates-browser-row-team-main%00skill-000:cell-status"
          : "updates-browser-row-team-main:cell-status";
      await setup.waitFor(() => {
        const cell = setup.renderer.root.findDescendantById(statusId);
        return cell instanceof TextRenderable && cell.plainText === "Check needed";
      });
      await setup.waitForFrame((frame) => frame.includes("Check needed"));
      expect(setup.captureCharFrame()).not.toContain("Up to date");
      await enterLive(setup, `${prefix}-feedback-details`);
      const detail = live(setup, `${prefix}-feedback-pane`);
      if (!(detail instanceof ScrollBoxRenderable))
        throw new Error("Expected native diagnostics reader");
      await setup.waitFor(() => nativeText(detail).includes(message));
      expect(nativeText(detail)).toContain(message);
      state.applyCheck({
        source: "team-main",
        status: "failed",
        error: "Later check failed",
        stale: true,
      });
      expect(state.group("team-main")?.committed).toBe(true);
      await enterLive(setup, `${prefix}-feedback-details`);
      await setup.waitForFrame((frame) => frame.includes("Check failed"));
      await enterLive(setup, `${prefix}-feedback-details`);
      const later = live(setup, `${prefix}-feedback-pane`);
      await setup.waitFor(() => nativeText(later).includes("Later check failed"));
      expect(nativeText(later)).toContain("Later check failed");
    } finally {
      setup.renderer.destroy();
    }
  },
);

test.each(["empty", "unavailable"] as const)(
  "RENDER overview refuses %s scope without submitting through its primary action",
  async (kind) => {
    const { snapshot } = fixture(kind === "empty" ? 0 : 1);
    const scope = buildUpdateScope(
      snapshot,
      kind === "empty"
        ? { kind: "workspace" }
        : { kind: "skill", address: { source: "team-main", path: "missing" } },
    );
    const state = createUpdatesState(scope);
    expect(scope.unavailableReason).toBe(
      kind === "empty" ? undefined : "Skill is no longer installed",
    );
    const submitted: unknown[] = [];
    const setup = await testRender(
      () => (
        <UpdatesPage
          state={state}
          onCheck={() => {}}
          onUpdate={(items) => submitted.push(items)}
          onStop={() => {}}
        />
      ),
      { width: 80, height: 24 },
    );
    try {
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-update-all"));
      const action = live(setup, "updates-update-all");
      expect(action.focusable).toBe(false);
      await setup.mockMouse.click(action.screenX + 1, action.screenY);
      expect(submitted).toEqual([]);
    } finally {
      setup.renderer.destroy();
    }
  },
);
