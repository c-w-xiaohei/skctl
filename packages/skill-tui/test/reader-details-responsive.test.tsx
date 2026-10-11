import { expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable, type Renderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { skillAddressKey } from "../src/types";
import { directSourceCore, openReaderFromInspector } from "./direct-source.fixture";
import {
  readerContent,
  readerProjection,
  readerSecondAddress,
  readerSecondContent,
} from "./installed-reader.fixture";
import {
  focusLive,
  openReaderTab,
  parsedEnter,
  readerTab,
  selectedReaderTab,
} from "./reader-test-controls";

type Setup = Awaited<ReturnType<typeof testRender>>;

function selectedSkillIs(setup: Setup, value: string) {
  return setup.captureCharFrame().includes(`Address  ${value}`);
}

function detailsAreReady(setup: Setup, skill: string) {
  return (
    setup.renderer.root.findDescendantById("reader-views") !== undefined &&
    selectedReaderTab(setup) === 2 &&
    !!setup.renderer.root.findDescendantById("reader-details") &&
    setup.captureCharFrame().includes(`Reader · ${skill.split("/").at(-1)}`) &&
    setup.captureCharFrame().includes(`Address  ${skill}`) &&
    setup.captureCharFrame().includes("Summary")
  );
}

async function openDetails(setup: Setup, skill: string) {
  await openReaderFromInspector(setup);
  if (selectedReaderTab(setup) !== 2) await openReaderTab(setup, 2);
  await setup.waitFor(() => detailsAreReady(setup, skill));
  const focusedTab = readerTab(setup, 2);
  focusedTab.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === focusedTab);
  setup.mockInput.pressKey("TAB");
  await setup.waitFor(
    () =>
      detailsAreReady(setup, skill) &&
      setup.renderer.currentFocusedRenderable ===
        setup.renderer.root.findDescendantById("reader-details"),
  );
}

async function ensureDetails(setup: Setup, skill: string) {
  if (detailsAreReady(setup, skill)) return;
  if (!setup.renderer.root.findDescendantById("reader-views")) {
    const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
    expect(browser).toBeInstanceOf(SelectRenderable);
    browser!.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
    await parsedEnter(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
  }
  await setup.waitFor(() => selectedSkillIs(setup, skill));
  if (setup.renderer.root.findDescendantById("reader-views")) {
    await setup.waitFor(
      () =>
        !!setup.renderer.root.findDescendantById("reader-views") &&
        !!setup.renderer.root.findDescendantById("reader-details"),
    );
    setup.renderer.root.findDescendantById("reader-details")!.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-details");
    return;
  }
  await openDetails(setup, skill);
}

async function awaitParsedEscape(setup: Setup) {
  await new Promise<void>((resolve) => {
    const onKeypress = (event: { readonly name: string }) => {
      if (event.name === "escape" || event.name === "esc") {
        setup.renderer.keyInput.off("keypress", onKeypress);
        resolve();
      }
    };
    setup.renderer.keyInput.prependListener("keypress", onKeypress);
    setup.mockInput.pressKey("ESCAPE");
  });
  await Promise.resolve();
  await setup.renderOnce();
}

function mounted(setup: Setup, id: string): Renderable {
  const target = setup.renderer.root.findDescendantById(id);
  expect(target).toBeDefined();
  const renderable = target as Renderable;
  expect(renderable.isDestroyed).toBe(false);
  expect(renderable.parent).toBeDefined();
  return renderable;
}

function mountedSelect(setup: Setup, id: string): SelectRenderable {
  const target = mounted(setup, id);
  expect(target).toBeInstanceOf(SelectRenderable);
  return target as SelectRenderable;
}

function containsText(node: { getChildren(): readonly unknown[] }, text: string): boolean {
  return node
    .getChildren()
    .some(
      (child) =>
        (child &&
          typeof child === "object" &&
          "plainText" in child &&
          typeof child.plainText === "string" &&
          child.plainText.includes(text)) ||
        (child &&
          typeof child === "object" &&
          "getChildren" in child &&
          containsText(child as { getChildren(): readonly unknown[] }, text)),
    );
}

function noRelationshipProjection() {
  const projection = readerProjection();
  return {
    ...projection,
    installedSkills: projection.installedSkills.map((skill) => ({ ...skill, source: undefined })),
  };
}

function expectInBounds(
  renderable: { screenX: number; screenY: number; width: number; height: number },
  width: number,
  height: number,
) {
  expect(renderable.screenX).toBeGreaterThanOrEqual(0);
  expect(renderable.screenY).toBeGreaterThanOrEqual(0);
  expect(renderable.screenX + renderable.width).toBeLessThanOrEqual(width);
  expect(renderable.screenY + renderable.height).toBeLessThanOrEqual(height);
}

async function expectDetailsLayout(setup: Setup, width: number, height: number, scrollTop: number) {
  const details = setup.renderer.root.findDescendantById("reader-details") as ScrollBoxRenderable;
  expectDetailsReady(setup);
  await setup.waitFor(() => details.scrollTop === scrollTop);
  expectInBounds(details, width, height);

  const controls = [
    setup.renderer.root.findDescendantById("route-back"),
    setup.renderer.root.findDescendantById("reader-details-action-skill-add-to-collection"),
    setup.renderer.root.findDescendantById("reader-details-relationship-source"),
    setup.renderer.root.findDescendantById("reader-details-metadata"),
  ].filter((control) => control !== undefined);
  for (const control of controls) {
    expectInBounds(control, width, height);
  }

  expect(setup.renderer.currentFocusedRenderable).toBeDefined();
  const focused = setup.renderer.currentFocusedRenderable;
  if (focused === null) {
    throw new Error("Details layout lost its focused renderable");
  }
  expect([details, ...controls]).toContain(focused);
}

function expectDetailsReady(setup: Setup) {
  expect(selectedReaderTab(setup)).toBe(2);
  expect(setup.renderer.root.findDescendantById("reader-details")).toBeDefined();
}

test("RENDER Details Tab traversal never retains an unmounted relationship focus", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openDetails(setup, "team-main/guide");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details");
    setup.renderer.root.findDescendantById("reader-details")!.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-details");

    for (const id of [
      "reader-details-action-skill-open-source",
      "reader-details-action-skill-check-updates",
      "reader-details-action-skill-rebind",
      "reader-details-action-skill-uninstall",
      "reader-details-relationship-source",
      "reader-details-relationship-config",
      "reader-details-metadata",
    ]) {
      setup.mockInput.pressKey("TAB");
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(id);
    }

    setup.renderer.root.findDescendantById("reader-details-metadata")!.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-details-metadata",
    );
    for (const id of [
      "reader-details-relationship-config",
      "reader-details-relationship-source",
      "reader-details-action-skill-uninstall",
      "reader-details-action-skill-rebind",
      "reader-details-action-skill-check-updates",
      "reader-details-action-skill-open-source",
      "reader-details",
    ]) {
      setup.mockInput.pressKey("TAB", { shift: true });
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(id);
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Details skips absent relationships and disabled actions in both directions", async () => {
  const projection = noRelationshipProjection();
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore({
          ...projection,
          configs: projection.configs.map((config) => ({
            ...config,
            direct: { ...config.direct, collections: [] },
          })),
          effective: {
            status: "complete" as const,
            sources: projection.effective.sources,
            collections: ["derived"],
            use: [],
            managed: false,
            agent: {
              status: "unavailable" as const,
              integration: [],
              use: [],
              reasons: [],
              catalog: [],
            },
            collectionsView: [
              {
                id: "derived",
                declared: [],
                repository: { derived: true, producers: [projection.installedSkills[0]!.address] },
                members: [],
                references: [],
                links: [],
              },
            ],
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openDetails(setup, "team-main/guide");
    expect(
      setup.renderer.root.findDescendantById("reader-details-relationship-source"),
    ).toBeUndefined();
    expect(
      setup.renderer.root.findDescendantById("reader-details-action-skill-add-to-collection"),
    ).toBeDefined();

    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details-action-skill-rebind");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(
      "reader-details-action-skill-uninstall",
    );

    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details-metadata");

    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(
      "reader-details-action-skill-uninstall",
    );

    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details-action-skill-rebind");

    expect(setup.renderer.currentFocusedRenderable?.id).not.toBe(
      "reader-details-action-skill-add-to-collection",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Details Actions Escape returns once to the selected Skill Inspector", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async (request) => ({
            value:
              request.address.path === readerSecondAddress.path
                ? readerSecondContent
                : readerContent,
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openDetails(setup, "team-main/guide");
    setup.renderer.root.findDescendantById("reader-details")!.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-details");
    await focusLive(setup, "reader-details-action-skill-rebind");

    await awaitParsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
    );
    expect(setup.captureCharFrame()).toContain("team-main/guide");
    expect(setup.renderer.root.findDescendantById("reader-views")).toBeUndefined();

    await awaitParsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Details Relationships Escape returns to the selected Skill Inspector", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openDetails(setup, "team-main/guide");
    await focusLive(setup, "reader-details-relationship-source");
    await awaitParsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
    );
    expect(setup.captureCharFrame()).toContain("team-main/guide");
    expect(setup.renderer.root.findDescendantById("reader-views")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Details metadata Escape returns once to the selected Skill Inspector", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openDetails(setup, "team-main/guide");
    const metadata = setup.renderer.root.findDescendantById("reader-details-metadata")!;
    metadata.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === metadata);

    await awaitParsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
    );
    expect(selectedSkillIs(setup, "team-main/guide")).toBe(true);
    expect(setup.renderer.root.findDescendantById("reader-views")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Details without relationships toggles metadata by Enter and Space without stale bindings", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(noRelationshipProjection(), {
          loadInstalled: async (request) => ({
            value:
              request.address.path === readerSecondAddress.path
                ? readerSecondContent
                : readerContent,
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openDetails(setup, "team-main/guide");
    const metadata = setup.renderer.root.findDescendantById("reader-details-metadata")!;
    metadata.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === metadata);
    expect(
      setup.renderer.root.findDescendantById("reader-details-relationship-source"),
    ).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("reader-details-metadata")).toBeDefined();

    await parsedEnter(setup);
    await setup.waitFor(() => containsText(setup.renderer.root, "Entry name  guide"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details-metadata");

    setup.mockInput.pressKey(" ");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details-metadata");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details-metadata");

    setup.mockInput.pressKey(" ");
    await setup.waitFor(() => containsText(setup.renderer.root, "Entry name  guide"));
    setup.resize(79, 24);
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("reader-details")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("installed-skill-browser")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER task-first Details controls remain bounded at supported breakpoints", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openDetails(setup, "team-main/guide");
    for (const [width, height] of [
      [120, 40],
      [80, 24],
    ] as const) {
      setup.resize(width, height);
      await setup.waitFor(() => detailsAreReady(setup, "team-main/guide"));
      const details = setup.renderer.root.findDescendantById("reader-details")!;
      const actions = setup.renderer.root.findDescendantById(
        "reader-details-action-skill-add-to-collection",
      )!;
      const metadata = setup.renderer.root.findDescendantById("reader-details-metadata")!;
      expect(setup.captureCharFrame()).toContain("Summary");
      expectInBounds(details, width, height);
      expectInBounds(actions, width, height);
      expectInBounds(metadata, width, height);
    }

    for (const [width, height] of [
      [79, 24],
      [43, 30],
    ] as const) {
      setup.resize(width, height);
      await setup.waitFor(
        () =>
          !!setup.renderer.root.findDescendantById("reader-details") &&
          !!setup.renderer.root.findDescendantById("reader-views"),
      );
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Details retains per-Skill scroll, native tab, mounted focus, destinations, and responsive levels", async () => {
  const scrollTop = Object.getOwnPropertyDescriptor(ScrollBoxRenderable.prototype, "scrollTop")!;
  const applied: number[] = [];
  const loads: string[] = [];
  const positions = new WeakMap<ScrollBoxRenderable, number>();
  Object.defineProperty(ScrollBoxRenderable.prototype, "scrollTop", {
    configurable: true,
    get() {
      return this.id === "reader-details"
        ? (positions.get(this) ?? scrollTop.get!.call(this))
        : scrollTop.get!.call(this);
    },
    set(value: number) {
      if (this.id === "reader-details") {
        positions.set(this, value);
        applied.push(value);
      }
      scrollTop.set!.call(this, value);
    },
  });
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async (request) => {
            loads.push(request.address.path);
            return {
              value:
                request.address.path === readerSecondAddress.path
                  ? readerSecondContent
                  : readerContent,
              diagnostics: [],
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openDetails(setup, "team-main/guide");
    await setup.waitFor(() => loads.includes("guide"));
    const aDetails = setup.renderer.root.findDescendantById(
      "reader-details",
    ) as ScrollBoxRenderable;
    aDetails.scrollTop = 7;
    setup.mockInput.pressKey("PAGEDOWN");
    await Promise.resolve();
    await setup.mockMouse.scroll(aDetails.screenX, aDetails.screenY, "down");
    await setup.renderOnce();
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    const aActions = setup.renderer.root.findDescendantById(
      "reader-details-action-skill-open-source",
    )!;
    expect(aDetails.screenX + aDetails.width).toBeLessThanOrEqual(120);
    expect(aActions.screenX + aActions.width).toBeLessThanOrEqual(120);
    expect(setup.renderer.currentFocusedRenderable).toBe(aActions);
    expect(selectedReaderTab(setup)).toBe(2);

    await awaitParsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
    );
    await awaitParsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    let referenceBrowser = mountedSelect(setup, "installed-skill-browser");
    referenceBrowser.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === referenceBrowser);
    setup.mockInput.pressArrow("down");
    await setup.waitFor(
      () =>
        (
          setup.renderer.root.findDescendantById(
            "installed-skill-browser",
          ) as import("@opentui/core").SelectRenderable
        ).getSelectedOption()?.value ===
        skillAddressKey({ source: "team-main", path: "reference" }),
    );
    referenceBrowser = mountedSelect(setup, "installed-skill-browser");
    referenceBrowser.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === referenceBrowser);
    await parsedEnter(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
    await setup.waitFor(() => selectedSkillIs(setup, "team-main/reference"));
    const referenceReader = mounted(setup, "skill-inspector-open-reader");
    referenceReader.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === referenceReader);
    await openDetails(setup, "team-main/reference");
    await setup.waitFor(() => detailsAreReady(setup, "team-main/reference"));
    expect(setup.captureCharFrame()).toContain("Address  team-main/reference");
    const bDetails = setup.renderer.root.findDescendantById(
      "reader-details",
    ) as ScrollBoxRenderable;
    bDetails.scrollTop = 3;
    await setup.mockMouse.scroll(bDetails.screenX, bDetails.screenY, "down");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-details");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === "reader-details-action-skill-open-source",
    );
    expect(applied).toContain(3);

    await awaitParsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
    );
    await awaitParsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    let guideBrowser = mountedSelect(setup, "installed-skill-browser");
    guideBrowser.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === guideBrowser);
    setup.mockInput.pressArrow("up");
    await setup.waitFor(
      () =>
        (
          setup.renderer.root.findDescendantById(
            "installed-skill-browser",
          ) as import("@opentui/core").SelectRenderable
        ).getSelectedOption()?.value === skillAddressKey({ source: "team-main", path: "guide" }),
    );
    guideBrowser = mountedSelect(setup, "installed-skill-browser");
    guideBrowser.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === guideBrowser);
    await parsedEnter(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
    await setup.waitFor(() => selectedSkillIs(setup, "team-main/guide"));
    const guideReader = mounted(setup, "skill-inspector-open-reader");
    guideReader.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === guideReader);
    await openDetails(setup, "team-main/guide");
    await setup.waitFor(() => detailsAreReady(setup, "team-main/guide"));
    expect(setup.captureCharFrame()).toContain("Address  team-main/guide");
    expect(selectedReaderTab(setup)).toBe(2);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details");
    expect(loads).toEqual(["guide", "reference"]);
    expect(applied).toContain(7);

    for (const [width, height] of [
      [120, 40],
      [80, 24],
      [79, 24],
      [43, 30],
    ] as const) {
      setup.resize(width, height);
      await setup.waitFor(() => selectedSkillIs(setup, "team-main/guide"));
      await ensureDetails(setup, "team-main/guide");
      await expectDetailsLayout(setup, width, height, 8);
    }
  } finally {
    setup.renderer.destroy();
    Object.defineProperty(ScrollBoxRenderable.prototype, "scrollTop", scrollTop);
  }
});
