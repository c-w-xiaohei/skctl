import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";

const skillsViews = [
  ["current-exposure", "current-exposure-unavailable"],
  ["all-installed-skills", "installed-skill-browser"],
  ["unassigned", "installed-skill-browser"],
  ["problems", "problems-browser"],
] as const;

test("RENDER mounted Skills local tabs navigate Current Exposure through Problems without legacy workspace nodes", async () => {
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
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skills-view-tab-current-exposure"),
    );
    let tab = setup.renderer.root.findDescendantById("skills-view-tab-current-exposure")!;
    for (const [index, [, body]] of skillsViews.entries()) {
      tab.focus();
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable === tab);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById(body));
      expect((tab as unknown as { getState(): { selected: boolean } }).getState().selected).toBe(
        true,
      );
      setup.mockInput.pressEnter();
      expect(setup.renderer.root.findDescendantById(body)).toBeDefined();
      expect(setup.renderer.root.findDescendantById("workspace-scope")).toBeUndefined();
      expect(setup.renderer.root.findDescendantById("work-area")).toBeUndefined();
      expect(setup.captureCharFrame()).not.toContain("Workspace Scope");
      if (index < skillsViews.length - 1) {
        setup.mockInput.pressKey("ARROW_RIGHT");
        await setup.flush();
        const [next] = skillsViews[index + 1]!;
        await setup.waitFor(
          () => !!setup.renderer.root.findDescendantById(`skills-view-tab-${next}`),
        );
        tab = setup.renderer.root.findDescendantById(`skills-view-tab-${next}`)!;
      }
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Section Right leaves Current Exposure and mounts the Collections browser once", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-skills"));
    const skills = setup.renderer.root.findDescendantById("shell-section-tab-skills")!;
    skills.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === skills);

    setup.mockInput.pressArrow("right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "shell-section-tab-collections",
    );
    await setup.waitForFrame((frame) => frame.includes("Workspace / Collections"));
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));

    expect(setup.renderer.root.findDescendantById("collection-browser")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("current-exposure-browser")).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("Workspace / Collections");
    expect(setup.captureCharFrame()).toContain("[Collections]");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER first Space marks the focused Installed Skill without loading its content", async () => {
  let loads = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => {
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
    await setup.flush();
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skills-view-tab-current-exposure"),
    );
    const current = setup.renderer.root.findDescendantById("skills-view-tab-current-exposure")!;
    current.focus();
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.flush();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    const browser = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    expect(browser.options.every((option) => !option.name.startsWith("[ ]"))).toBe(true);
    browser.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
    setup.mockInput.pressKey(" ");
    await setup.flush();
    await setup.waitFor(() =>
      (
        setup.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable
      ).options[0]?.name.startsWith("[x]"),
    );
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("workspace-batch-add-to-collection"),
    );
    expect(setup.captureCharFrame()).toContain("1 selected");
    expect(loads).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});
