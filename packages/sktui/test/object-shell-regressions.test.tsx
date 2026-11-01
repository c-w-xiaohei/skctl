/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { parsedEnter, parsedEscape } from "./reader-test-controls";

type Setup = Awaited<ReturnType<typeof testRender>>;
async function clickVisible(setup: Setup, id: string) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById(id));
  const target = setup.renderer.root.findDescendantById(id)!;
  expect(target.width).toBeGreaterThan(0);
  expect(target.height).toBeGreaterThan(0);
  expect(target.screenX).toBeGreaterThanOrEqual(0);
  expect(target.screenX + target.width).toBeLessThanOrEqual(setup.renderer.width);
  await setup.mockMouse.click(target.screenX + 1, target.screenY);
  await setup.flush();
}

test("wide Source Enter keeps the selected inventory beside its object", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 144, height: 30 },
  );
  try {
    await clickVisible(setup, "shell-section-tab-sources");
    await clickVisible(setup, "source-browser");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-details-pane"));
    const list = setup.renderer.root.findDescendantById("source-browser");
    expect(list).toBeInstanceOf(SelectRenderable);
    expect((list as SelectRenderable).getSelectedOption()?.value).toBe("team-main");
    expect(list!.width).toBeGreaterThan(0);
    expect(setup.renderer.root.findDescendantById("source-installed-skills")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("Agent onboarding opens Collection creation from its visible task", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await clickVisible(setup, "shell-section-tab-agent");
    await setup.waitForFrame((frame) => frame.includes("Organize Skills into a Collection"));
    await clickVisible(setup, "skills-setup-primary");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-create-id"));
  } finally {
    setup.renderer.destroy();
  }
});

test("Agent onboarding opens Source registration when no Sources exist", async () => {
  const input = workspaceProjection({ includeDirect: false, includeContribution: false });
  const setup = await testRender(() => <App core={directSourceCore(input)} exit={() => {}} />, {
    width: 120,
    height: 30,
  });
  try {
    await clickVisible(setup, "shell-section-tab-agent");
    await setup.waitForFrame((frame) => frame.includes("Add your first Source"));
    await clickVisible(setup, "skills-setup-primary");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-register-origin"));
  } finally {
    setup.renderer.destroy();
  }
});

test("Agent configuration error opens Problems via its visible action", async () => {
  const base = readerProjection();
  const diagnostic = {
    severity: "warning" as const,
    code: "CONFIG_INVALID",
    message: "Invalid Config",
  };
  const input = {
    ...base,
    diagnostics: [diagnostic],
    effective: {
      status: "unavailable" as const,
      reasons: [diagnostic],
      sources: base.effective.sources,
      collections: [],
      agent: base.effective.agent,
    },
  };
  const setup = await testRender(() => <App core={directSourceCore(input)} exit={() => {}} />, {
    width: 120,
    height: 30,
  });
  try {
    await clickVisible(setup, "shell-section-tab-agent");
    await setup.waitForFrame((frame) => frame.includes("View configuration error"));
    await clickVisible(setup, "skills-setup-primary");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("problems-browser"));
    expect(setup.captureCharFrame()).toContain("Invalid Config");
  } finally {
    setup.renderer.destroy();
  }
});

test.each([43, 80])(
  "compact Pages chooser exposes full page names and opens the chosen page at %i columns",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
      { width, height: 24 },
    );
    try {
      await clickVisible(setup, "shell-pages-select");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "shell-pages-choices",
      );
      const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
      expect(choices.options.map((option) => option.name.trim())).toEqual([
        "Skills",
        "Collections",
        "Sources",
        "Updates",
        "Agent",
        "Settings",
      ]);
      expect(choices.screenX).toBeGreaterThanOrEqual(0);
      expect(choices.screenX + choices.width).toBeLessThanOrEqual(width);
      setup.mockInput.pressArrow("down");
      await parsedEnter(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));
      await clickVisible(setup, "shell-pages-select");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "shell-pages-choices",
      );
      const reopened = setup.renderer.currentFocusedRenderable as SelectRenderable;
      const source = reopened.options.findIndex((option) => option.value === "sources");
      expect(source).toBeGreaterThanOrEqual(0);
      await setup.mockMouse.click(reopened.screenX + 1, reopened.screenY + source);
      await parsedEnter(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("Source installed-Skills relationship restores its initiating control on Back", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 144, height: 30 },
  );
  try {
    await clickVisible(setup, "shell-section-tab-sources");
    await clickVisible(setup, "source-browser");
    await parsedEnter(setup);
    await clickVisible(setup, "shell-more-actions");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("palette-choices"));
    const choices = setup.renderer.root.findDescendantById("palette-choices") as SelectRenderable;
    const index = choices.options.findIndex(
      (option) => option.value.id === "view-installed-skills",
    );
    expect(index).toBeGreaterThanOrEqual(0);
    choices.setSelectedIndex(index);
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "shell-more-actions");
  } finally {
    setup.renderer.destroy();
  }
});
