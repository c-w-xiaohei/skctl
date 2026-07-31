/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { SectionTabs } from "../../src/tui/components/section-tabs";
import { createFocusRegistry } from "../../src/tui/focus";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

async function renderTabs() {
  const registry = createFocusRegistry();
  const navigations: string[] = [];
  const pointerEntries: string[] = [];
  const [value, setValue] = createSignal("skills");
  setup = await testRender(
    () => (
      <SectionTabs
        id="workspace-section-browser"
        options={[
          { label: "Skills", value: "skills" },
          { label: "Collections", value: "collections" },
          { label: "Sources", value: "sources" },
        ]}
        value={value()}
        owner="local-nav"
        focusRegistry={registry}
        onPrimaryPointerEntry={() => pointerEntries.push("local-nav")}
        onNavigate={(next) => {
          navigations.push(next);
          setValue(next);
        }}
      />
    ),
    { width: 50, height: 3 },
  );
  await setup.renderOnce();
  return { navigations, pointerEntries, registry, value };
}

test("SectionTabs registers the selected trigger under its focus owner with stable ids", async () => {
  const { registry } = await renderTabs();
  expect(
    setup!.renderer.root.findDescendantById("workspace-section-browser-tab-skills"),
  ).toBeDefined();
  expect(registry.applyFocus("local-nav")).toBe(true);
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("workspace-section-browser-tab-skills");
});

test("SectionTabs delegates automatic keyboard navigation and ignores same-value selection intent", async () => {
  const { navigations, registry, value } = await renderTabs();
  registry.applyFocus("local-nav");
  setup!.mockInput.pressEnter();
  await setup!.renderOnce();
  setup!.mockInput.pressKey(" ");
  await setup!.renderOnce();
  expect(navigations).toEqual([]);

  setup!.mockInput.pressArrow("right");
  await setup!.renderOnce();
  expect(value()).toBe("collections");
  expect(navigations).toEqual(["collections"]);

  setup!.mockInput.pressKey("END");
  await setup!.renderOnce();
  expect(value()).toBe("sources");
  setup!.mockInput.pressKey("HOME");
  await setup!.renderOnce();
  expect(value()).toBe("skills");
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("workspace-section-browser-tab-skills");

  for (const next of ["collections", "sources", "skills"] as const) {
    setup!.mockInput.pressArrow("right");
    await setup!.renderOnce();
    expect(value()).toBe(next);
    expect(setup!.renderer.currentFocusedRenderable?.id).toBe(
      `workspace-section-browser-tab-${next}`,
    );
  }
  expect(navigations).toEqual([
    "collections",
    "sources",
    "skills",
    "collections",
    "sources",
    "skills",
  ]);
});

test("SectionTabs delegates pointer selection through controlled navigation", async () => {
  const { navigations, pointerEntries, value } = await renderTabs();
  const third = setup!.renderer.root.findDescendantById("workspace-section-browser-tab-sources");
  await setup!.mockMouse.click(third!.screenX + 1, third!.screenY);
  await setup!.renderOnce();
  expect(value()).toBe("sources");
  expect(navigations).toEqual(["sources"]);
  expect(pointerEntries).toEqual(["local-nav"]);
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe(
    "workspace-section-browser-tab-sources",
  );
});

test("SectionTabs reports primary pointer entry for an already selected trigger without navigation", async () => {
  const { navigations, pointerEntries, value } = await renderTabs();
  const selected = setup!.renderer.root.findDescendantById("workspace-section-browser-tab-skills");
  await setup!.mockMouse.click(selected!.screenX + 1, selected!.screenY);
  await setup!.renderOnce();
  expect(value()).toBe("skills");
  expect(navigations).toEqual([]);
  expect(pointerEntries).toEqual(["local-nav"]);
});

test("SectionTabs preserves focus for modified primitive navigation keys", async () => {
  const { registry, value } = await renderTabs();
  expect(registry.applyFocus("local-nav")).toBe(true);
  setup!.mockInput.pressArrow("right", { shift: true });
  await setup!.renderOnce();
  expect(value()).toBe("skills");
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("workspace-section-browser-tab-skills");
});

test("SectionTabs rebinds focus when its controlled value changes outside navigation", async () => {
  const registry = createFocusRegistry();
  const [value, setValue] = createSignal<"skills" | "collections">("skills");
  setup = await testRender(
    () => (
      <SectionTabs
        id="controlled-tabs"
        options={[
          { label: "Skills", value: "skills" },
          { label: "Collections", value: "collections" },
        ]}
        value={value()}
        owner="local-nav"
        focusRegistry={registry}
        onNavigate={() => {}}
      />
    ),
    { width: 50, height: 3 },
  );
  await setup.renderOnce();
  setValue("collections");
  await setup.renderOnce();
  expect(registry.applyFocus("local-nav")).toBe(true);
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("controlled-tabs-tab-collections");
});

test("SectionTabs preserves physical focus across an external controlled selection change", async () => {
  const registry = createFocusRegistry();
  const [value, setValue] = createSignal<"skills" | "collections">("skills");
  setup = await testRender(
    () => (
      <SectionTabs
        id="externally-controlled-tabs"
        options={[
          { label: "Skills", value: "skills" },
          { label: "Collections", value: "collections" },
        ]}
        value={value()}
        owner="local-nav"
        focusRegistry={registry}
        onNavigate={() => {}}
      />
    ),
    { width: 50, height: 3 },
  );
  await setup.renderOnce();
  expect(registry.applyFocus("local-nav")).toBe(true);
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("externally-controlled-tabs-tab-skills");

  setValue("collections");
  await setup.renderOnce();
  expect(value()).toBe("collections");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("externally-controlled-tabs-tab-skills");

  setup.renderer.currentFocusedRenderable?.blur();
  expect(registry.applyFocus("local-nav")).toBe(true);
  expect(setup.renderer.currentFocusedRenderable?.id).toBe(
    "externally-controlled-tabs-tab-collections",
  );
});

test("SectionTabs clears stale focus before clicking an externally selected trigger", async () => {
  const registry = createFocusRegistry();
  const [value, setValue] = createSignal<"skills" | "collections" | "sources">("skills");
  setup = await testRender(
    () => (
      <SectionTabs
        id="external-pointer-tabs"
        options={[
          { label: "Skills", value: "skills" },
          { label: "Collections", value: "collections" },
          { label: "Sources", value: "sources" },
        ]}
        value={value()}
        owner="local-nav"
        focusRegistry={registry}
        onNavigate={setValue}
      />
    ),
    { width: 50, height: 3 },
  );
  await setup.renderOnce();
  expect(registry.applyFocus("local-nav")).toBe(true);
  setValue("collections");
  await setup.renderOnce();
  const collections = setup.renderer.root.findDescendantById(
    "external-pointer-tabs-tab-collections",
  );
  await setup.mockMouse.click(collections!.screenX + 1, collections!.screenY);
  await setup.renderOnce();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("external-pointer-tabs-tab-collections");

  setup!.mockInput.pressArrow("right");
  await setup!.renderOnce();
  expect(value()).toBe("sources");
  setup!.mockInput.pressArrow("right");
  await setup!.renderOnce();
  expect(value()).toBe("skills");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("external-pointer-tabs-tab-skills");
});

test("SectionTabs preserves registry registration for a retained selected trigger", async () => {
  const registry = createFocusRegistry();
  const [value, setValue] = createSignal<"skills" | "collections">("skills");
  const [options, setOptions] = createSignal<
    readonly { label: string; value: "skills" | "collections" }[]
  >([
    { label: "Skills", value: "skills" },
    { label: "Collections", value: "collections" },
  ]);
  setup = await testRender(
    () => (
      <SectionTabs
        id="stable-tabs"
        options={options()}
        value={value()}
        owner="local-nav"
        focusRegistry={registry}
        onNavigate={() => {}}
      />
    ),
    { width: 50, height: 3 },
  );
  await setup.renderOnce();
  const initialTarget = registry.target("local-nav");
  const initialVersion = registry.version();
  setOptions([
    { label: "Skills updated", value: "skills" },
    { label: "Collections updated", value: "collections" },
  ]);
  await setup.renderOnce();
  expect(registry.target("local-nav")).toBe(initialTarget);
  expect(registry.version()).toBe(initialVersion);

  setValue("collections");
  await setup.renderOnce();
  expect(registry.target("local-nav")).not.toBe(initialTarget);
  expect(registry.version()).toBeGreaterThan(initialVersion);
});

test("SectionTabs clears and replaces its registry target as selected options unmount", async () => {
  const registry = createFocusRegistry();
  const [options, setOptions] = createSignal<
    readonly { label: string; value: "skills" | "collections" }[]
  >([
    { label: "Skills", value: "skills" },
    { label: "Collections", value: "collections" },
  ]);
  setup = await testRender(
    () => (
      <SectionTabs
        id="dynamic-tabs"
        options={options()}
        value="collections"
        owner="local-nav"
        focusRegistry={registry}
        onNavigate={() => {}}
      />
    ),
    { width: 50, height: 3 },
  );
  await setup.renderOnce();
  expect((registry.target("local-nav") as { id?: string } | undefined)?.id).toBe(
    "dynamic-tabs-tab-collections",
  );
  setOptions([{ label: "Skills", value: "skills" }]);
  await setup.renderOnce();
  expect(registry.target("local-nav")).toBeUndefined();
  setOptions([{ label: "Collections", value: "collections" }]);
  await setup.renderOnce();
  expect((registry.target("local-nav") as { id?: string } | undefined)?.id).toBe(
    "dynamic-tabs-tab-collections",
  );
});

test("SectionTabs releases its registry target when unmounted", async () => {
  const registry = createFocusRegistry();
  const [visible, setVisible] = createSignal(true);
  setup = await testRender(
    () => (
      <Show when={visible()}>
        <SectionTabs
          id="teardown-tabs"
          options={[{ label: "Skills", value: "skills" }]}
          value="skills"
          owner="local-nav"
          focusRegistry={registry}
          onNavigate={() => {}}
        />
      </Show>
    ),
    { width: 50, height: 3 },
  );
  await setup.renderOnce();
  expect(registry.target("local-nav")).toBeDefined();
  setVisible(false);
  await setup.renderOnce();
  expect(registry.target("local-nav")).toBeUndefined();
});
