import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import {
  enterLive,
  focusLive,
  openAllInstalledSkills,
  parsedEnter,
  parsedEscape,
} from "./reader-test-controls";
async function mount(width = 100, height = 30) {
  await mkdir("/tmp/opencode", { recursive: true });
  const cache = await mkdtemp("/tmp/opencode/navigation-guidance-");
  const prior = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
  process.env.SKTUI_UPDATE_SCHEDULE_DIR = cache;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async (
            _environment: import("@skctl/core").CoreOptions,
            { address },
          ) => ({
            address,
            name: address.path,
            description: "",
            rawText: Array.from({ length: 100 }, (_, index) => `Content ${index}`).join("\n"),
            markdownText: Array.from({ length: 100 }, (_, index) => `Content ${index}`).join(
              "\n\n",
            ),
          }),
        })}
        exit={() => {}}
      />
    ),
    { width, height },
  );
  await openAllInstalledSkills(setup);
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
  );
  return {
    setup,
    async dispose() {
      setup.renderer.destroy();
      if (prior === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
      else process.env.SKTUI_UPDATE_SCHEDULE_DIR = prior;
      await rm(cache, { recursive: true, force: true });
    },
  };
}
type Setup = Awaited<ReturnType<typeof testRender>>;
const hint = (setup: Setup, id: "interaction-guidance" | "navigation-guidance") =>
  (setup.renderer.root.findDescendantById(id) as TextRenderable).plainText;
test("Skills, Sources and Updates keep one global keyboard grammar; Actions closes to the initiating panel", async () => {
  const mounted = await mount();
  const { setup } = mounted;
  try {
    await setup.renderOnce();
    const grammar = hint(setup, "navigation-guidance");
    for (const [page, browser] of [
      ["sources", "source-browser"],
      ["updates", "updates-browser"],
    ]) {
      await enterLive(setup, `shell-section-tab-${page}`);
      const panel = await focusLive(setup, browser!);
      await setup.renderOnce();
      expect(hint(setup, "navigation-guidance")).toBe(grammar);
      setup.mockInput.pressKey("p", { ctrl: true });
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
      await parsedEscape(setup);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable === panel);
      expect(hint(setup, "navigation-guidance")).toBe(grammar);
    }
  } finally {
    await mounted.dispose();
  }
});
test("Scope opens native choices and Escape restores the Scope trigger", async () => {
  const mounted = await mount(100, 30);
  const { setup } = mounted;
  try {
    await enterLive(setup, "shell-section-tab-settings");
    await focusLive(setup, "shell-scope-select");
    await setup.renderOnce();
    const grammar = hint(setup, "navigation-guidance");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("scope-choices"));
    setup.mockInput.pressArrow("down");
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "shell-scope-select");
    expect(hint(setup, "navigation-guidance")).toBe(grammar);
  } finally {
    await mounted.dispose();
  }
});
test("reading changes only the control mode; scroll works and Esc restores Skill details", async () => {
  const mounted = await mount(120, 40);
  const { setup } = mounted;
  try {
    const grammar = hint(setup, "navigation-guidance");
    await enterLive(setup, "installed-skill-browser");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    const content = setup.renderer.currentFocusedRenderable as ScrollBoxRenderable;
    await setup.waitFor(() => content.scrollHeight > content.viewport.height);
    setup.mockInput.pressArrow("down");
    await setup.waitFor(() => content.scrollTop > 0);
    expect(hint(setup, "interaction-guidance")).toContain("scroll");
    expect(hint(setup, "navigation-guidance")).toBe(grammar);
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    expect(hint(setup, "navigation-guidance")).toBe(grammar);
  } finally {
    await mounted.dispose();
  }
});
