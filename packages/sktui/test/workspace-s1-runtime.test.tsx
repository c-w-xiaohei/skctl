import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { TabsTabRenderable } from "@tuiparts/core/tabs";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { focusLive, openAllInstalledSkills } from "./reader-test-controls";
const skillsViews = [
  ["all-installed-skills", "installed-skill-browser"],
  ["unassigned", "installed-skill-browser"],
  ["problems", "problems-browser"],
] as const;
test("RENDER mounted Skills local tabs navigate Installed through Problems without legacy workspace nodes", async () => {
  const projection = {
    ...readerProjection(),
    installedSkills: readerProjection().installedSkills.map((skill, index) => ({
      ...skill,
      problems:
        index === 0
          ? [
              {
                code: "S1",
                severity: "warning" as const,
                message: "S1",
                subject: { kind: "installed-skill" as const, address: skill.address },
              },
            ]
          : [],
    })),
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await setup.flush();
    let tab = await focusLive(setup, "skills-view-tab-all-installed-skills");
    for (const [index, [, body]] of skillsViews.entries()) {
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById(body));
      expect(tab).toBeInstanceOf(TabsTabRenderable);
      expect((tab as TabsTabRenderable).getState().selected).toBe(true);
      if (index === 0)
        expect(setup.renderer.root.findDescendantById("install-skills")).toBeDefined();
      expect(setup.renderer.root.findDescendantById("workspace-scope")).toBeUndefined();
      expect(setup.renderer.root.findDescendantById("work-area")).toBeUndefined();
      expect(setup.captureCharFrame()).not.toContain("Workspace Scope");
      if (index < skillsViews.length - 1) {
        setup.mockInput.pressArrow("right");
        const [next] = skillsViews[index + 1]!;
        await setup.waitFor(() => {
          const candidate = setup.renderer.root.findDescendantById(`skills-view-tab-${next}`);
          return (
            candidate instanceof TabsTabRenderable &&
            candidate.getState().selected &&
            setup.renderer.currentFocusedRenderable === candidate
          );
        });
        tab = setup.renderer.root.findDescendantById(`skills-view-tab-${next}`)!;
      }
    }
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Section Right leaves Installed Skills and mounts the Collections browser once", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    await focusLive(setup, "shell-section-tab-skills");
    setup.mockInput.pressArrow("right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "shell-section-tab-collections",
    );
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));
    const collections = setup.renderer.root.findDescendantById("shell-section-tab-collections");
    expect(collections).toBeInstanceOf(TabsTabRenderable);
    expect((collections as TabsTabRenderable).getState().selected).toBe(true);
    expect(setup.renderer.root.findDescendantById("collection-browser")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("agent-access-pane")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("current-exposure-browser")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER first Space marks the focused Installed Skill without an additional content read", async () => {
  let loads = 0;
  const projection = readerProjection();
  const firstAddress = JSON.stringify(["team-main", "guide"]);
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, {
          loadInstalledSkill: async () => {
            loads++;
            throw new Error("Space must not load content");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    const browser = (await openAllInstalledSkills(setup)) as SelectRenderable;
    expect(browser.getSelectedOption()?.value).toBe(firstAddress);
    expect(browser.options.every((option) => !option.name.startsWith("✓ "))).toBe(true);
    await setup.waitForFrame((frame) => frame.includes("Could not read guide"));
    const loadsBeforeSpace = loads;
    setup.mockInput.pressKey(" ");
    await setup.flush();
    await setup.waitFor(
      () =>
        (
          setup.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable
        ).options
          .find((option) => option.value === firstAddress)
          ?.name.startsWith("✓ ") ?? false,
    );
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("workspace-batch-add-to-collection"),
    );
    expect(setup.captureCharFrame()).toContain("1 selected");
    expect(loads).toBe(loadsBeforeSpace);
  } finally {
    setup.renderer.destroy();
  }
});
