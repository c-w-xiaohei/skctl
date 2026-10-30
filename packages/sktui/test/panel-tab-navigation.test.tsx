import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { openAllInstalledSkills, parsedEnter, focusLive } from "./reader-test-controls";

async function pressTab(setup: Awaited<ReturnType<typeof testRender>>, shift = false) {
  setup.mockInput.pressTab({ shift });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await setup.renderOnce();
  return setup.renderer.currentFocusedRenderable?.id;
}

test("Tab cycles inventory, Reader, shell, search and filter panels", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openAllInstalledSkills(setup);
    const visited: string[] = [];
    for (let index = 0; index < 16; index++) {
      const id = await pressTab(setup);
      if (id) visited.push(id);
      if (id === "installed-skill-browser") break;
    }
    expect(visited).toContain("reader-action-skill-check-updates");
    expect(visited).toContain("shell-section-tab-skills");
    expect(visited).toContain("skills-view-tab-all-installed-skills");
    expect(visited).toContain("skills-query");
    expect(visited).toContain("open-skills-filter");
    expect(visited.at(-1)).toBe("installed-skill-browser");
  } finally {
    setup.renderer.destroy();
  }
});

test("Shift+Tab leaves Reader tabs and Tab restores the remembered control", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openAllInstalledSkills(setup);
    await pressTab(setup);
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    const lastAction = setup.renderer.currentFocusedRenderable?.id;
    expect(await pressTab(setup, true)).toBe("skills-query");
    expect(await pressTab(setup)).toBe(lastAction);
  } finally {
    setup.renderer.destroy();
  }
});

test("narrow detail does not tab to its hidden Browser pane", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 60, height: 24 },
  );
  try {
    await openAllInstalledSkills(setup);
    await parsedEnter(setup);
    const visited = [];
    for (let index = 0; index < 8; index++) visited.push(await pressTab(setup));
    expect(visited).not.toContain("installed-skill-browser");
    expect(visited).toContain("shell-section-tab-skills");
  } finally {
    setup.renderer.destroy();
  }
});

test("Reader toolbar and view tabs are internal to the single Reader panel", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openAllInstalledSkills(setup);
    await parsedEnter(setup);
    await setup.waitFor(
      () =>
        !!setup.renderer.root.findDescendantById("reader-details-action-skill-add-to-collection"),
    );
    await focusLive(setup, "reader-details-action-skill-add-to-collection");
    const internal = setup.renderer.currentFocusedRenderable?.id;
    expect(await pressTab(setup)).toBe("shell-section-tab-skills");
    expect(await pressTab(setup, true)).toBe(internal);
  } finally {
    setup.renderer.destroy();
  }
});
