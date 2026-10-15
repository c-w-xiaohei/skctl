/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { TabsTabRenderable } from "@tuiparts/core/tabs";
import { createSignal, Show } from "solid-js";
import { SectionTabs } from "../src/components/section-tabs";
import { createFocusRegistry } from "../src/focus";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

test("narrow section navigation reveals the complete active tab without clipping", async () => {
  const [value, setValue] = createSignal("sources");
  setup = await testRender(
    () => (
      <SectionTabs
        id="sections"
        owner="local-nav"
        value={value()}
        options={[
          { label: "Sources", value: "sources" },
          { label: "Config Sources", value: "configs" },
          { label: "Collections", value: "collections" },
          { label: "Integrations", value: "integrations" },
        ]}
        onNavigate={setValue}
      />
    ),
    { width: 43, height: 13 },
  );
  await setup.renderOnce();
  setup.renderer.root.findDescendantById("sections-tab-sources")!.focus();
  for (const next of ["configs", "collections", "integrations"]) {
    setup.mockInput.pressArrow("right");
    await setup.waitFor(() => value() === next);
    await setup.renderOnce();
    const tab = setup.renderer.root.findDescendantById(`sections-tab-${next}`)!;
    expect(tab.screenX).toBeGreaterThanOrEqual(0);
    expect(tab.screenX + tab.width).toBeLessThanOrEqual(43);
  }
  await setup.waitFor(
    () =>
      (
        setup!.renderer.root.findDescendantById("sections-tab-integrations") as TabsTabRenderable
      ).getState().selected,
  );
  setup.resize(80, 13);
  await setup.renderOnce();
  setup.resize(43, 13);
  await setup.waitForFrame((frame) => frame.includes("Integrations"));
  const active = setup.renderer.root.findDescendantById("sections-tab-integrations")!;
  expect(active.screenX + active.width).toBeLessThanOrEqual(43);
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

test("focusing an inactive native tab releases the previous roving stop before it becomes nonfocusable", async () => {
  const { value } = await renderTabs();
  const first = setup!.renderer.root.findDescendantById(
    "workspace-section-browser-tab-skills",
  ) as TabsTabRenderable;
  const sources = setup!.renderer.root.findDescendantById(
    "workspace-section-browser-tab-sources",
  ) as TabsTabRenderable;
  first.focus();
  sources.focus();
  expect(setup!.renderer.currentFocusedRenderable).toBe(sources);
  expect(first.focused).toBe(false);
  setup!.mockInput.pressEnter();
  await setup!.waitFor(() => value() === "sources");
  expect(first.focused).toBe(false);
});

test("an unavailable native tab cannot blur the live roving stop", async () => {
  await renderTabs();
  const first = setup!.renderer.root.findDescendantById(
    "workspace-section-browser-tab-skills",
  ) as TabsTabRenderable;
  const sources = setup!.renderer.root.findDescendantById(
    "workspace-section-browser-tab-sources",
  ) as TabsTabRenderable;
  first.focus();
  sources.visible = false;
  sources.focus();
  expect(setup!.renderer.currentFocusedRenderable).toBe(first);
  expect(first.focused).toBe(true);
  expect(sources.focused).toBe(false);
});

test("resizing a focused middle Section keeps its entire selected token visible", async () => {
  const [value, setValue] = createSignal("sources");
  const [width, setWidth] = createSignal(120);
  setup = await testRender(
    () => (
      <box width={width()} height="100%">
        <SectionTabs
          id="resize-sections"
          owner="local-nav"
          value={value()}
          options={[
            { label: "Sources", value: "sources" },
            { label: "Config Sources", value: "configs" },
            { label: "Collections", value: "collections" },
            { label: "Integrations", value: "integrations" },
          ]}
          onNavigate={setValue}
        />
      </box>
    ),
    { width: 120, height: 30 },
  );
  await setup.renderOnce();
  setup.renderer.root.findDescendantById("resize-sections-tab-sources")!.focus();
  setup.mockInput.pressArrow("right");
  setup.mockInput.pressArrow("right");
  await setup.renderOnce();
  expect(value()).toBe("collections");
  for (const columns of [80, 43, 120, 43]) {
    setWidth(columns);
    await setup.renderOnce();
    await setup.renderOnce();
    const active = setup.renderer.root.findDescendantById("resize-sections-tab-collections")!;
    expect(active.screenX).toBeGreaterThanOrEqual(0);
    expect(active.screenX + active.width).toBeLessThanOrEqual(columns);
    expect((active as TabsTabRenderable).getState().selected).toBe(true);
  }
});

test("Context pointer immediately activates Project and Space does not switch it again", async () => {
  const { context, navigations } = await renderContextTabs();
  const project = setup!.renderer.root.findDescendantById("context-tab-project")!;
  await setup!.mockMouse.click(project.screenX + 1, project.screenY);
  await setup!.renderOnce();
  expect(context()).toBe("project");
  expect(navigations).toEqual(["project"]);
  setup!.mockInput.pressKey(" ");
  await setup!.renderOnce();
  expect(navigations).toEqual(["project"]);
});

test("SectionTabs registers the selected trigger under its focus owner with stable ids", async () => {
  const { registry } = await renderTabs();
  expect(
    setup!.renderer.root.findDescendantById("workspace-section-browser-tab-skills"),
  ).toBeInstanceOf(TabsTabRenderable);
  expect(
    setup!.renderer.root.findDescendantById("workspace-section-browser-tab-skills"),
  ).toBeDefined();
  expect(registry.applyFocus("local-nav")).toBe(true);
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("workspace-section-browser-tab-skills");
});

test("SectionTabs renders its label before compact captions without changing tab identities", async () => {
  const registry = createFocusRegistry();
  const navigations: string[] = [];
  const [value, setValue] = createSignal<"sources" | "collections">("sources");
  setup = await testRender(
    () => (
      <SectionTabs
        id="config-section-browser"
        label="Section"
        compact
        options={[
          { label: "Sources", compactLabel: "Src", value: "sources" },
          { label: "Collections", compactLabel: "Coll", value: "collections" },
        ]}
        value={value()}
        owner="local-nav"
        focusRegistry={registry}
        onNavigate={(next) => {
          navigations.push(next);
          setValue(next);
        }}
      />
    ),
    { width: 30, height: 3 },
  );
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame.indexOf("Section:")).toBeLessThan(frame.indexOf("Src"));
  expect(frame).not.toContain("Sources");
  const sources = setup.renderer.root.findDescendantById("config-section-browser-tab-sources")!;
  const collections = setup.renderer.root.findDescendantById(
    "config-section-browser-tab-collections",
  )!;
  expect(sources.screenY).toBe(collections.screenY);
  expect(registry.applyFocus("local-nav")).toBe(true);
  setup.mockInput.pressArrow("right");
  await setup.renderOnce();
  expect(value()).toBe("collections");
  await setup.mockMouse.click(sources.screenX + 1, sources.screenY);
  await setup.renderOnce();
  expect(value()).toBe("sources");
  expect(navigations).toEqual(["collections", "sources"]);
});

async function renderContextTabs() {
  const registry = createFocusRegistry();
  const [context, setContext] = createSignal<"workspace" | "global" | "project">("workspace");
  const navigations: string[] = [];
  setup = await testRender(
    () => (
      <SectionTabs
        id="context"
        options={[
          { label: "Workspace", value: "workspace" },
          { label: "Global", value: "global" },
          { label: "Project", value: "project" },
        ]}
        value={context()}
        owner="top-nav"
        focusRegistry={registry}
        onNavigate={(value) => {
          navigations.push(value);
          setContext(value);
        }}
      />
    ),
    { width: 60, height: 3 },
  );
  await setup.renderOnce();
  expect(registry.applyFocus("top-nav")).toBe(true);
  return { context, navigations };
}

test("Context Right immediately changes the active token while native Tabs transfers physical focus", async () => {
  const { context, navigations } = await renderContextTabs();
  const prior = setup!.renderer.root.findDescendantById("context-tab-workspace")!;
  setup!.mockInput.pressArrow("right");
  await setup!.renderOnce();
  expect(prior === setup!.renderer.root.findDescendantById("context-tab-workspace")).toBe(true);
  const workspace = setup!.renderer.root.findDescendantById(
    "context-tab-workspace",
  ) as TabsTabRenderable;
  const global = setup!.renderer.root.findDescendantById("context-tab-global") as TabsTabRenderable;
  expect(context()).toBe("global");
  expect(navigations).toEqual(["global"]);
  expect(setup!.renderer.currentFocusedRenderable).toBe(global);
  expect(workspace.focused).toBe(false);
  expect(global.focused).toBe(true);
  setup!.mockInput.pressEnter();
  await setup!.renderOnce();
  expect(navigations).toEqual(["global"]);
});

test("Context synchronous Rights retain the native Project target without Enter activation", async () => {
  const { context, navigations } = await renderContextTabs();
  setup!.mockInput.pressArrow("right");
  setup!.mockInput.pressArrow("right");
  expect(context()).toBe("project");
  expect(navigations).toEqual(["global", "project"]);
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("context-tab-project");
});

test("SectionTabs stays horizontal and switches immediately with horizontal keys", async () => {
  const registry = createFocusRegistry();
  const [value, setValue] = createSignal<"skills" | "collections" | "sources">("skills");
  setup = await testRender(
    () => (
      <SectionTabs
        id="workspace-section-browser"
        label="Navigation"
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
  const skills = setup.renderer.root.findDescendantById("workspace-section-browser-tab-skills")!;
  const collections = setup.renderer.root.findDescendantById(
    "workspace-section-browser-tab-collections",
  )!;
  expect((skills as TabsTabRenderable).getState().selected).toBe(true);
  expect((collections as TabsTabRenderable).getState().selected).toBe(false);
  expect(skills.screenY).toBe(collections.screenY);
  expect(registry.applyFocus("local-nav")).toBe(true);
  setup.mockInput.pressArrow("right");
  await setup.renderOnce();
  expect(value()).toBe("collections");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe(
    "workspace-section-browser-tab-collections",
  );
});

test("SectionTabs automatic navigation retains the selected physical trigger and clamps at either end", async () => {
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
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe(
    "workspace-section-browser-tab-collections",
  );
  expect(navigations).toEqual(["collections"]);

  for (const next of ["sources", "sources"] as const) {
    setup!.mockInput.pressArrow("right");
    await setup!.renderOnce();
    expect(value()).toBe(next);
    expect(setup!.renderer.currentFocusedRenderable?.id).toBe(
      `workspace-section-browser-tab-${next}`,
    );
  }
  setup!.mockInput.pressArrow("right");
  await setup!.renderOnce();
  expect(value()).toBe("sources");
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe(
    "workspace-section-browser-tab-sources",
  );
  setup!.mockInput.pressArrow("left");
  setup!.mockInput.pressArrow("left");
  setup!.mockInput.pressArrow("left");
  await setup!.renderOnce();
  expect(value()).toBe("skills");
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("workspace-section-browser-tab-skills");
  expect(navigations).toEqual(["collections", "sources", "collections", "skills"]);
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
  expect(value()).toBe("sources");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("external-pointer-tabs-tab-sources");
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
  await setup.waitFor(() => !registry.target("local-nav"));
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
  expect(Boolean(registry.target("local-nav"))).toBe(false);
});
