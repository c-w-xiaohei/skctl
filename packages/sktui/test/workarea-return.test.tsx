/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import type { WorkspaceView } from "@skctl/core";
import { testRender } from "@opentui/solid";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { collectionFilterPathKey } from "../src/collections/collection-filter-tree";
import {
  enterLive,
  expectSharedReturn,
  focusLive,
  parsedEnter,
  parsedEscape,
} from "./reader-test-controls";

async function mount(
  width = 100,
  height = 24,
  projection: WorkspaceView = collectionsSourcesProjection(),
) {
  await mkdir("/tmp/opencode", { recursive: true });
  const cache = await mkdtemp("/tmp/opencode/workarea-return-");
  const prior = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
  process.env.SKTUI_UPDATE_SCHEDULE_DIR = cache;
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width, height },
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
async function openMembership(setup: Awaited<ReturnType<typeof testRender>>) {
  await openMainPage(setup, "collections");
  await enterLive(setup, "collection-browser");
  await setup.flush();
  await enterLive(setup, "collection-current-details");
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("collection-membership-inspector"),
  );
  await setup.flush();
}

async function chooseAction(setup: Awaited<ReturnType<typeof testRender>>, id: string) {
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
  const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
  const index = choices.options.findIndex((option) => option.value.id === id);
  expect(index).toBeGreaterThanOrEqual(0);
  for (let step = 0; step < index; step++) setup.mockInput.pressArrow("down");
  await parsedEnter(setup);
}

test("Escape from the left Collection tree does not close an inactive right inspector", async () => {
  const mounted = await mount(144, 40);
  const { setup } = mounted;
  try {
    await openMembership(setup);
    const key = collectionFilterPathKey({ segments: [{ collection: "team" }] });
    const name = setup.renderer.root.findDescendantById(
      `collection-browser-row-${encodeURIComponent(key)}-name`,
    )!;
    await setup.mockMouse.click(name.screenX + 1, name.screenY);
    await setup.flush();
    if (setup.renderer.root.findDescendantById("collection-membership-inspector"))
      await parsedEscape(setup);
    expect(!!setup.renderer.root.findDescendantById("collection-membership-inspector")).toBe(false);
    expect(!!setup.renderer.root.findDescendantById("collection-relationships")).toBe(true);
  } finally {
    await mounted.dispose();
  }
});

test.each([144, 80])(
  "inline Reader returns locally before the Source predecessor at %i columns",
  async (width) => {
    const mounted = await mount(width, 30);
    const { setup } = mounted;
    try {
      await setup.flush();
      await openMainPage(setup, "sources");
      await focusLive(setup, "source-browser");
      await chooseAction(setup, "view-installed-skills");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      const browser = setup.renderer.currentFocusedRenderable as SelectRenderable;
      await setup.mockInput.typeText(" ");
      setup.mockInput.pressArrow("down");
      await setup.flush();
      const selected = browser.getSelectedOption()!.value;
      const checked = browser.options.find((option) => option.name.startsWith("✓"))!.value;
      for (const activation of ["escape", "pointer", "tab", "actions"] as const) {
        await parsedEnter(setup);
        await setup.waitFor(
          () => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox",
        );
        await setup.flush();
        await expectSharedReturn(setup, "Back to Skills");
        if (activation === "escape") await parsedEscape(setup);
        else if (activation === "pointer") {
          const back = setup.renderer.root.findDescendantById("route-back")!;
          await setup.mockMouse.click(back.screenX + 1, back.screenY);
        } else if (activation === "actions") await chooseAction(setup, "workspace.reader-back");
        else {
          for (
            let step = 0;
            step < 12 && setup.renderer.currentFocusedRenderable?.id !== "route-back";
            step++
          ) {
            setup.mockInput.pressTab();
            await setup.flush();
          }
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("route-back");
          await parsedEnter(setup);
        }
        await setup.waitFor(
          () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
        );
        const restored = setup.renderer.currentFocusedRenderable as SelectRenderable;
        expect(restored.getSelectedOption()?.value).toBe(selected);
        expect(restored.options.find((option) => option.name.startsWith("✓"))?.value).toBe(checked);
        expect(
          restored.options.every((option) => JSON.parse(option.value)[0] === "team-main"),
        ).toBe(true);
        await expectSharedReturn(setup, "Back to Sources");
      }
    } finally {
      await mounted.dispose();
    }
  },
);

test.each([
  [144, 40],
  [100, 24],
  [80, 24],
  [43, 13],
])(
  "shared Back names the active local parent and focusing it never consumes a different route edge at %ix%i",
  async (width, height) => {
    const mounted = await mount(width, height);
    const { setup } = mounted;
    try {
      await openMembership(setup);
      const output = process.env.RETURN_CAPTURE_DIR;
      if (output) {
        await mkdir(output, { recursive: true });
        await writeFile(
          join(output, `membership-${width}x${height}.txt`),
          setup.captureCharFrame(),
        );
      }
      await enterLive(setup, "collection.inspector-back");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
      );
      expect(
        setup.renderer.root.findDescendantById("collection-membership-inspector"),
      ).toBeUndefined();
      expect(setup.captureCharFrame()).toContain("─team─");
      if (width < 100) expect(setup.renderer.root.findDescendantById("route-back")).toBeDefined();
      const table = setup.renderer.root.findDescendantById("collection-relationships")!;
      table.focus();
      setup.mockInput.pressArrow("down");
      setup.mockInput.pressArrow("down");
      await setup.flush();
      const relationControl = "collection-current-details";
      await enterLive(setup, relationControl);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("collection-relation-inspector"),
      );
      await setup.flush();
      await enterLive(setup, "collection.inspector-back");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
      );
      if (output)
        await writeFile(join(output, `reference-${width}x${height}.txt`), setup.captureCharFrame());
    } finally {
      await mounted.dispose();
    }
  },
);

test("the shared return is reachable by ordinary Tab and remains the same action through Actions dismissal", async () => {
  const mounted = await mount();
  const { setup } = mounted;
  try {
    await openMembership(setup);
    await focusLive(setup, "collection-membership-inspector");
    let reached = false;
    for (let index = 0; index < 12; index++) {
      setup.mockInput.pressTab();
      await setup.flush();
      if (setup.renderer.currentFocusedRenderable?.id === "collection.inspector-back") {
        reached = true;
        break;
      }
    }
    expect(reached).toBe(true);
    expect(setup.captureCharFrame()).toContain("Close");
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
  } finally {
    await mounted.dispose();
  }
});

test("Escape exits Reader Find before navigation but the displayed Back returns directly to its Collection", async () => {
  const mounted = await mount();
  const { setup } = mounted;
  try {
    await openMainPage(setup, "collections");
    await enterLive(setup, "collection-browser");
    await enterLive(setup, "collection-relationships");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-scrollbox"));
    await focusLive(setup, "reader-scrollbox");
    await setup.mockInput.typeText("/");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-find");
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    expect(setup.renderer.root.findDescendantById("reader-find-row")?.visible ?? false).toBe(false);
    expect(!!setup.renderer.root.findDescendantById("route-back")).toBe(true);

    await setup.mockInput.typeText("/");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-find");
    const back = setup.renderer.root.findDescendantById("route-back")!;
    await expectSharedReturn(setup, "Back to Collections");
    await setup.mockMouse.click(back.screenX + 1, back.screenY);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
    expect(setup.renderer.root.findDescendantById("reader-find-row")?.visible ?? false).toBe(false);
    expect(setup.captureCharFrame()).toContain("─team─");
  } finally {
    await mounted.dispose();
  }
});

test("Actions dismissal and the resize gate never replace a local return with its outer route", async () => {
  const mounted = await mount(80, 24);
  const { setup } = mounted;
  try {
    await openMembership(setup);
    await focusLive(setup, "collection.inspector-back");
    setup.resize(42, 12);
    await setup.flush();
    expect(!!setup.renderer.root.findDescendantById("route-back")).toBe(false);
    expect(!!setup.renderer.root.findDescendantById("resize-gate")).toBe(true);
    setup.resize(80, 24);
    await setup.flush();
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-membership-inspector"),
    );
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection.inspector-back"),
    );
    await enterLive(setup, "collection.inspector-back");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
    expect(setup.captureCharFrame()).toContain("─team─");
  } finally {
    await mounted.dispose();
  }
});

test.each([100, 80])(
  "FI-3 Back-focused resize recovers its live local parent without manual content focus at %i columns",
  async (width) => {
    const mounted = await mount(width, 24);
    const { setup } = mounted;
    try {
      await openMembership(setup);
      for (
        let step = 0;
        step < 12 && setup.renderer.currentFocusedRenderable?.id !== "collection.inspector-back";
        step++
      ) {
        setup.mockInput.pressTab();
        await setup.flush();
      }
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection.inspector-back");
      expect(setup.captureCharFrame()).toContain("Close");
      const old = setup.renderer.root.findDescendantById("collection-membership-inspector")!;
      setup.resize(42, 12);
      await setup.flush();
      expect(old.isDestroyed).toBe(true);
      setup.resize(width, 24);
      await setup.waitFor(
        () =>
          !!setup.renderer.root.findDescendantById("collection.inspector-back") &&
          setup.captureCharFrame().includes("Close"),
      );
      const live = setup.renderer.root.findDescendantById("collection-membership-inspector")!;
      expect(live === old).toBe(false);
      await enterLive(setup, "collection.inspector-back");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
      );
      expect(!!setup.renderer.root.findDescendantById("collection-membership-inspector")).toBe(
        false,
      );
      expect(!!setup.renderer.root.findDescendantById("route-back")).toBe(width < 100);
      expect(setup.captureCharFrame()).toContain("─team─");
    } finally {
      await mounted.dispose();
    }
  },
);

test.each(["pointer", "keyboard"])(
  "dismissible multi-owner impact can be closed by %s without unrelated Workspace filters",
  async (activation) => {
    const base = collectionsSourcesProjection();
    if (base.effective.status !== "complete") throw new Error("Expected complete fixture");
    const team = base.effective.collectionsView[0]!;
    const otherOwner = {
      level: "global" as const,
      file: "/global.jsonc",
      pointer: "/collections/team",
    };
    const projection = {
      ...base,
      effective: {
        ...base.effective,
        collectionsView: [
          {
            ...team,
            declared: [...team.declared, otherOwner],
            members: team.members.map((member, index) =>
              index === 1
                ? {
                    ...member,
                    paths: [
                      {
                        kind: "direct" as const,
                        collection: "team",
                        entryName: member.name,
                        owner: {
                          ...otherOwner,
                          pointer: `/collections/team/members/${member.name}`,
                        },
                      },
                    ],
                  }
                : member,
            ),
          },
          ...base.effective.collectionsView.slice(1),
        ],
      },
    };
    const mounted = await mount(100, 24, projection);
    const { setup } = mounted;
    try {
      await openMainPage(setup, "collections");
      await enterLive(setup, "collection-browser");
      await setup.mockInput.typeText(" ");
      setup.mockInput.pressArrow("down");
      await setup.flush();
      await setup.mockInput.typeText(" ");
      await enterLive(setup, "remove-from-collection");
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("membership-removal-plan"),
      );
      await setup.flush();
      const close = setup.renderer.root.findDescendantById("membership-removal-plan")!;
      expect(close.focusable).toBe(true);
      if (activation === "pointer") await setup.mockMouse.click(close.screenX + 1, close.screenY);
      else {
        for (
          let step = 0;
          step < 6 && setup.renderer.currentFocusedRenderable?.id !== "membership-removal-plan";
          step++
        ) {
          setup.mockInput.pressTab();
          await setup.flush();
        }
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("membership-removal-plan");
        await parsedEnter(setup);
      }
      await setup.waitFor(() => !setup.renderer.root.findDescendantById("membership-removal-plan"));
      expect(setup.captureCharFrame()).toContain("2 items checked");
    } finally {
      await mounted.dispose();
    }
  },
);
