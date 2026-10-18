/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import {
  InputRenderable,
  Renderable,
  SelectRenderable,
  TextRenderable,
  type BaseRenderable,
  type SelectOption,
} from "@opentui/core";
import { TabsTabRenderable } from "@tuiparts/core/tabs";
import type { WorkspaceView } from "@skill-cli/core";
import { testRender } from "@opentui/solid";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerAddress, readerProjection, readerSecondAddress } from "./installed-reader.fixture";
import {
  enterLive,
  focusLive,
  live,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  parsedEscape,
  selectedReaderTab,
  waitForReaderBody,
  type ReaderSetup,
} from "./reader-test-controls";

type SkillsView = "current-exposure" | "all-installed-skills" | "unassigned" | "problems";
const viewOrder: readonly SkillsView[] = [
  "current-exposure",
  "all-installed-skills",
  "unassigned",
  "problems",
];
const addressKey = (address: { readonly source: string; readonly path: string }) =>
  JSON.stringify([address.source, address.path]);
const interactionTraces = new WeakMap<ReaderSetup, unknown[]>();

function interactionState(setup: ReaderSetup, view?: SkillsView) {
  const tab = view ? setup.renderer.root.findDescendantById(`skills-view-tab-${view}`) : undefined;
  const navigation = setup.renderer.root.findDescendantById("workarea-navigation-pane");
  const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
  const query = setup.renderer.root.findDescendantById("skills-query");
  return {
    focus: setup.renderer.currentFocusedRenderable?.id,
    selectedView: selectedView(setup),
    tab:
      tab instanceof Renderable
        ? {
            x: tab.screenX,
            y: tab.screenY,
            width: tab.width,
            height: tab.height,
            visible: visible(tab),
          }
        : undefined,
    navigation:
      navigation instanceof Renderable
        ? { y: navigation.screenY, height: navigation.height, visible: visible(navigation) }
        : undefined,
    back: !!setup.renderer.root.findDescendantById("route-back"),
    query: query instanceof InputRenderable ? query.value : undefined,
    browser:
      browser instanceof SelectRenderable
        ? {
            index: browser.getSelectedIndex(),
            current: browser.getSelectedOption()?.value,
            options: browser.options.map((option) => ({ name: option.name, value: option.value })),
          }
        : undefined,
  };
}

function projection(): WorkspaceView {
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("Expected complete Reader fixture");
  const owner = {
    level: "project" as const,
    file: "/workspace/skill-cli/skill-cli.jsonc",
    pointer: "/collections/team",
  };
  const paths = [
    {
      kind: "direct" as const,
      collection: "team",
      entryName: "guide",
      owner: { ...owner, pointer: `${owner.pointer}/members/guide` },
    },
  ];
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: { ...config.direct, collections: [{ id: "team", owner }] },
          }
        : config,
    ),
    effective: {
      ...base.effective,
      collections: ["team"],
      collectionsView: [
        {
          id: "team",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [{ name: "guide", address: readerAddress, paths }],
          references: [],
          links: [],
        },
      ],
    },
    installedSkills: base.installedSkills.map((skill) => ({
      ...skill,
      description: `FI2 ${skill.description}`,
      collections: skill.address.path === "guide" ? [{ id: "team", entry: "guide", paths }] : [],
    })),
    diagnostics: [
      {
        severity: "warning",
        code: "FI2_SKILL_NOTICE",
        message: "FI2 reference diagnostic",
        subject: { kind: "installed-skill", address: readerSecondAddress },
      },
    ],
  };
}

async function mount(width = 80) {
  await mkdir("/tmp/opencode", { recursive: true });
  const cache = await mkdtemp("/tmp/opencode/skills-view-reentry-");
  const priorCache = process.env.SKILL_TUI_UPDATE_CACHE_DIR;
  process.env.SKILL_TUI_UPDATE_CACHE_DIR = cache;
  const reads: string[] = [];
  const checks: string[] = [];
  const writes: string[] = [];
  const completed: string[] = [];
  const events: string[] = [];
  const snapshot = projection();
  const eligibleSources = [
    ...new Set(snapshot.installedSkills.map((skill) => skill.address.source)),
  ].filter((source) => snapshot.effective.sources.some((binding) => binding.id === source));
  const pending = new Set<Promise<unknown>>();
  const pendingLabels = new Map<Promise<unknown>, string>();
  const tracked = <T,>(label: string, value: T): Promise<T> => {
    events.push(`start:${label}`);
    const request = Promise.resolve(value);
    pending.add(request);
    pendingLabels.set(request, label);
    void request.finally(() => {
      pending.delete(request);
      pendingLabels.delete(request);
      completed.push(label);
      events.push(`complete:${label}`);
    });
    return request;
  };
  let setup: ReaderSetup | undefined;
  let releaseSelectionTrace: (() => void) | undefined;
  let stage = "native App mount";
  const dispose = async () => {
    releaseSelectionTrace?.();
    setup?.renderer.destroy();
    await Promise.allSettled(pending);
    if (priorCache === undefined) delete process.env.SKILL_TUI_UPDATE_CACHE_DIR;
    else process.env.SKILL_TUI_UPDATE_CACHE_DIR = priorCache;
    await rm(cache, { recursive: true, force: true });
  };
  try {
    setup = await testRender(
      () => (
        <App
          core={directSourceCore(snapshot, {
            workspace: {
              get: () => tracked("workspace.get", { value: snapshot, diagnostics: [] }),
            },
            installed: {
              load: ({ address }) => {
                reads.push(addressKey(address));
                return tracked(`load:${addressKey(address)}`, {
                  address,
                  name: address.path,
                  description: `FI2 ${address.path}`,
                  markdownText: `# Prose ${address.path}\n\nFI2 installed ${address.path}`,
                  rawText: `RAW-FI2-${address.path}\n\nInstalled raw instructions`,
                });
              },
              listResources: () => tracked("listResources", []),
              checkUpdate: ({ source }) => {
                checks.push(source);
                return tracked(`checkUpdate:${source}`, {
                  value: {
                    source,
                    kind: "github" as const,
                    baseline: "baseline:test",
                    changed: [],
                    added: [],
                    removed: [],
                    unchanged: [],
                  },
                  diagnostics: [],
                });
              },
              update: () => {
                writes.push("update");
                return tracked("update", { value: undefined, diagnostics: [] });
              },
              install: () => {
                writes.push("install");
                return tracked("install", { value: [], diagnostics: [] });
              },
              uninstall: () => {
                writes.push("uninstall");
                return tracked("uninstall", { value: undefined, diagnostics: [] });
              },
            },
          })}
          exit={() => {}}
        />
      ),
      { width, height: 24 },
    );
    // Enter the actual All Skills view, not the obsolete default/Inspector path.
    stage = "openAllInstalledSkills helper (tab mount / focus / Enter / browser focus)";
    await openAllInstalledSkills(setup);
    const mountedSetup = setup;
    const trace: unknown[] = [];
    interactionTraces.set(setup, trace);
    const browser = live(setup, "installed-skill-browser") as SelectRenderable;
    const selectionChanged = (index: number, option: SelectOption | null) => {
      trace.push({
        event: "native selectionChanged",
        index,
        emittedValue: option?.value,
        ...interactionState(mountedSetup),
      });
    };
    browser.prependListener("selectionChanged", selectionChanged);
    releaseSelectionTrace = () => browser.off("selectionChanged", selectionChanged);
    events.push("All Skills helper returned");
    stage = "projection published, native All Skills browser ready, fixture requests drain";
    await setup.waitFor(() => {
      const browser = setup!.renderer.root.findDescendantById("installed-skill-browser");
      return (
        completed.includes("workspace.get") &&
        selectedView(setup!) === "all-installed-skills" &&
        browser instanceof SelectRenderable &&
        browser.options.length === snapshot.installedSkills.length &&
        setup!.renderer.currentFocusedRenderable === browser &&
        pending.size === 0
      );
    });
    // Cache hydration/startup checking is independent of browsing readiness.
    // The check may start later; final assertions allow that one initial call,
    // but reject a wrong Source or a second check triggered by view navigation.
    stage = "final mount flush";
    await setup.flush();
    return { setup, reads, checks, writes, dispose };
  } catch (error) {
    const nodes = (node: BaseRenderable): BaseRenderable[] => [
      node,
      ...node.getChildren().flatMap(nodes),
    ];
    const diagnostic = {
      stage,
      width,
      eligibleSources,
      configuredSources: snapshot.effective.sources.map((source) => source.id),
      installedAddresses: snapshot.installedSkills.map((skill) => skill.address),
      checks: [...checks],
      completed: [...completed],
      pending: [...pendingLabels.values()],
      events: [...events],
      reads: [...reads],
      writes: [...writes],
      focus: setup?.renderer.currentFocusedRenderable?.id,
      selectedView: setup ? selectedView(setup) : undefined,
      processStatus:
        setup?.renderer.root.findDescendantById("process-status") instanceof TextRenderable
          ? (setup.renderer.root.findDescendantById("process-status") as TextRenderable).plainText
          : undefined,
      controls: setup
        ? nodes(setup.renderer.root)
            .filter(
              (node) =>
                node.id.startsWith("skills-view-tab-") ||
                ["installed-skill-browser", "process-status", "skills-query"].includes(node.id),
            )
            .map((node) => ({
              id: node.id,
              visible: visible(node),
              selected: node instanceof TabsTabRenderable ? node.getState().selected : undefined,
              options:
                node instanceof SelectRenderable
                  ? node.options.map((option) => ({ name: option.name, value: option.value }))
                  : undefined,
            }))
        : undefined,
      frame: setup?.captureCharFrame(),
    };
    const cacheFile = await readFile(join(cache, "update-checks-v1.json"), "utf8").catch(
      (failure: unknown) => (failure instanceof Error ? failure.message : String(failure)),
    );
    console.error("FI2 mount diagnostic", JSON.stringify({ ...diagnostic, cacheFile }, null, 2));
    await dispose();
    throw error;
  }
}

function selectedView(setup: ReaderSetup): SkillsView | undefined {
  return viewOrder.find((view) => {
    const tab = setup.renderer.root.findDescendantById(`skills-view-tab-${view}`);
    return tab instanceof TabsTabRenderable && tab.getState().selected;
  });
}

function assertNoCheckRestart(checks: readonly string[]) {
  expect(checks.every((source) => source === "team-main")).toBe(true);
  expect(checks.length).toBeLessThanOrEqual(1);
}

function visible(node: BaseRenderable | undefined): boolean {
  if (!(node instanceof Renderable) || node.isDestroyed || !node.parent) return false;
  for (let current: BaseRenderable | null = node; current; current = current.parent)
    if (!current.visible || (current instanceof Renderable && current.isDestroyed)) return false;
  return node.width > 0 && node.height > 0;
}

async function pointerView(setup: ReaderSetup, view: SkillsView) {
  const tab = live(setup, `skills-view-tab-${view}`);
  expect(visible(tab)).toBe(true);
  const x = tab.screenX + 2;
  const y = tab.screenY;
  const before = interactionState(setup, view);
  await setup.mockMouse.pressDown(x, y);
  await setup.flush();
  const down = interactionState(setup, view);
  // One physical click: focus cannot relocate navigation between down and up.
  expect(down.navigation).toEqual(before.navigation);
  expect(down.tab).toEqual(before.tab);
  await setup.mockMouse.release(x, y);
  await setup.flush();
  const after = interactionState(setup, view);
  expect(after.navigation).toEqual(before.navigation);
  expect(after.tab).toEqual(before.tab);
  const trace = interactionTraces.get(setup);
  trace?.push({ event: "pointer view", view, x, y, before, down, after });
  if (selectedView(setup) !== view)
    console.error(
      "FI2 pointer view diagnostic",
      JSON.stringify(
        { view, x, y, before, down, after, trace, frame: setup.captureCharFrame() },
        null,
        2,
      ),
    );
}

async function keyboardView(setup: ReaderSetup, view: SkillsView) {
  // Reach the view strip by ordinary Tab after the compact-to-wide resize.
  for (
    let step = 0;
    step < 16 && !setup.renderer.currentFocusedRenderable?.id.startsWith("skills-view-tab-");
    step++
  ) {
    setup.mockInput.pressTab();
    await setup.flush();
  }
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-view-tab-all-installed-skills");
  const destination = viewOrder.indexOf(view);
  const direction = destination > 1 ? 1 : -1;
  for (let index = 1; index !== destination;) {
    index += direction;
    setup.mockInput.pressArrow(direction > 0 ? "right" : "left");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === `skills-view-tab-${viewOrder[index]}`,
    );
    await setup.flush();
  }
}

async function routeCommand(setup: ReaderSetup, expected: boolean) {
  const origin = setup.renderer.currentFocusedRenderable;
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
  const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
  expect(choices.options.some((option) => option.value.id === "route.back")).toBe(expected);
  await parsedEscape(setup);
  await setup.waitFor(
    () =>
      !setup.renderer.root.findDescendantById("palette-choices") &&
      setup.renderer.currentFocusedRenderable === origin,
  );
}

async function assertRawReference(setup: ReaderSetup) {
  await setup.waitFor(() => {
    const line = setup.renderer.root.findDescendantById("reader-line-0");
    return line instanceof TextRenderable && line.plainText === "RAW-FI2-reference";
  });
  await setup.flush();
  expect(visible(live(setup, "reader-line-0"))).toBe(true);
  expect(setup.captureCharFrame()).toContain("RAW-FI2-reference");
}

async function enterCompactInlineReader(setup: ReaderSetup) {
  const browser = live(setup, "installed-skill-browser") as SelectRenderable;
  expect(browser.getSelectedOption()?.value).toBe(addressKey(readerAddress));
  await setup.mockInput.typeText(" ");
  await focusLive(setup, "skills-query");
  await setup.mockInput.typeText("FI2");
  await parsedEnter(setup);
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
  );
  setup.mockInput.pressArrow("down");
  await setup.waitFor(() => browser.getSelectedOption()?.value === addressKey(readerSecondAddress));
  await parsedEnter(setup);
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
  await waitForReaderBody(setup, "FI2 installed reference");
  expect(
    visible(setup.renderer.root.findDescendantById("skills-view-tab-all-installed-skills")),
  ).toBe(true);
  // Keep non-default preferences on the same exact address across view changes.
  await enterLive(setup, "reader-raw");
  await assertRawReference(setup);
  await openReaderTab(setup, 2);
  expect(selectedReaderTab(setup)).toBe(2);
  setup.resize(144, 24);
  await setup.flush();
  expect(visible(live(setup, "skills-view-tab-all-installed-skills"))).toBe(true);
  expect(selectedView(setup)).toBe("all-installed-skills");
  // No focus repair or local Back between Reader entry and the tested view input.
}

async function assertViewContent(
  setup: ReaderSetup,
  view: Exclude<SkillsView, "all-installed-skills">,
) {
  await setup.waitFor(() => selectedView(setup) === view);
  if (view === "unassigned") {
    const browser = live(setup, "installed-skill-browser") as SelectRenderable;
    expect(browser.options.map((option) => option.value)).toEqual([
      addressKey(readerSecondAddress),
    ]);
    expect(browser.getSelectedOption()?.value).toBe(addressKey(readerSecondAddress));
    await focusLive(setup, "installed-skill-browser");
  } else if (view === "problems") {
    const browser = live(setup, "problems-browser") as SelectRenderable;
    expect(visible(browser)).toBe(true);
    const diagnostic = browser.options.find((option) => {
      const row = JSON.parse(option.value);
      return (
        row.code === "FI2_SKILL_NOTICE" &&
        row.message === "FI2 reference diagnostic" &&
        row.diagnosticSubject?.kind === "installed-skill" &&
        addressKey(row.diagnosticSubject.address) === addressKey(readerSecondAddress)
      );
    });
    expect(!!diagnostic).toBe(true);
    // DataList pads/truncates descriptions to the native viewport width.
    expect(diagnostic!.description.trim()).toBe("FI2 reference diagnostic");
    expect(visible(setup.renderer.root.findDescendantById("reader-details"))).toBe(false);
    await focusLive(setup, "problems-browser");
  } else {
    expect(visible(live(setup, "agent-access-pane"))).toBe(true);
    expect(setup.captureCharFrame()).toContain("Agent access is unavailable");
    expect(visible(setup.renderer.root.findDescendantById("reader-details"))).toBe(false);
    const problems = live(setup, "current-exposure-problems");
    expect(visible(problems)).toBe(true);
    // This fixture has no selected Agent node. Use its actual visible recovery
    // control, without activating it or inventing a preview focus target.
    await focusLive(setup, "current-exposure-problems");
  }
  await setup.flush();
  // A local Skills view change cannot manufacture a route predecessor or root Back.
  expect(!!setup.renderer.root.findDescendantById("route-back")).toBe(false);
  await routeCommand(setup, false);
}

async function assertRetainedBrowserAndReader(setup: ReaderSetup) {
  await pointerView(setup, "all-installed-skills");
  await setup.waitFor(() => selectedView(setup) === "all-installed-skills");
  const browser = live(setup, "installed-skill-browser") as SelectRenderable;
  if (browser.getSelectedOption()?.value !== addressKey(readerSecondAddress))
    console.error(
      "FI2 retained selection diagnostic",
      JSON.stringify(
        {
          expected: addressKey(readerSecondAddress),
          actual: interactionState(setup),
          trace: interactionTraces.get(setup),
          frame: setup.captureCharFrame(),
        },
        null,
        2,
      ),
    );
  expect((live(setup, "skills-query") as InputRenderable).value).toBe("FI2");
  expect(browser.getSelectedOption()?.value).toBe(addressKey(readerSecondAddress));
  expect(
    browser.options.filter((option) => option.name.startsWith("✓")).map((option) => option.value),
  ).toEqual([addressKey(readerAddress)]);
  expect(selectedReaderTab(setup)).toBe(2);
  await focusLive(setup, "installed-skill-browser");
  await setup.flush();
  expect(!!setup.renderer.root.findDescendantById("route-back")).toBe(false);
  await routeCommand(setup, false);
  await parsedEnter(setup);
  await openReaderTab(setup, 0);
  await assertRawReference(setup);
}

for (const activation of ["pointer", "keyboard"] as const) {
  for (const view of ["unassigned", "problems", "current-exposure"] as const) {
    test(`FI2 Skills view ${activation} ${view} survives compact inline Reader then wide resize`, async () => {
      const mounted = await mount();
      const { setup } = mounted;
      try {
        await enterCompactInlineReader(setup);
        const reads = [...mounted.reads];
        if (activation === "pointer") await pointerView(setup, view);
        else await keyboardView(setup, view);
        await assertViewContent(setup, view);
        await assertRetainedBrowserAndReader(setup);
        expect(mounted.reads).toEqual(reads);
        assertNoCheckRestart(mounted.checks);
        expect(mounted.writes).toEqual([]);
      } finally {
        await mounted.dispose();
      }
    });
  }
}

test("FI2 Skills same-value reentry preserves checked query exact selection and Reader preferences without history", async () => {
  const mounted = await mount();
  const { setup } = mounted;
  try {
    await enterCompactInlineReader(setup);
    const reads = [...mounted.reads];
    await pointerView(setup, "all-installed-skills");
    await pointerView(setup, "all-installed-skills");
    await assertRetainedBrowserAndReader(setup);
    expect(mounted.reads).toEqual(reads);
    assertNoCheckRestart(mounted.checks);
    expect(mounted.writes).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});

test("FI2 explicit Problems Reader route still restores its Reader after a Skills view change and Back", async () => {
  const mounted = await mount(144);
  const { setup } = mounted;
  try {
    await pointerView(setup, "problems");
    await setup.waitFor(() => selectedView(setup) === "problems");
    // Real installed-skill intent makes an explicit Reader route, unlike list Enter.
    await enterLive(setup, "problems-browser");
    await waitForReaderBody(setup, "FI2 installed reference");
    await enterLive(setup, "reader-raw");
    await assertRawReference(setup);
    await openReaderTab(setup, 2);
    const reads = [...mounted.reads];
    await routeCommand(setup, true);
    await pointerView(setup, "current-exposure");
    await setup.waitFor(() => selectedView(setup) === "current-exposure");
    expect(visible(live(setup, "agent-access-pane"))).toBe(true);
    await routeCommand(setup, true);
    const back = live(setup, "route-back");
    await setup.mockMouse.click(back.screenX + 1, back.screenY);
    await setup.waitFor(
      () =>
        selectedView(setup) === "all-installed-skills" &&
        !!setup.renderer.root.findDescendantById("reader-tabs-tab-details") &&
        selectedReaderTab(setup) === 2,
    );
    const browser = live(setup, "installed-skill-browser") as SelectRenderable;
    expect(browser.getSelectedOption()?.value).toBe(addressKey(readerSecondAddress));
    await openReaderTab(setup, 0);
    await assertRawReference(setup);
    expect(mounted.reads).toEqual(reads);
    assertNoCheckRestart(mounted.checks);
    expect(mounted.writes).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
