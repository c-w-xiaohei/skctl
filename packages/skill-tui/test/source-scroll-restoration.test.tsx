import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { ManagementProjection } from "@skill-cli/core";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";

type Setup = Awaited<ReturnType<typeof testRender>>;

type NativeSelect = Omit<SelectRenderable, "scrollOffset"> & {
  readonly getSelectedIndex: () => number;
  scrollOffset: number;
};

function native(id: string, setup: Setup): NativeSelect {
  const target = setup.renderer.root.findDescendantById(id);
  if (!(target instanceof SelectRenderable)) throw new Error(`${id} is not a SelectRenderable`);
  return target as unknown as NativeSelect;
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
  await new Promise<void>((resolve) => setImmediate(resolve));
  await setup.renderOnce();
}

async function openSources(setup: Setup) {
  await setup.waitFor(() => !!setup.renderer.currentFocusedRenderable?.parent);
  for (
    let step = 0;
    step < 5 && setup.renderer.currentFocusedRenderable?.id !== "shell-section-navigation";
    step++
  ) {
    setup.mockInput.pressTab();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await setup.renderOnce();
  }
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "shell-section-navigation",
  );
  for (let step = 0; step < 2; step++) {
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
  }
  setup.mockInput.pressEnter();
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
}

function sourcesProjection(): ManagementProjection {
  const base = workspaceProjection({ includeContribution: false });
  const sources = Array.from({ length: 14 }, (_, index) => ({
    id: `source-${index}`,
    kind: "github" as const,
    origin: `https://github.com/acme/source-${index}`,
    root: "skills",
    ref: "main",
    provenance: { level: "project" as const },
    selectors: [],
  }));
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              sources: sources.map((source) => ({
                ...source,
                ref: {
                  id: source.id,
                  owner: {
                    level: "project" as const,
                    file: "/workspace/skill-cli/skill-cli.jsonc",
                    pointer: `/sources/${source.id}`,
                  },
                },
              })),
            },
          }
        : config,
    ),
    effective: { ...base.effective, sources },
  };
}

test("RENDER Sources restores exact selected source and native offset after Inspector replacement", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(sourcesProjection())} exit={() => {}} />,
    { width: 120, height: 24 },
  );
  try {
    await setup.flush();
    await openSources(setup);
    const browser = native("source-browser", setup);
    for (let index = 0; index < 10; index++) {
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
    }
    const selected = browser.getSelectedOption()?.value;
    const offset = browser.scrollOffset;
    expect(selected).toBe("source-10");
    setup.mockInput.pressEnter();
    await setup.flush();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-command-skills"));
    const detailFrame = setup.captureCharFrame();
    expect(detailFrame).toContain("source-10");
    expect(detailFrame).toContain("https://github.com/acme/source-10");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("workspace-action-check-updates");
    let escapeCount = 0;
    const onEscape = (event: { readonly name: string }) => {
      if (event.name === "escape" || event.name === "esc") escapeCount += 1;
    };
    setup.renderer.keyInput.prependListener("keypress", onEscape);
    await awaitParsedEscape(setup);
    setup.renderer.keyInput.off("keypress", onEscape);
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("source-browser")).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
    expect(native("source-browser", setup).getSelectedOption()?.value).toBe(selected);
    expect(native("source-browser", setup).scrollOffset).toBe(offset);
    expect(escapeCount).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});
