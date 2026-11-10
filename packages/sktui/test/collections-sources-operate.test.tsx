/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import {
  BoxRenderable,
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextRenderable,
} from "@opentui/core";
import type { WorkspaceView, SkillAddress } from "@skctl/core";
import { testRender } from "@opentui/solid";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { collectionFilterPathKey } from "../src/collections/collection-filter-tree";
import {
  enterLive,
  focusLive,
  parsedEnter,
  parsedEscape,
  waitForReaderBody,
} from "./reader-test-controls";
async function mount(
  width: number,
  height: number,
  projection: WorkspaceView = collectionsSourcesProjection(),
) {
  const cache = await mkdtemp(join(tmpdir(), "collections-sources-"));
  const prior = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
  process.env.SKTUI_UPDATE_SCHEDULE_DIR = cache;
  const reads: SkillAddress[] = [];
  const sideEffects: string[] = [];
  const checks: string[] = [];
  const unexpected = async () => {
    sideEffects.push("unexpected acquisition/mutation");
    throw new Error("Browsing must not acquire or mutate Skills");
  };
  const core = directSourceCore(projection, {
    discoverSkills: unexpected,
    removeSource: unexpected,
    installSkills: unexpected,
    updateSkills: unexpected,
    loadInstalledSkill: async (_environment: import("@skctl/core").CoreOptions, { address }) => {
      reads.push(address);
      const skill = projection.installedSkills.find(
        (skill) => skill.address.source === address.source && skill.address.path === address.path,
      )!;
      const text = `# ${skill.name}\n\nInstalled ${address.source}/${address.path}`;
      return {
        address,
        name: skill.name,
        description: skill.description,
        rawText: text,
        markdownText: text,
      };
    },
    getUpdateBaseline: async () => ({ value: "operate-baseline", diagnostics: [] }),
    checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
      checks.push(source);
      return {
        value: {
          source,
          kind: "github",
          exactRevision: "a".repeat(40),
          baseline: "operate-baseline",
          changed: [],
          removed: [],
          added: [],
          unchanged: projection.installedSkills
            .filter((skill) => skill.address.source === source)
            .map((skill) => ({
              path: skill.address.path,
              name: skill.name,
              description: skill.description,
            })),
        },
        diagnostics: [],
      };
    },
  });
  core.createCollection = unexpected;
  core.addMember = unexpected;
  core.removeMember = unexpected;
  core.editMembers = unexpected;
  const setup = await testRender(() => <App core={core} exit={() => {}} />, { width, height });
  const initialSources = new Set(projection.installedSkills.map((skill) => skill.address.source));
  if (projection.effective.status === "complete" && initialSources.size)
    await setup.waitFor(() => checks.length >= initialSources.size);
  await setup.flush();
  return {
    setup,
    reads,
    sideEffects,
    checks,
    async dispose() {
      setup.renderer.destroy();
      if (prior === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
      else process.env.SKTUI_UPDATE_SCHEDULE_DIR = prior;
      await rm(cache, { recursive: true, force: true });
    },
  };
}
async function selectTeam(setup: Awaited<ReturnType<typeof testRender>>) {
  await openMainPage(setup, "collections");
  await setup.waitFor(
    () =>
      setup.renderer.root.findDescendantById("collection-browser") instanceof ScrollBoxRenderable,
  );
  const browser = setup.renderer.root.findDescendantById(
    "collection-browser",
  ) as ScrollBoxRenderable;
  await setup.flush();
  const name = setup.renderer.root.findDescendantById(
    `collection-browser-row-${encodeURIComponent(collectionFilterPathKey({ segments: [{ collection: "team" }] }))}-name`,
  )!;
  await setup.mockMouse.click(name.screenX + 1, name.screenY);
  await setup.flush();
  return browser;
}
test.each([
  [144, 40],
  [100, 24],
  [80, 24],
  [43, 13],
])("Collections and Sources production-path layout at %ix%i", async (width, height) => {
  const mounted = await mount(width, height);
  const { setup } = mounted;
  try {
    const browser = await selectTeam(setup);
    expect(browser.height).toBeGreaterThan(0);
    expect(browser.screenY + browser.height).toBeLessThanOrEqual(height - 1);
    expect(setup.captureCharFrame()).toContain("Collections");
    const output = process.env.OPERATE_CAPTURE_DIR;
    if (output) {
      await mkdir(output, { recursive: true });
      await writeFile(join(output, `collections-${width}x${height}.txt`), setup.captureCharFrame());
      await writeFile(
        join(output, `collections-${width}x${height}.json`),
        JSON.stringify(setup.captureSpans(), null, 2),
      );
    }
    await openMainPage(setup, "sources");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Sources");
    if (output) {
      await writeFile(join(output, `sources-${width}x${height}.txt`), setup.captureCharFrame());
      await writeFile(
        join(output, `sources-${width}x${height}.json`),
        JSON.stringify(setup.captureSpans(), null, 2),
      );
    }
  } finally {
    await mounted.dispose();
  }
});
test.each([
  [144, 40],
  [80, 24],
  [43, 13],
])(
  "Collection members read directly and return to the checked row at %ix%i",
  async (width, height) => {
    const mounted = await mount(width, height);
    const { setup } = mounted;
    try {
      const startupReads = [...mounted.reads];
      const browser = await selectTeam(setup);
      if (width >= 100) {
        expect(setup.renderer.root.findDescendantById("collection-relationships")).toBeInstanceOf(
          BoxRenderable,
        );
        expect(setup.renderer.root.findDescendantById("collection-preview-pane")).toBeUndefined();
        expect(mounted.reads).toEqual(startupReads);
      }
      await focusLive(setup, browser.id);
      await parsedEnter(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
      );
      const before = setup.renderer.root.findDescendantById(
        "collection-relationships-body",
      ) as ScrollBoxRenderable;
      expect(before.viewport.height).toBeGreaterThan(0);
      await setup.mockInput.typeText(" ");
      await parsedEnter(setup);
      await waitForReaderBody(setup, "Installed team-main/guide");
      expect(
        mounted.reads.every(
          (address) => address.source === "team-main" && address.path === "guide",
        ),
      ).toBe(true);
      expect(mounted.reads).toContainEqual({ source: "team-main", path: "guide" });
      expect(
        setup.renderer.root.findDescendantById("collection-membership-inspector"),
      ).toBeUndefined();
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
      );
      const check = setup.renderer.root.findDescendantById(
        "collection-relationships-row-guide%3A0:check",
      ) as TextRenderable;
      expect(check.plainText).toContain("✓");
      expect(mounted.sideEffects).toEqual([]);
      if (process.env.OPERATE_CAPTURE_DIR)
        await writeFile(
          join(process.env.OPERATE_CAPTURE_DIR, `contents-${width}x${height}.txt`),
          setup.captureCharFrame(),
        );
    } finally {
      await mounted.dispose();
    }
  },
);
test("Reference opens its actual Collection and Back restores the parent query and reference cursor", async () => {
  const mounted = await mount(100, 24);
  const { setup } = mounted;
  try {
    const startupReads = [...mounted.reads];
    await selectTeam(setup);
    await focusLive(setup, "collections-query");
    await setup.mockInput.typeText("team");
    await parsedEnter(setup);
    await enterLive(setup, "collection-browser");
    const table = await focusLive(setup, "collection-relationships");
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("docs"));
    expect(
      (setup.renderer.root.findDescendantById("collections-query") as InputRenderable).value,
    ).toBe("");
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === table.id);
    expect(
      (setup.renderer.root.findDescendantById("collections-query") as InputRenderable).value,
    ).toBe("team");
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("docs"));
    expect(mounted.reads).toEqual(startupReads);
    expect(mounted.sideEffects).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test.each([
  [144, 40],
  [80, 24],
  [43, 13],
])(
  "Source Enter opens its installed Skills workspace, not update comparison, at %ix%i",
  async (width, height) => {
    const mounted = await mount(width, height);
    const { setup } = mounted;
    try {
      await openMainPage(setup, "sources");
      const source = await focusLive(setup, "source-browser");
      const count = mounted.checks.length;
      await parsedEnter(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-details-pane"));
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("source-installed-skills"),
      );
      expect(setup.renderer.root.findDescendantById("source-updates-browser")).toBeUndefined();
      await enterLive(setup, "source-installed-skills");
      await waitForReaderBody(setup, "Installed team-main/guide");
      expect(mounted.reads).toContainEqual({ source: "team-main", path: "guide" });
      await parsedEscape(setup);
      await parsedEscape(setup);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === source.id);
      expect(
        (setup.renderer.currentFocusedRenderable as SelectRenderable).getSelectedOption()?.value,
      ).toBe("team-main");
      expect(mounted.checks).toHaveLength(count);
      expect(mounted.sideEffects).toEqual([]);
    } finally {
      await mounted.dispose();
    }
  },
);
test("optional single-origin ownership has live focus and all original exact-target controls", async () => {
  const mounted = await mount(80, 24);
  const { setup } = mounted;
  try {
    await selectTeam(setup);
    await enterLive(setup, "collection-browser");
    const startupReads = [...mounted.reads];
    await enterLive(setup, "collection-more");
    await enterLive(setup, "collection-current-details");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-membership-inspector",
    );
    expect(setup.renderer.currentFocusedRenderable?.isDestroyed).toBe(false);
    expect(!!setup.renderer.root.findDescendantById("membership.remove")).toBe(false);
    expect(setup.renderer.root.findDescendantById("collection-membership-actions")).toBeUndefined();
    expect(mounted.reads).toEqual(startupReads);
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
    expect(mounted.sideEffects).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test("Source inline Skill reading restores current row and optional Details across Config Back", async () => {
  const mounted = await mount(144, 40);
  const { setup } = mounted;
  try {
    await openMainPage(setup, "sources");
    await focusLive(setup, "source-installed-skills");
    setup.mockInput.pressArrow("down");
    await setup.flush();
    await parsedEnter(setup);
    await waitForReaderBody(setup, "Installed team-main/reference");
    await parsedEscape(setup);
    await setup
      .waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-installed-skills")
      .catch((error) => {
        throw new Error(
          `Inline Source Back focus=${setup.renderer.currentFocusedRenderable?.id}\n${setup.captureCharFrame()}\n${error}`,
        );
      });
    await enterLive(setup, "source-view-tab-settings");
    await enterLive(setup, "source-command-config");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-source-browser"));
    await parsedEscape(setup);
    await setup
      .waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-command-config")
      .catch((error) => {
        throw new Error(
          `Config Back focus=${setup.renderer.currentFocusedRenderable?.id}\n${setup.captureCharFrame()}\n${error}`,
        );
      });
    expect(setup.renderer.root.findDescendantById("source-metadata")).toBeDefined();
    await enterLive(setup, "source-view-tab-installed");
    await enterLive(setup, "source-installed-skills");
    await waitForReaderBody(setup, "Installed team-main/reference");
    expect(mounted.sideEffects).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test("Collection arrows stay in the current control and resize preserves checked targets", async () => {
  const mounted = await mount(144, 40);
  const { setup } = mounted;
  try {
    await selectTeam(setup);
    const browser = await focusLive(setup, "collection-browser");
    for (const direction of ["up", "left", "right"] as const) {
      setup.mockInput.pressArrow(direction);
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable === browser).toBe(true);
    }
    await selectTeam(setup);
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
    await setup.mockInput.typeText(" ");
    for (const [width, height] of [
      [43, 13],
      [144, 40],
    ]) {
      setup.resize(width!, height!);
      await setup.flush();
      const focus = setup.renderer.currentFocusedRenderable;
      expect(focus?.isDestroyed).toBe(false);
      expect(focus?.height).toBeGreaterThan(0);
      expect(focus!.screenY + focus!.height).toBeLessThanOrEqual(height! - 1);
    }
    await enterLive(setup, "collection-browser");
    expect(setup.captureCharFrame()).toContain("1 items checked");
    expect(mounted.sideEffects).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test("unavailable Collections offer Problems rather than claiming an empty library", async () => {
  const base = collectionsSourcesProjection();
  const diagnostic = {
    severity: "warning" as const,
    code: "CONFIG_INVALID",
    message: "Invalid collection declaration",
    location: { file: "/workspace/skctl/skctl.jsonc" },
  };
  const mounted = await mount(43, 13, {
    ...base,
    diagnostics: [diagnostic],
    effective: {
      status: "unavailable",
      reasons: [diagnostic],
      sources: [],
      collections: [],
      agent: base.effective.agent,
    },
  });
  const { setup } = mounted;
  try {
    await openMainPage(setup, "collections");
    expect(setup.captureCharFrame()).not.toContain("No Collections yet");
    await enterLive(setup, "collections-open-problems");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("problems-browser"));
    expect(mounted.sideEffects).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test("empty Source exposes install and Source settings without silently entering Updates", async () => {
  const projection = collectionsSourcesProjection();
  const mounted = await mount(43, 13, { ...projection, installedSkills: [] });
  const { setup } = mounted;
  try {
    await openMainPage(setup, "sources");
    await enterLive(setup, "source-browser");
    expect(setup.renderer.root.findDescendantById("source-updates-browser")).toBeUndefined();
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("workspace-action-add-skills"),
    );
    const install = setup.renderer.root.findDescendantById("workspace-action-add-skills")!;
    expect(install.screenY).toBe(3);
    expect(install.screenY + install.height).toBeLessThanOrEqual(12);
    await enterLive(setup, "source-view-tab-settings");
    expect(setup.renderer.root.findDescendantById("source-metadata")).toBeDefined();
    expect(mounted.sideEffects).toEqual([]);
    expect(mounted.checks).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test("explicit Source check retains its precise Source while browsing is read-only", async () => {
  const mounted = await mount(144, 40);
  const { setup } = mounted;
  try {
    await openMainPage(setup, "sources");
    const prior = mounted.checks.length;
    await enterLive(setup, "workspace-action-check-updates");
    await setup.waitFor(() => mounted.checks.length > prior);
    expect(mounted.checks.slice(prior)).toEqual(["team-main"]);
    expect(mounted.sideEffects).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test("Collection description retains purpose without gating members", async () => {
  const mounted = await mount(43, 13);
  const { setup } = mounted;
  try {
    const startupReads = [...mounted.reads];
    await selectTeam(setup);
    await enterLive(setup, "collection-browser");
    expect(setup.renderer.root.findDescendantById("collection-relationships")).toBeDefined();
    await enterLive(setup, "collection-tabs-tab-description");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-description"));
    expect(setup.captureCharFrame()).toContain("Review and write with the team.");
    await enterLive(setup, "collection-tabs-tab-members");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-relationships"));
    expect(mounted.reads).toEqual(startupReads);
    expect(mounted.sideEffects).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test("changing Membership origin keeps visible command order instead of landing on Back", async () => {
  const base = collectionsSourcesProjection();
  if (base.effective.status !== "complete") throw new Error("Expected complete fixture");
  const collection = base.effective.collectionsView[0]!;
  const member = collection.members[0]!;
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: [
        {
          ...collection,
          members: [
            {
              ...member,
              paths: [
                ...member.paths,
                {
                  kind: "repository-derived" as const,
                  repository: "acme/repo",
                  source: "team-main",
                  path: "guide",
                },
              ],
            },
            ...collection.members.slice(1),
          ],
        },
        ...base.effective.collectionsView.slice(1),
      ],
    },
  };
  const mounted = await mount(100, 24, projection);
  const { setup } = mounted;
  try {
    await selectTeam(setup);
    await enterLive(setup, "collection-browser");
    await enterLive(setup, "collection-more");
    await enterLive(setup, "collection-current-details");
    const origins = await focusLive(setup, "collection-membership-origin");
    for (const direction of ["down", "up", "down"] as const) {
      setup.mockInput.pressArrow(direction);
      await setup.flush();
      await parsedEnter(setup);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(
        direction === "up" ? "membership.open-owner" : "membership.open-source",
      );
      await focusLive(setup, origins.id);
    }
    expect(mounted.sideEffects).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test("Source settings fields are reachable by Tab and restore their scrolled viewport after switching views", async () => {
  const base = collectionsSourcesProjection();
  const projection = {
    ...base,
    installedSkills: [],
    effective: {
      ...base.effective,
      sources: base.effective.sources.map((source, index) =>
        index
          ? source
          : {
              ...source,
              origin: `https://example.test/${"long-origin/".repeat(30)}`,
              root: "long-root/".repeat(20),
            },
      ),
    },
  };
  const mounted = await mount(80, 16, projection);
  const { setup } = mounted;
  const tabTo = async (id: string) => {
    for (let index = 0; index < 12 && setup.renderer.currentFocusedRenderable?.id !== id; index++) {
      setup.mockInput.pressTab();
      await setup.flush();
    }
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(id);
  };
  try {
    await openMainPage(setup, "sources");
    await enterLive(setup, "source-browser");
    await tabTo("source-view-tab-installed");
    setup.mockInput.pressArrow("right");
    await setup.flush();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-metadata"));
    await tabTo("source-metadata");
    const metadata = setup.renderer.currentFocusedRenderable as ScrollBoxRenderable;
    for (let index = 0; index < 6; index++) {
      setup.mockInput.pressArrow("down");
      await setup.flush();
    }
    const saved = metadata.scrollTop;
    expect(saved).toBeGreaterThan(0);
    await enterLive(setup, "source-view-tab-installed");
    await enterLive(setup, "source-view-tab-settings");
    await tabTo("source-metadata");
    expect((setup.renderer.currentFocusedRenderable as ScrollBoxRenderable).scrollTop).toBe(saved);
    expect(mounted.sideEffects).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test("Collection selective filter clear preserves the other condition, query and checked origins", async () => {
  const mounted = await mount(100, 24);
  const { setup } = mounted;
  const choose = async (id: string, value: string) => {
    const list = (await focusLive(setup, id)) as SelectRenderable;
    const index = list.options.findIndex((option) => option.value === value);
    expect(index).toBeGreaterThanOrEqual(0);
    list.setSelectedIndex(index);
    await parsedEnter(setup);
  };
  try {
    await selectTeam(setup);
    await enterLive(setup, "collection-browser");
    await setup.mockInput.typeText(" ");
    await focusLive(setup, "collections-query");
    await setup.mockInput.typeText("team");
    for (const [dimension, value] of [
      ["Config", "project"],
      ["Problems", "No problems"],
    ]) {
      await enterLive(setup, "collections-filter");
      await choose("collections-filter-dimensions", dimension!);
      await choose("collections-filter-values", value!);
    }
    await enterLive(setup, "collections-filter");
    await choose("collections-filter-dimensions", "Config");
    const values = setup.renderer.root.findDescendantById(
      "collections-filter-values",
    ) as SelectRenderable;
    expect(values.options.find((option) => option.value === "project")?.name).toContain("✓");
    await choose("collections-filter-values", "");
    expect(
      (setup.renderer.root.findDescendantById("collections-query") as InputRenderable).value,
    ).toBe("team");
    expect(setup.captureCharFrame()).toContain("Filter 1");
    await enterLive(setup, "collection-browser");
    expect(setup.captureCharFrame()).toContain("1 items checked");
    expect(mounted.sideEffects).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test("ordinary member-row click then Reader Back restores table focus and a non-first Collection", async () => {
  const base = collectionsSourcesProjection();
  if (base.effective.status !== "complete") throw new Error("Expected complete fixture");
  const mounted = await mount(144, 40, {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: [...base.effective.collectionsView].sort((a, b) => a.id.localeCompare(b.id)),
    },
  });
  const { setup } = mounted;
  try {
    const startupReads = [...mounted.reads];
    const browser = await selectTeam(setup);
    const row = setup.renderer.root.findDescendantById(
      "collection-relationships-row-guide%3A0:cell-name",
    )!;
    await setup.mockMouse.click(row.screenX + 1, row.screenY);
    expect(mounted.reads).toEqual(startupReads);
    await parsedEnter(setup);
    await waitForReaderBody(setup, "Installed team-main/guide");
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
    const returned = setup.renderer.root.findDescendantById(browser.id) as ScrollBoxRenderable;
    expect(returned.viewport.height).toBeGreaterThan(0);
    await setup.waitForFrame((frame) => frame.includes("team"));
    setup.mockInput.pressArrow("down");
    await setup.flush();
    setup.mockInput.pressArrow("down");
    await setup.flush();
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("docs"));
    expect(mounted.sideEffects).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
