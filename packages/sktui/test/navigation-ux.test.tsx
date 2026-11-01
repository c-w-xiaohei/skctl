import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { App } from "../src/app";
import { SectionTabs } from "../src/components/section-tabs";
import { createFocusRegistry } from "../src/focus";
import { DataList } from "../src/ui/data-list";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { enterLive, parsedEscape } from "./reader-test-controls";
test("DataList keeps the selected label column fixed when physical focus changes", async () => {
  const setup = await testRender(
    () => (
      <box flexDirection="column">
        <DataList
          id="installed-skill-browser"
          width={40}
          height={4}
          showDescription={false}
          options={[
            { name: "guide", description: "Guide", value: "guide" },
            { name: "reference", description: "Reference", value: "reference" },
          ]}
          selectedIndex={0}
        />
        <box id="focus-away" focusable />
      </box>
    ),
    { width: 40, height: 6 },
  );
  try {
    await setup.renderOnce();
    const list = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    list.focus();
    await setup.renderOnce();
    const focusedFrame = setup.captureCharFrame();
    const focusedLabel = focusedFrame.indexOf("guide");
    expect(focusedLabel).toBeGreaterThanOrEqual(0);
    setup.renderer.root.findDescendantById("focus-away")!.focus();
    await setup.renderOnce();
    const blurredFrame = setup.captureCharFrame();
    expect(blurredFrame.indexOf("guide")).toBe(focusedLabel);
    expect(blurredFrame).toContain("reference");
  } finally {
    setup.renderer.destroy();
  }
});
test("DataList truncates wide labels on resize without changing native option identity or selection", async () => {
  const address = "team-main/指南/非常长的技能名称";
  let changes = 0;
  const setup = await testRender(
    () => (
      <DataList
        id="installed-skill-browser"
        width="100%"
        height={5}
        options={[
          { name: address, description: "A wide-character description", value: address },
          { name: "other", description: "Other", value: "other" },
        ]}
        selectedIndex={0}
        onChange={() => changes++}
      />
    ),
    { width: 36, height: 5 },
  );
  try {
    await setup.renderOnce();
    const list = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    setup.resize(14, 5);
    await setup.waitFor(() => list.options[0]?.name.includes("…") === true);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("…");
    expect(frame).not.toContain(address);
    expect(list.options[0]?.value).toBe(address);
    expect(list.getSelectedIndex()).toBe(0);
    expect(changes).toBe(0);
    setup.resize(36, 5);
    await setup.renderOnce();
    expect(list.options[0]?.value).toBe(address);
    expect(list.getSelectedIndex()).toBe(0);
    expect(changes).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});
test("SectionTabs keeps native tab positions stable across focus and selection", async () => {
  const [value, setValue] = createSignal("skills");
  const registry = createFocusRegistry();
  const setup = await testRender(
    () => (
      <SectionTabs
        id="shell-section-navigation"
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
    { width: 80, height: 4 },
  );
  try {
    await setup.renderOnce();
    const ids = ["skills", "collections", "sources"].map(
      (section) => `shell-section-navigation-tab-${section}`,
    );
    const initialX = ids.map((id) => setup.renderer.root.findDescendantById(id)!.screenX);
    const initialLabelX = setup.captureCharFrame().indexOf("Skills");
    setup.renderer.root.findDescendantById(ids[0]!)!.focus();
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(value()).toBe("collections");
    expect(ids.map((id) => setup.renderer.root.findDescendantById(id)!.screenX)).toEqual(initialX);
    expect(setup.captureCharFrame().indexOf("Skills")).toBe(initialLabelX);
    setup.renderer.currentFocusedRenderable?.blur();
    await setup.renderOnce();
    expect(ids.map((id) => setup.renderer.root.findDescendantById(id)!.screenX)).toEqual(initialX);
    expect(setup.captureCharFrame().indexOf("Skills")).toBe(initialLabelX);
  } finally {
    setup.renderer.destroy();
  }
});
function wideCollectionProjection() {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  return {
    ...base,
    effective: {
      ...base.effective,
      collections: ["alpha", "bravo"],
      collectionsView: ["alpha", "bravo"].map((id) => ({
        id,
        declared: [],
        repository: { derived: false, producers: [] },
        members:
          id === "alpha"
            ? [
                {
                  name: "guide",
                  address: { source: "team-main", path: "guide" },
                  paths: [],
                },
              ]
            : [],
        references: [],
        links: [],
      })),
    },
  };
}
async function openCollections(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.flush();
  await enterLive(setup, "shell-section-tab-collections");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));
  await setup.flush();
}
test("wide Collections retain the browser beside root details without a Back frame", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(wideCollectionProjection())} exit={() => {}} />,
    { width: 140, height: 40 },
  );
  try {
    await openCollections(setup);
    const browser = setup.renderer.root.findDescendantById("collection-browser")!;
    await enterLive(setup, "collection-browser");
    expect(setup.renderer.root.findDescendantById("collection-relationships")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("route-back")).toBeUndefined();
    const ownership = setup.renderer.root.findDescendantById("collection-current-details")!;
    expect(ownership).toBeDefined();
    await setup.mockMouse.click(ownership.screenX + 1, ownership.screenY);
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("collection-browser")).toBeDefined();
    expect(!!setup.renderer.root.findDescendantById("collection-relationships")).toBe(true);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-membership-inspector"),
    );
    expect(setup.renderer.root.findDescendantById("collection-browser")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("collection-membership-inspector")).toBeDefined();
    const retainedBrowser = setup.renderer.root.findDescendantById("collection-browser")!;
    expect(retainedBrowser === browser).toBe(true);
    retainedBrowser.focus();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("bravo"));
    await enterLive(setup, "collection-browser");
    expect(setup.renderer.root.findDescendantById("collection-relationships")).toBeDefined();
    expect(!!setup.renderer.root.findDescendantById("collection-membership-inspector")).toBe(false);
    expect(setup.renderer.root.findDescendantById("collection-browser") === retainedBrowser).toBe(
      true,
    );
  } finally {
    setup.renderer.destroy();
  }
});
test("Source Inspector exposes Check Updates directly and leaving its workbench prevents mutation", async () => {
  const observationCalls: unknown[] = [];
  const updateCalls: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          getUpdateBaseline: async () => ({ value: "baseline:test", diagnostics: [] }),
          checkUpdate: async (_environment: import("@skctl/core").CoreOptions, request) => {
            observationCalls.push(request);
            return {
              value: {
                source: request.source,
                kind: "github",
                exactRevision: "ux-update-review",
                changed: [{ path: "guide", name: "guide", description: "Changed guide" }],
                added: [],
                removed: [],
                unchanged: [],
                baseline: "baseline:test",
              },
              diagnostics: [],
            };
          },
          updateSkills: async (_environment: import("@skctl/core").CoreOptions, request) => {
            updateCalls.push(request);
            return { value: undefined, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 140, height: 40 },
  );
  try {
    await setup.flush();
    await enterLive(setup, "shell-section-tab-sources");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    const checkUpdates = setup.renderer.root.findDescendantById("workspace-action-check-updates");
    expect(checkUpdates).toBeDefined();
    expect(setup.renderer.root.findDescendantById("palette-check-updates")).toBeUndefined();
    checkUpdates!.focus();
    setup.mockInput.pressEnter();
    await setup.waitFor(() => observationCalls.length > 0);
    expect(
      observationCalls.every(
        (request) =>
          (
            request as {
              source: string;
            }
          ).source === "team-main",
      ),
    ).toBe(true);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
    expect(setup.renderer.root.findDescendantById("source-operation-selection")).toBeUndefined();
    expect(updateCalls).toEqual([]);
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    expect(updateCalls).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
