import { expect, spyOn, test } from "bun:test";
import { SelectRenderable, ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { App } from "../src/app";
import { ObjectMenu } from "../src/object-menu";
import { Button } from "../src/ui/button";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { openMainPage } from "./main-page-controls";
import { enterLive, focusLive, live, parsedEscape } from "./reader-test-controls";

test("Long object commands and disabled reasons stay readable in a bounded scrollable menu", async () => {
  const calls: number[] = [];
  const commands = Array.from({ length: 12 }, (_, index) => ({
    record: {
      id: `item-${index}`,
      verb: `Inspect configuration declaration number ${index}`,
      destination: "Current object",
      scope: "page" as const,
      keys: ["enter"],
      enabled: index !== 0,
      disabledReason: index === 0 ? "Read-only configuration" : undefined,
      danger: false,
    },
    execute: () => {
      calls.push(index);
    },
  }));
  const setup = await testRender(() => <ObjectMenu id="long-more" commands={commands} />, {
    width: 43,
    height: 13,
  });
  try {
    await enterLive(setup, "long-more");
    await setup.flush();
    const menu = live(setup, "long-more-dialog");
    expect(menu.height).toBeLessThanOrEqual(11);
    expect(setup.captureCharFrame()).toContain("Read-only configuration");
    const first = live(setup, "long-more-item-1");
    expect(first.height).toBeGreaterThan(1);
    for (let i = 0; i < 10; i++) {
      setup.mockInput.pressArrow("down");
      await setup.flush();
    }
    const last = live(setup, "long-more-item-11");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(last.id);
    const body = live(setup, "long-more-body") as ScrollBoxRenderable;
    expect(body.scrollTop).toBeGreaterThan(0);
    expect(last.screenY).toBeGreaterThanOrEqual(body.viewport.screenY);
    expect(last.screenY + last.height).toBeLessThanOrEqual(
      body.viewport.screenY + body.viewport.height,
    );
    expect(calls).toEqual([]);
    await enterLive(setup, last.id);
    expect(calls).toEqual([11]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Object menu starts on an available command and skips disabled commands in both directions", async () => {
  const calls: string[] = [];
  const commands = ["blocked", "read", "blocked-again", "refresh"].map((id) => ({
    record: {
      id,
      verb: id,
      destination: "Current object",
      scope: "page" as const,
      keys: ["enter"],
      enabled: !id.startsWith("blocked"),
      danger: false,
    },
    execute: () => {
      calls.push(id);
    },
  }));
  const setup = await testRender(() => <ObjectMenu id="object-more" commands={commands} />, {
    width: 43,
    height: 13,
  });
  try {
    await enterLive(setup, "object-more");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("object-more-read");
    setup.mockInput.pressArrow("down");
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("object-more-refresh");
    setup.mockInput.pressArrow("up");
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("object-more-read");
    expect(calls).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Object menu closes when its target changes without stealing the new target's focus", async () => {
  const [target, setTarget] = createSignal("alpha");
  const commands = [
    {
      record: {
        id: "read",
        verb: "Read",
        destination: "Current object",
        scope: "page" as const,
        keys: ["enter"],
        enabled: true,
        danger: false,
      },
      execute() {},
    },
  ];
  const setup = await testRender(
    () => (
      <box>
        <Button id="next-object" label="Next object" />
        <ObjectMenu id="object-more" target={target()} commands={commands} />
      </box>
    ),
    { width: 43, height: 13 },
  );
  try {
    await enterLive(setup, "object-more");
    expect(!!setup.renderer.root.findDescendantById("object-more-dialog")).toBe(true);
    await focusLive(setup, "next-object");
    setTarget("beta");
    await setup.flush();
    expect(!!setup.renderer.root.findDescendantById("object-more-dialog")).toBe(false);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("next-object");
    setTarget("alpha");
    await setup.flush();
    expect(!!setup.renderer.root.findDescendantById("object-more-dialog")).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

test("Source More releases its portal once on repeated close and page exit", async () => {
  const warnings: string[] = [];
  const warn = spyOn(console, "warn").mockImplementation((message) => {
    warnings.push(String(message));
  });
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 43, height: 30 },
  );
  try {
    await openMainPage(setup, "sources");
    await enterLive(setup, "source-browser");
    for (let i = 0; i < 3; i++) {
      await enterLive(setup, "source-more");
      await parsedEscape(setup);
    }
    await openMainPage(setup, "skills");
    expect(warnings.filter((message) => message.includes("skipping remove"))).toEqual([]);
  } finally {
    setup.renderer.destroy();
    warn.mockRestore();
  }
});

test.each([43, 100])(
  "Updates Source toolbar keeps its primary action and More inside the object at %i columns",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
      { width, height: 24 },
    );
    try {
      await openMainPage(setup, "updates");
      await enterLive(setup, "updates-browser");
      await setup.flush();
      const pane = live(setup, "source-updates-actions-pane");
      const more = live(setup, "source-updates-more");
      expect(more.screenX + more.width).toBeLessThanOrEqual(pane.screenX + pane.width);
      expect(more.screenY + more.height).toBeLessThanOrEqual(pane.screenY + pane.height);
      await enterLive(setup, "source-updates-more");
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(
        "source-updates-more-source-updates.update-skill",
      );
      setup.mockInput.pressArrow("down");
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(
        "source-updates-more-source-updates.show-all",
      );
      await parsedEscape(setup);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-updates-more");
      await enterLive(setup, "source-updates-more");
      expect(
        !!setup.renderer.root.findDescendantById("source-updates-more-source-updates.show-all"),
      ).toBe(true);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("Agent connections reserve one action row and expose Refresh through More at 43 columns", async () => {
  let inspections = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection())}
        integrations={{
          inspect: async (target) => {
            inspections++;
            return {
              target,
              recommended: "default",
              selectionReason: "Instruction file",
              cli: "/bin/skctl",
              revision: "one",
              entries: [],
              candidates: [],
              diagnostics: [],
              nextSteps: [],
            };
          },
          connect: async () => {
            throw new Error("Unexpected connect");
          },
          disconnect: async () => {
            throw new Error("Unexpected disconnect");
          },
        }}
        exit={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await openMainPage(setup, "agent");
    await enterLive(setup, "agent-view-tab-global");
    await enterLive(setup, "integration-hosts");
    await setup.flush();
    const row = live(setup, "integration-actions-pane");
    expect(row.height).toBe(1);
    const more = live(setup, "integration-more");
    expect(more.screenX + more.width).toBeLessThanOrEqual(row.screenX + row.width);
    expect(!!setup.renderer.root.findDescendantById("integration-refresh")).toBe(false);
    await enterLive(setup, "integration-more");
    const before = inspections;
    await enterLive(setup, "integration-more-integration.refresh");
    await setup.waitFor(() => inspections === before + 1);
  } finally {
    setup.renderer.destroy();
  }
});

test.each([43, 100, 120])(
  "Source object actions use one row at %i columns and hidden checks stay discoverable",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
      { width, height: 24 },
    );
    try {
      await openMainPage(setup, "sources");
      await enterLive(setup, "source-browser");
      const actions = live(setup, "source-content-controls-pane");
      await setup.flush();
      expect(actions.height).toBe(1);
      const install = live(setup, "workspace-action-add-skills");
      const more = setup.renderer.root.findDescendantById("source-more");
      if (more) {
        expect(more.screenY).toBe(install.screenY);
        expect(more.screenX + more.width).toBeLessThanOrEqual(actions.screenX + actions.width);
      } else {
        expect(!!setup.renderer.root.findDescendantById("workspace-action-check-updates")).toBe(
          true,
        );
      }
      if (width === 43) {
        expect(!!setup.renderer.root.findDescendantById("workspace-action-check-updates")).toBe(
          false,
        );
        await enterLive(setup, "source-more");
        expect(!!setup.renderer.root.findDescendantById("source-more-check-updates")).toBe(true);
        await parsedEscape(setup);
        await enterLive(setup, "shell-more-actions");
        const choices = (await focusLive(setup, "palette-choices")) as SelectRenderable;
        expect(choices.options.some((option) => option.value.id === "check-updates")).toBe(true);
      }
    } finally {
      setup.renderer.destroy();
    }
  },
);
