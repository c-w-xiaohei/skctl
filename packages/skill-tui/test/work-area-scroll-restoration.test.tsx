import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { ManagementProjection } from "@skill-cli/core";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";

type Setup = Awaited<ReturnType<typeof testRender>>;
type NativeSelect = {
  readonly options: readonly { readonly value?: string }[];
  readonly focus: () => void;
  readonly getSelectedOption: () => { readonly value?: string } | null;
  readonly getSelectedIndex: () => number;
  readonly setSelectedIndex: (index: number) => void;
  scrollOffset: number;
};

const native = (id: string, setup: Setup): NativeSelect => {
  const target = setup.renderer.root.findDescendantById(id);
  if (!(target instanceof SelectRenderable)) throw new Error(`${id} is not a SelectRenderable`);
  return target as unknown as NativeSelect;
};

async function escape(setup: Setup) {
  await new Promise<void>((resolve) => {
    const listener = (event: { readonly name: string }) => {
      if (event.name !== "escape" && event.name !== "esc") return;
      setup.renderer.keyInput.off("keypress", listener);
      resolve();
    };
    setup.renderer.keyInput.prependListener("keypress", listener);
    setup.mockInput.pressKey("ESCAPE");
  });
  await setup.renderOnce();
}

async function enter(setup: Setup) {
  await new Promise<void>((resolve) => {
    const listener = (event: { readonly name: string }) => {
      if (event.name !== "enter" && event.name !== "return") return;
      setup.renderer.keyInput.off("keypress", listener);
      resolve();
    };
    setup.renderer.keyInput.prependListener("keypress", listener);
    setup.mockInput.pressEnter();
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function exposureProjection(): ManagementProjection {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = {
    level: "project" as const,
    file: "/workspace/skill-cli/skill-cli.jsonc",
    pointer: "/collections/root",
  };
  const collections = Array.from({ length: 41 }, (_, index) => ({
    id: index === 0 ? "root" : `root-${index}`,
    declared: [owner],
    repository: { derived: false, producers: [] },
    members: [],
    references: [],
    links: [],
  }));
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              collectionUse: [{ collection: "root", owner }],
            },
          }
        : config,
    ),
    effective: {
      ...base.effective,
      managed: true,
      use: ["root"],
      collections: collections.map((collection) => collection.id),
      collectionsView: [
        {
          ...collections[0]!,
          references: Array.from({ length: 13 }, (_, index) => ({
            name: `child-${index}`,
            collection: `root-${index + 1}`,
            description: `Child ${index}`,
            owner,
          })),
        },
        ...collections.slice(1),
      ],
    },
  };
}

test("RENDER Current Exposure restores its native path, offset, and browser focus after Collection route return", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(exposureProjection())} exit={() => {}} />,
    { width: 120, height: 24 },
  );
  try {
    await setup.flush();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-skills"));
    const skills = setup.renderer.root.findDescendantById("shell-section-tab-skills")!;
    skills.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === skills);
    await setup.flush();
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skills-view-tab-current-exposure"),
    );
    const current = setup.renderer.root.findDescendantById("skills-view-tab-current-exposure")!;
    current.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === current);
    const exposure = setup.renderer.root.findDescendantById("current-exposure-browser")!;
    exposure.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === exposure);
    const browser = native("current-exposure-browser", setup);
    for (let index = 0; index < 9; index++) setup.mockInput.pressArrow("down");
    await setup.waitFor(() => browser.getSelectedOption()?.value === "root/child-8");
    const selectedBrowser = native("current-exposure-browser", setup);
    selectedBrowser.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "current-exposure-browser",
    );
    selectedBrowser.scrollOffset = 4;
    const selected = selectedBrowser.getSelectedOption()?.value;
    expect(selected).toBe("root/child-8");
    await enter(setup);
    await setup.renderOnce();
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-tabs-tab-entries"),
    );
    expect(setup.renderer.root.findDescendantById("current-exposure-browser")).toBeUndefined();
    await escape(setup);
    await setup.flush();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("current-exposure-browser"));
    const restored = native("current-exposure-browser", setup);
    expect(restored.getSelectedOption()?.value).toBe(selected);
    expect(restored.getSelectedIndex()).toBe(9);
    expect(restored.scrollOffset).toBe(4);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("current-exposure-browser");
  } finally {
    setup.renderer.destroy();
  }
});
