import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { skillAddressKey } from "@skill-cli/core";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import {
  readerContent,
  readerProjection,
  readerSecondAddress,
  sourceFilteredAddress,
  sourceFilteredReaderProjection,
} from "./installed-reader.fixture";
type Setup = Awaited<ReturnType<typeof testRender>>;
async function openSkills(setup: Setup) {
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("skills-view-tab-current-exposure"),
  );
  const current = setup.renderer.root.findDescendantById("skills-view-tab-current-exposure")!;
  current.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === current);
  setup.mockInput.pressKey("ARROW_RIGHT");
  await setup.renderOnce();
  await setup.waitFor(() => {
    const all = setup.renderer.root.findDescendantById("skills-view-tab-all-installed-skills");
    return (
      !!all &&
      (
        all as unknown as {
          getState(): {
            selected: boolean;
          };
        }
      ).getState().selected &&
      !!setup.renderer.root.findDescendantById("installed-skill-browser")
    );
  });
  const browser = setup.renderer.root.findDescendantById("installed-skill-browser")!;
  browser.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
}
async function openSource(setup: Setup, index = 0) {
  const skills = setup.renderer.root.findDescendantById("shell-section-tab-skills")!;
  skills.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === skills);
  for (const section of ["collections", "sources"] as const) {
    const current = setup.renderer.currentFocusedRenderable;
    current?.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === current);
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.renderOnce();
    await setup.waitFor(() => {
      const tab = setup.renderer.root.findDescendantById(`shell-section-tab-${section}`);
      return (
        !!tab &&
        (
          tab as unknown as {
            getState(): {
              selected: boolean;
            };
          }
        ).getState().selected &&
        setup.renderer.currentFocusedRenderable === tab
      );
    });
  }
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
  const browser = setup.renderer.root.findDescendantById("source-browser")!;
  browser.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
  for (let step = 0; step < index; step++) setup.mockInput.pressArrow("down");
  await awaitParsedEnter(setup);
  await setup.waitFor(() => {
    const configCommand = setup.renderer.root.findDescendantById("source-command-config");
    const skillsCommand = setup.renderer.root.findDescendantById("source-command-skills");
    return (
      !!configCommand &&
      !!skillsCommand &&
      configCommand.height > 0 &&
      configCommand.screenY > 0 &&
      skillsCommand.height > 0 &&
      skillsCommand.screenY > 0 &&
      setup.renderer.currentFocusedRenderable === configCommand
    );
  });
}
async function awaitParsedEscape(setup: Setup) {
  await new Promise<void>((resolve) => {
    const onKeypress = (event: { readonly name: string }) => {
      if (event.name !== "escape" && event.name !== "esc") return;
      setup.renderer.keyInput.off("keypress", onKeypress);
      resolve();
    };
    setup.renderer.keyInput.prependListener("keypress", onKeypress);
    setup.mockInput.pressKey("ESCAPE");
  });
  await setup.renderOnce();
}
async function awaitParsedEnter(setup: Setup) {
  await new Promise<void>((resolve) => {
    const onKeypress = (event: { readonly name: string }) => {
      if (event.name !== "enter" && event.name !== "return") return;
      setup.renderer.keyInput.off("keypress", onKeypress);
      resolve();
    };
    setup.renderer.keyInput.prependListener("keypress", onKeypress);
    setup.mockInput.pressEnter();
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await setup.renderOnce();
}
async function awaitFilteredSkillsBrowser(setup: Setup, expectedOptions: number) {
  await setup.waitFor(() => {
    const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
    if (!(browser instanceof SelectRenderable)) return false;
    return (
      browser.options.length === expectedOptions &&
      browser.options.every((option) => option.value.startsWith('["team-main",')) &&
      setup.renderer.currentFocusedRenderable === browser &&
      (setup.captureCharFrame() ?? "").includes(
        `Installed Skills from team-main ${expectedOptions}/${expectedOptions}`,
      )
    );
  });
}
test("RENDER Skill inspector uses named commands, one cue, and defers content loading", async () => {
  const loads: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async (
            _environment: import("@skill-cli/core").CoreOptions,
            request,
          ) => {
            loads.push(request);
            return readerContent;
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openSkills(setup);
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    if (!setup.renderer.root.findDescendantById("skill-inspector-open-reader"))
      throw new Error(`Skill inspector did not mount\n${setup.captureCharFrame()}`);
    let frame = setup.captureCharFrame();
    expect(loads).toEqual([]);
    expect(frame).toContain("Open SKILL.md -> Reader");
    expect(frame).toContain("Open Source -> team-main");
    if (frame.includes("More commands")) throw new Error(frame);
    expect(frame).not.toContain("Actions");
    expect(frame.match(/>[^\n]+</g) ?? []).toHaveLength(1);
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    await setup.waitFor(
      () =>
        !!setup.renderer.currentFocusedRenderable?.id.startsWith("skill-inspector-relationship-"),
    );
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.renderOnce();
    const openReader = setup.renderer.root.findDescendantById("skill-inspector-open-reader")!;
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === openReader);
    await awaitParsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
    expect(loads).toEqual([{ address: readerSecondAddress }]);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Source Installed Skills command retains its exact filtered drill-in and return stack", async () => {
  const loads: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(sourceFilteredReaderProjection(), {
          loadInstalledSkill: async (
            _environment: import("@skill-cli/core").CoreOptions,
            request,
          ) => {
            loads.push(request);
            return readerContent;
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openSource(setup);
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-command-skills",
    );
    await awaitParsedEnter(setup);
    await awaitFilteredSkillsBrowser(setup, 3);
    const browser = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    expect(setup.captureCharFrame() ?? "").not.toContain("Other review");
    expect(browser.options).toHaveLength(3);
    expect(browser.options.map((option) => option.value)).not.toContain(
      skillAddressKey({ source: "other", path: "review" }),
    );
    expect(browser.options).toContainEqual(
      expect.objectContaining({
        value: skillAddressKey(sourceFilteredAddress),
        description: "Team review · team-main",
      }),
    );
    const reviewIndex = browser.options.findIndex(
      (option) => option.value === skillAddressKey(sourceFilteredAddress),
    );
    expect(reviewIndex).toBeGreaterThanOrEqual(0);
    for (let index = 0; index < reviewIndex; index++) {
      const current = setup.renderer.root.findDescendantById(
        "installed-skill-browser",
      ) as SelectRenderable;
      current.focus();
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable === current);
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
    }
    const selected = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    selected.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === selected);
    await setup.waitFor(() => {
      const current = setup.renderer.root.findDescendantById(
        "installed-skill-browser",
      ) as SelectRenderable;
      return (
        current?.getSelectedOption()?.value === skillAddressKey(sourceFilteredAddress) &&
        setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser"
      );
    });
    const selectedBrowser = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    selectedBrowser.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === selectedBrowser);
    await awaitParsedEnter(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
    expect(setup.renderer.root.findDescendantById("skill-inspector")).toBeDefined();
    expect(loads).toEqual([]);
    await awaitParsedEscape(setup);
    await setup.waitFor(() => {
      const restored = setup.renderer.root.findDescendantById("installed-skill-browser");
      return (
        restored instanceof SelectRenderable &&
        restored.options.length === 3 &&
        restored.options.every((option) => option.value.startsWith('["team-main",')) &&
        !!setup.renderer.root.findDescendantById("clear-source-filter") &&
        restored.getSelectedOption()?.value === skillAddressKey(sourceFilteredAddress) &&
        setup.renderer.currentFocusedRenderable === restored &&
        (setup.captureCharFrame() ?? "").includes("Installed Skills from team-main 3/3")
      );
    });
    expect(setup.renderer.root.findDescendantById("skill-inspector")).toBeUndefined();
    const restoredSkills = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    expect(restoredSkills.getSelectedOption()?.value).toBe(skillAddressKey(sourceFilteredAddress));
    restoredSkills.focus();
    expect(setup.renderer.currentFocusedRenderable).toBe(restoredSkills);
    await awaitParsedEscape(setup);
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === "source-command-skills" &&
        !setup.renderer.root.findDescendantById("installed-skill-browser") &&
        !setup.renderer.root.findDescendantById("clear-source-filter") &&
        !setup.renderer.root.findDescendantById("source-browser") &&
        (setup.captureCharFrame() ?? "").includes("View Installed Skills -> team-main"),
    );
    expect(loads).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Source inspector direct return control restores its exact source", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openSource(setup);
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-command-skills",
    );
    await awaitParsedEnter(setup);
    await awaitFilteredSkillsBrowser(setup, 2);
    const back = setup.renderer.root.findDescendantById("route-back")!;
    back.focus();
    setup.mockInput.pressEnter();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-command-skills"));
  } finally {
    setup.renderer.destroy();
  }
});
