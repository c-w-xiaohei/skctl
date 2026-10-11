import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { parsedEnter, parsedEscape } from "./reader-test-controls";

test.each([120, 80, 60])(
  "Skills page keeps its header and content origin when opening details at %i columns",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
      { width, height: 30 },
    );
    const geometry = (id: string) => {
      const target = setup.renderer.root.findDescendantById(id);
      if (!target) throw new Error(`Missing ${id}`);
      return [target.screenX, target.screenY, target.width, target.height];
    };
    try {
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      await setup.renderOnce();
      const scope = geometry("skills-local-views");
      const list = geometry("skills-list-pane");
      const listNode = setup.renderer.root.findDescendantById("installed-skill-browser");
      const title = geometry("route-title");
      await parsedEnter(setup);
      expect(geometry("skills-local-views")).toEqual(scope);
      expect(geometry("route-title")).toEqual(title);
      const detail = geometry("skill-inspector");
      expect(detail[1]).toBe(list[1]);
      if (width >= 100) {
        expect(geometry("skills-list-pane")).toEqual(list);
        expect(setup.renderer.root.findDescendantById("installed-skill-browser")).toBe(listNode);
      }
      await parsedEnter(setup);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
      expect(geometry("skills-local-views")).toEqual(scope);
      expect(geometry("route-title")).toEqual(title);
      await parsedEscape(setup);
      await parsedEscape(setup);
      expect(geometry("skills-list-pane")).toEqual(list);
      expect(geometry("skills-local-views")).toEqual(scope);
      expect(geometry("route-title")).toEqual(title);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("long descriptions do not move the Skill action region", async () => {
  const projection = readerProjection();
  const second = projection.installedSkills[1]!;
  const core = directSourceCore({
    ...projection,
    installedSkills: [
      projection.installedSkills[0]!,
      { ...second, description: "A long description with wrapping. ".repeat(100) },
    ],
  });
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    await setup.renderOnce();
    const actions = setup.renderer.root.findDescendantById("skill-inspector-actions")!;
    const before = [actions.screenY, actions.height];
    setup.mockInput.pressArrow("down");
    await setup.waitForFrame((frame) => frame.includes("A long description"));
    await setup.renderOnce();
    const selectedActions = setup.renderer.root.findDescendantById("skill-inspector-actions")!;
    expect([selectedActions.screenY, selectedActions.height]).toEqual(before);
  } finally {
    setup.renderer.destroy();
  }
});

test("short nonwide terminals keep the same chrome budget across browser and detail", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 80, height: 16 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    await setup.renderOnce();
    const list = setup.renderer.root.findDescendantById("skills-list-pane")!;
    const origin = [list.screenY, list.height];
    expect(setup.renderer.root.findDescendantById("skills-local-views")).toBeUndefined();
    await parsedEnter(setup);
    const detail = setup.renderer.root.findDescendantById("skill-inspector")!;
    expect([detail.screenY, detail.height]).toEqual(origin);
    expect(setup.renderer.root.findDescendantById("skills-local-views")).toBeUndefined();
    await parsedEscape(setup);
    const returned = setup.renderer.root.findDescendantById("skills-list-pane")!;
    expect([returned.screenY, returned.height]).toEqual(origin);
  } finally {
    setup.renderer.destroy();
  }
});

test("resizing detail preserves the surface and returns to the same Skill", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    await parsedEnter(setup);
    for (const width of [80, 60, 120]) {
      setup.resize(width, 30);
      await setup.waitForFrame((frame) => frame.includes("Back to Skills"));
      await setup.renderOnce();
      expect(setup.renderer.root.findDescendantById("skill-inspector")).toBeDefined();
      expect(setup.renderer.root.findDescendantById("skills-local-views")).toBeDefined();
      expect(setup.captureCharFrame()).toContain("guide");
    }
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(setup.captureCharFrame()).toContain("guide");
  } finally {
    setup.renderer.destroy();
  }
});
