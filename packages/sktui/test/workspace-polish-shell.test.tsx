import { afterEach, expect, test } from "bun:test";
import { Renderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { TabsTabRenderable } from "@tuiparts/core/tabs";
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

test("page navigation is in the top bar and startup enters Agent access", async () => {
  await mount();
  const top = setup!.renderer.root.findDescendantById("global-bar")!;
  const pages = top.findDescendantById("shell-section");
  expect(pages).toBeDefined();
  await setup!.waitFor(() => !!setup!.renderer.root.findDescendantById("agent-access-pane"));
  expect(setup!.renderer.root.findDescendantById("installed-skill-browser")).toBeUndefined();
});

test("scope choices navigate only on activation and cancellation restores the trigger", async () => {
  await mount();
  await focusLive(setup!, "shell-scope-select");
  await parsedEnter(setup!);
  await setup!.waitFor(() => !!setup!.renderer.root.findDescendantById("scope-choices"));
  const choices = setup!.renderer.root.findDescendantById("scope-choices") as SelectRenderable;
  expect(choices.getSelectedIndex()).toBe(0);
  setup!.mockInput.pressArrow("down");
  await setup!.renderOnce();
  expect(setup!.renderer.root.findDescendantById("shell-section-tab-updates")).toBeDefined();
  await parsedEscape(setup!);
  await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "shell-scope-select");
  await parsedEnter(setup!);
  await setup!.waitFor(() => !!setup!.renderer.root.findDescendantById("scope-choices"));
  const reopened = setup!.renderer.root.findDescendantById("scope-choices") as SelectRenderable;
  reopened.setSelectedIndex(2);
  await parsedEnter(setup!);
  await setup!.waitFor(
    () => !!setup!.renderer.root.findDescendantById("shell-section-project-tab-integrations"),
  );
  expect(setup!.renderer.root.findDescendantById("shell-section-tab-updates")).toBeUndefined();
  expect(setup!.renderer.root.findDescendantById("shell-scope-select")).toBeInstanceOf(Renderable);
  await focusLive(setup!, "shell-scope-select");
  await setup!.waitForFrame(
    (frame) => frame.includes("Enter Change Scope") && frame.includes("Project ▾"),
  );
});

test("top-bar scope and Actions remain inside the terminal at all supported widths", async () => {
  await mount();
  const scope = setup!.renderer.root.findDescendantById("shell-scope-select")!;
  const actions = setup!.renderer.root.findDescendantById("shell-more-actions")!;
  for (const width of [144, 120, 100, 80, 43]) {
    setup!.resize(width, width === 43 ? 13 : 24);
    await setup!.renderOnce();
    expect(scope.screenX + scope.width).toBeLessThanOrEqual(width);
    expect(actions.screenX + actions.width).toBeLessThanOrEqual(width);
    expect(scope.screenY).toBeLessThan(3);
    expect(setup!.renderer.root.findDescendantById("shell-scope-select")).toBe(scope);
  }
});

test("a page-tab pointer entry after choosing Scope cannot reactivate the Scope trigger", async () => {
  await mount(120, 40);
  await focusLive(setup!, "shell-scope-select");
  await parsedEnter(setup!);
  await setup!.waitFor(() => !!setup!.renderer.root.findDescendantById("scope-choices"));
  const choices = setup!.renderer.root.findDescendantById("scope-choices") as SelectRenderable;
  await setup!.flush();
  await setup!.mockMouse.click(choices.screenX + 5, choices.screenY + 2);
  await parsedEnter(setup!);
  await setup!.waitFor(
    () => !!setup!.renderer.root.findDescendantById("shell-section-project-tab-sources"),
  );
  expect(
    setup!.renderer.root.findDescendantById("shell-section-project-tab-sources"),
  ).toBeInstanceOf(TabsTabRenderable);
  const collections = setup!.renderer.root.findDescendantById(
    "shell-section-project-tab-collections",
  ) as TabsTabRenderable;
  expect(collections.getState().available).toBe(true);
  await setup!.mockMouse.click(collections.screenX + 2, collections.screenY);
  await setup!.renderOnce();
  expect(setup!.renderer.root.findDescendantById("scope-choices")).toBeUndefined();
  expect(setup!.renderer.currentFocusedRenderable?.id).not.toBe("shell-scope-select");
  await parsedEnter(setup!);
  await setup!.waitFor(() => {
    const tab = setup!.renderer.root.findDescendantById("shell-section-project-tab-collections");
    return tab instanceof TabsTabRenderable && tab.getState().selected;
  });
  expect(setup!.renderer.root.findDescendantById("scope-choices")).toBeUndefined();
});
