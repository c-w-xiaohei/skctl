/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { type Renderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { TabsTabRenderable } from "@tuiparts/core/tabs";
import { createSignal } from "solid-js";
import { SectionTabs } from "../src/components/section-tabs";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { enterLive, focusLive, parsedEnter } from "./reader-test-controls";

async function click(
  setup: Awaited<ReturnType<typeof testRender>>,
  target: Renderable,
  batched: boolean,
) {
  if (batched) {
    const x = target.screenX + 2,
      y = target.screenY + 1;
    // One actual parser input, as a PTY/network read can contain both events.
    setup.mockInput.pressKey(`\x1b[<0;${x};${y}M\x1b[<0;${x};${y}m`);
  } else await setup.mockMouse.click(target.screenX + 1, target.screenY);
  await setup.flush();
}

for (const activationMode of ["automatic", "manual"] as const) {
  test.each([true, false])(
    `${activationMode} native tab pointer selects once without entering content with batched events=%s`,
    async (batched) => {
      let navigations = 0,
        activations = 0;
      const [value, setValue] = createSignal("first");
      const setup = await testRender(
        () => (
          <SectionTabs
            id="pointer-tabs"
            value={value()}
            options={[
              { value: "first", label: "First" },
              { value: "second", label: "Second" },
            ]}
            owner="local-nav"
            activationMode={activationMode}
            activateOnReselect={false}
            onNavigate={(next) => {
              navigations++;
              setValue(next);
            }}
            onActivate={() => activations++}
          />
        ),
        { width: 80, height: 13 },
      );
      try {
        await setup.flush();
        const target = setup.renderer.root.findDescendantById(
          "pointer-tabs-tab-second",
        ) as TabsTabRenderable;
        await click(setup, target, batched);
        expect(value()).toBe("second");
        expect(target.getState().selected).toBe(true);
        expect(setup.renderer.currentFocusedRenderable).toBe(target);
        expect(navigations).toBe(1);
        expect(activations).toBe(0);
        await click(setup, target, batched);
        expect(navigations).toBe(1);
        expect(activations).toBe(0);
      } finally {
        setup.renderer.destroy();
      }
    },
  );
}

test.each(["global", "project", "local"] as const)(
  "one batched native click enters %s Collections after Scope changes without Enter",
  async (level) => {
    const core = directSourceCore(collectionsSourcesProjection());
    let writes = 0;
    core.collections.addMember = async () => {
      writes++;
      throw new Error("Tab selection must not write");
    };
    const setup = await testRender(() => <App core={core} exit={() => {}} />, {
      width: 144,
      height: 40,
    });
    try {
      await setup.flush();
      await enterLive(setup, "shell-scope-select");
      await setup.flush();
      const scope = setup.renderer.root.findDescendantById("scope-choices") as SelectRenderable;
      await focusLive(setup, scope.id);
      const index = scope.options.findIndex((option) => option.value === level);
      for (let step = 0; step < index; step++) {
        setup.mockInput.pressArrow("down");
        await setup.flush();
      }
      await parsedEnter(setup);
      await setup.flush();
      const target = setup.renderer.root.findDescendantById(
        `shell-section-${level}-tab-collections`,
      ) as TabsTabRenderable;
      expect(target.getState().selected).toBe(false);
      await click(setup, target, true);
      expect(target.getState().selected).toBe(true);
      if (level === "project")
        expect(setup.renderer.root.findDescendantById("config-collection-browser")).toBeDefined();
      expect(writes).toBe(0);
    } finally {
      setup.renderer.destroy();
    }
  },
);
