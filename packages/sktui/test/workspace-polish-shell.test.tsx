import { afterEach, expect, test } from "bun:test";
import { Renderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { focusLive, parsedEnter, parsedEscape } from "./reader-test-controls";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

async function mount(width = 144, height = 40) {
  setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width, height },
  );
  await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("shell-section"));
  await setup.renderOnce();
}

test("page navigation is in the top bar and startup enters installed Skills", async () => {
  await mount();
  const top = setup!.renderer.root.findDescendantById("global-bar")!;
  const pages = top.findDescendantById("shell-section");
  expect(pages).toBeDefined();
  await setup!.waitFor(() => !!setup!.renderer.root.findDescendantById("installed-skill-browser"));
});

test("scope choices navigate only on activation and cancellation restores the trigger", async () => {
  await mount();
  await focusLive(setup!, "shell-section-tab-settings");
  await parsedEnter(setup!);
  await focusLive(setup!, "shell-scope-select");
  await parsedEnter(setup!);
  await setup!.waitFor(() => !!setup!.renderer.root.findDescendantById("scope-choices"));
  const choices = setup!.renderer.root.findDescendantById("scope-choices") as SelectRenderable;
  expect(choices.getSelectedIndex()).toBe(0);
  setup!.mockInput.pressArrow("down");
  await setup!.renderOnce();
  expect(setup!.captureCharFrame()).toContain("Scope: Global");
  await parsedEscape(setup!);
  await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "shell-scope-select");
  await parsedEnter(setup!);
  await setup!.waitFor(() => !!setup!.renderer.root.findDescendantById("scope-choices"));
  const reopened = setup!.renderer.root.findDescendantById("scope-choices") as SelectRenderable;
  expect(reopened.getSelectedOption()?.value).toBe("global");
  setup!.mockInput.pressArrow("down");
  await setup!.waitFor(() => reopened.getSelectedOption()?.value === "project");
  await parsedEnter(setup!);
  await setup!.waitFor(() => !!setup!.renderer.root.findDescendantById("settings-categories"));
  expect(setup!.captureCharFrame()).toContain("Scope: Project");
  expect(setup!.renderer.root.findDescendantById("shell-scope-select")).toBeInstanceOf(Renderable);
  await focusLive(setup!, "shell-scope-select");
  await setup!.waitForFrame(
    (frame) => frame.includes("Enter Change Scope") && frame.includes("Project ▾"),
  );
});

test("Settings Scope follows workspace navigation and Actions remains inside the terminal", async () => {
  await mount();
  await focusLive(setup!, "shell-section-tab-settings");
  await parsedEnter(setup!);
  const scope = setup!.renderer.root.findDescendantById("shell-scope-select")!;
  const actions = setup!.renderer.root.findDescendantById("shell-more-actions")!;
  for (const width of [144, 120, 100, 80, 43]) {
    setup!.resize(width, width === 43 ? 13 : 24);
    await setup!.renderOnce();
    expect(scope.screenX + scope.width).toBeLessThanOrEqual(width);
    expect(actions.screenX + actions.width).toBeLessThanOrEqual(width);
    const navigation = setup!.renderer.root.findDescendantById("workspace-navigation")!;
    expect(scope.screenY).toBe(navigation.screenY + navigation.height);
    expect(setup!.renderer.root.findDescendantById("shell-scope-select")).toBe(scope);
  }
});

test("a category pointer entry after choosing Scope cannot reactivate the Scope trigger", async () => {
  await mount(120, 40);
  await focusLive(setup!, "shell-section-tab-settings");
  await parsedEnter(setup!);
  await focusLive(setup!, "shell-scope-select");
  await parsedEnter(setup!);
  await setup!.waitFor(() => !!setup!.renderer.root.findDescendantById("scope-choices"));
  const choices = setup!.renderer.root.findDescendantById("scope-choices") as SelectRenderable;
  await setup!.flush();
  await setup!.mockMouse.click(choices.screenX + 5, choices.screenY + 1);
  await parsedEnter(setup!);
  await setup!.waitFor(() => !!setup!.renderer.root.findDescendantById("settings-categories"));
  const categories = setup!.renderer.root.findDescendantById(
    "settings-categories",
  ) as SelectRenderable;
  const index = categories.options.findIndex((option) => option.value === "collections");
  expect(index).toBeGreaterThanOrEqual(0);
  await setup!.mockMouse.click(categories.screenX + 2, categories.screenY + index);
  await setup!.renderOnce();
  expect(setup!.renderer.root.findDescendantById("scope-choices")).toBeUndefined();
  expect(setup!.renderer.currentFocusedRenderable?.id).not.toBe("shell-scope-select");
  await parsedEnter(setup!);
  await setup!.waitFor(() => {
    return !!setup!.renderer.root.findDescendantById("config-collection-browser");
  });
  expect(setup!.renderer.root.findDescendantById("scope-choices")).toBeUndefined();
});
