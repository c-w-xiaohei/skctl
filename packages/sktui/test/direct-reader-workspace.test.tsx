import { afterEach, expect, test } from "bun:test";
import {
  CodeRenderable,
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { App } from "../src/app";
import { SkctlError, type WorkspaceView } from "@skctl/core";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import {
  enterLive,
  focusLive,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  parsedEscape,
  selectedReaderTab,
} from "./reader-test-controls";
let setup: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});
async function settleHighlighting(node: BaseRenderable): Promise<void> {
  if (node instanceof CodeRenderable) await node.highlightingDone;
  for (const child of node.getChildren()) await settleHighlighting(child);
}
async function waitForBody(text: string) {
  const contains = (node: BaseRenderable): boolean =>
    (node instanceof CodeRenderable && node.plainText.includes(text)) ||
    node.getChildren().some(contains);
  await setup!.waitFor(() => contains(setup!.renderer.root));
  await setup!.renderOnce();
  await settleHighlighting(setup!.renderer.root);
  await setup!.renderOnce();
  expect(setup!.captureCharFrame()).toContain(text);
}
async function mount(
  width = 144,
  height = 40,
  projection = readerProjection(),
  hooks: Parameters<typeof directSourceCore>[1] = {},
) {
  const reads: string[] = [];
  setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, {
          ...hooks,
          loadInstalledSkill: async (
            _environment: import("@skctl/core").CoreOptions,
            request,
            options,
          ) => {
            const { address } = request;
            reads.push(address.path);
            if (hooks.loadInstalledSkill)
              return hooks.loadInstalledSkill(_environment, request, options);
            return {
              address,
              name: address.path,
              description: "",
              markdownText: `# ${address.path}\n\nBody of ${address.path}\n\n${Array.from({ length: 80 }, (_, index) => `Line ${index}`).join("\n\n")}`,
              rawText: `Body of ${address.path}`,
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width, height },
  );
  await openAllInstalledSkills(setup);
  await focusLive(setup, "installed-skill-browser");
  await settleHighlighting(setup.renderer.root);
  await setup.renderOnce();
  return reads;
}
async function capture(name: string) {
  const root = process.env.QUIET_UPDATE_CAPTURE_DIR;
  if (!root || !setup) return;
  await setup.renderOnce();
  await mkdir(root, { recursive: true });
  await writeFile(join(root, `${name}.txt`), setup.captureCharFrame());
  await writeFile(join(root, `${name}.json`), JSON.stringify(setup.captureSpans(), null, 2));
}
async function executeReaderAction(id: string, search: string) {
  setup!.mockInput.pressKey("p", { ctrl: true });
  await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "palette-choices");
  await setup!.mockInput.typeText("/");
  await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "palette-query");
  await setup!.mockInput.typeText(search);
  await parsedEnter(setup!);
  const choices = (await focusLive(setup!, "palette-choices")) as SelectRenderable;
  const index = choices.options.findIndex((option) => option.value.id === id);
  expect(index, `Actions search must expose ${id}`).toBeGreaterThanOrEqual(0);
  choices.setSelectedIndex(index);
  await setup!.renderOnce();
  const record = choices.getSelectedOption()!.value;
  expect(record.id).toBe(id);
  expect(record.enabled).toBe(true);
  await parsedEnter(setup!);
  await setup!.waitFor(() => !setup!.renderer.root.findDescendantById("palette-choices"));
  return record;
}
test("wide list selection displays installed body without an Inspector or activation", async () => {
  const mutations: string[] = [];
  const reads = await mount(144, 40, readerProjection(), {
    discoverSkills: async () => {
      mutations.push("discover");
      throw new Error("Reader must not acquire provider content");
    },
    installSkills: async () => {
      mutations.push("install");
      return { value: [], diagnostics: [] };
    },
    updateSkills: async () => {
      mutations.push("update");
      return { value: undefined, diagnostics: [] };
    },
  });
  await setup!.waitForFrame((frame) => frame.includes("Body of guide"));
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
  expect(setup!.renderer.root.findDescendantById("skill-inspector")).toBeUndefined();
  expect(setup!.renderer.root.findDescendantById("skill-preview-open")).toBeUndefined();
  setup!.mockInput.pressArrow("down");
  await waitForBody("Body of reference");
  expect(reads).toEqual(["guide", "reference"]);
  expect(mutations).toEqual([]);
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
  await capture("direct-reader-browse-144x40");
});
test("failed B reads and retries stay B while the list remains usable", async () => {
  let attempts = 0;
  const reads = await mount(144, 40, readerProjection(), {
    loadInstalledSkill: async (_environment: import("@skctl/core").CoreOptions, { address }) => {
      if (address.path === "reference" && ++attempts === 1)
        throw new SkctlError("RESOURCE_NOT_FOUND", "B instructions missing");
      return {
        address,
        name: address.path,
        description: "",
        markdownText: `Body of ${address.path}`,
        rawText: `Body of ${address.path}`,
      };
    },
  });
  await waitForBody("Body of guide");
  expect(reads).toEqual(["guide"]);
  setup!.mockInput.pressArrow("down");
  await setup!.waitFor(() => reads.includes("reference"));
  expect(attempts).toBe(1);
  try {
    await setup!.waitForFrame((frame) => frame.includes("B instructions missing"));
  } catch (error) {
    console.error("Failed B read did not render", {
      reads,
      attempts,
      focus: setup!.renderer.currentFocusedRenderable?.id,
      frame: setup!.captureCharFrame(),
    });
    throw error;
  }
  expect(setup!.captureCharFrame()).not.toContain("Body of guide");
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
  await capture("direct-reader-error-144x40");
  await parsedEnter(setup!);
  await focusLive(setup!, "reader-content-retry");
  await parsedEnter(setup!);
  await setup!.waitForFrame((frame) => frame.includes("Body of reference"));
  expect(reads).toEqual(["guide", "reference", "reference"]);
});
test("an empty filter has no hidden current-object action and Escape returns from query to list area", async () => {
  const reads = await mount();
  await focusLive(setup!, "skills-query");
  await setup!.mockInput.typeText("no-such-installed-skill");
  await setup!.waitForFrame((frame) => frame.includes("No matching Skills"));
  expect(
    setup!.renderer.root.findDescendantById("reader-action-skill-add-to-collection"),
  ).toBeUndefined();
  expect(
    setup!.renderer.root.findDescendantById("reader-details-action-skill-add-to-collection"),
  ).toBeUndefined();
  expect(
    setup!.renderer.root.findDescendantById("reader-action-skill-check-updates"),
  ).toBeUndefined();
  expect(setup!.captureCharFrame()).not.toContain("Body of guide");
  expect(reads).toEqual(["guide"]);
  await capture("direct-reader-empty-144x40");
  await parsedEscape(setup!);
  expect(setup!.renderer.currentFocusedRenderable?.id).not.toBe("reader-scrollbox");
});
test("same-list A-B-A restores body position and default body, resize preserves the active tab and checked set", async () => {
  const reads = await mount();
  await parsedEnter(setup!);
  await new Promise<void>((resolve) => {
    const listener = (event: { readonly name: string }) => {
      if (event.name !== "pagedown" && event.name !== "page-down") return;
      setup!.renderer.keyInput.off("keypress", listener);
      resolve();
    };
    setup!.renderer.keyInput.prependListener("keypress", listener);
    setup!.mockInput.pressKey("\x1b[6~");
  });
  await setup!.renderOnce();
  const body = setup!.renderer.root.findDescendantById("reader-scrollbox") as ScrollBoxRenderable;
  const scroll = body.scrollTop;
  expect(scroll).toBeGreaterThan(0);
  await openReaderTab(setup!, 2);
  await parsedEscape(setup!);
  await setup!.mockInput.typeText(" ");
  setup!.mockInput.pressArrow("down");
  await waitForBody("Body of reference");
  setup!.mockInput.pressArrow("up");
  await setup!.waitFor(() => selectedReaderTab(setup!) === 0);
  await setup!.renderOnce();
  expect(
    (setup!.renderer.root.findDescendantById("reader-scrollbox") as ScrollBoxRenderable).scrollTop,
  ).toBe(scroll);
  expect(reads).toEqual(["guide", "reference"]);
  const browser = setup!.renderer.root.findDescendantById(
    "installed-skill-browser",
  ) as SelectRenderable;
  expect(browser.getSelectedOption()?.name).toContain("✓");
  await parsedEnter(setup!);
  await openReaderTab(setup!, 1);
  setup!.resize(43, 13);
  await setup!.renderOnce();
  expect(selectedReaderTab(setup!)).toBe(1);
  setup!.resize(144, 40);
  await setup!.renderOnce();
  expect(setup!.renderer.root.findDescendantById("installed-skill-browser")).toBe(browser);
  expect(browser.getSelectedOption()?.name).toContain("✓");
  expect(selectedReaderTab(setup!)).toBe(1);
});
test.each([1, 2] as const)(
  "filter-driven object changes from tab %i show the new object's body",
  async (tab) => {
    await mount();
    await parsedEnter(setup!);
    await openReaderTab(setup!, tab);
    await focusLive(setup!, "skills-query");
    await setup!.mockInput.typeText("reference");
    await waitForBody("Body of reference");
    expect(selectedReaderTab(setup!)).toBe(0);
    expect((setup!.renderer.root.findDescendantById("skills-query") as InputRenderable).value).toBe(
      "reference",
    );
  },
);
test("explicit installed Reload refreshes Local instructions and an already-active Resources list without a remote check", async () => {
  let version = 0;
  let workspaceReads = 0;
  let checks = 0;
  const resourceReads: string[] = [];
  const snapshot = readerProjection();
  const projection = {
    ...snapshot,
    installedSkills: snapshot.installedSkills.map((skill) => ({
      ...skill,
      owner: { ...skill.owner, relevantLocalRoot: "/workspace/local-skills" },
    })),
  };
  const reads = await mount(144, 40, projection, {
    getWorkspace: async () => {
      workspaceReads++;
      return { value: projection, diagnostics: [] };
    },
    checkUpdate: async () => {
      checks++;
      throw new Error("Unexpected remote check from Reader");
    },
    loadInstalledSkill: async (_environment: import("@skctl/core").CoreOptions, { address }) => ({
      address,
      name: address.path,
      description: "",
      markdownText: `Installed version ${version}`,
      rawText: `Installed version ${version}`,
    }),
    listInstalledResources: async (
      _environment: import("@skctl/core").CoreOptions,
      { address },
    ) => {
      resourceReads.push(`${address.path}:v${version}`);
      return [{ kind: "file", path: `v${version}.md` }];
    },
  });
  await parsedEnter(setup!);
  await openReaderTab(setup!, 1);
  await setup!.waitForFrame((frame) => frame.includes("v0.md"));
  await openReaderTab(setup!, 2);
  const beforeChecks = checks;
  version = 1;
  await enterLive(setup!, "reader-reload");
  await setup!.waitFor(() => reads.length === 2);
  expect(selectedReaderTab(setup!)).toBe(2);
  expect(resourceReads).toEqual(["guide:v0"]);
  expect(reads).toEqual(["guide", "guide"]);
  expect(workspaceReads).toBe(1);
  expect(checks).toBe(beforeChecks);
  await openReaderTab(setup!, 1);
  await setup!.waitFor(() => resourceReads.includes("guide:v1"));
  await setup!.waitForFrame((frame) => frame.includes("v1.md"));
  expect(resourceReads).toEqual(["guide:v0", "guide:v1"]);
  await openReaderTab(setup!, 0);
  await waitForBody("Installed version 1");
});
test("Back after a remote update restores Resources with current payloads and a live list focus", async () => {
  let snapshot = readerProjection();
  let version = 0;
  const revision = "d".repeat(40);
  const address = snapshot.installedSkills[0]!.address;
  const mutations: unknown[] = [];
  const resources: number[] = [];
  const reads = await mount(144, 40, snapshot, {
    getWorkspace: async () => ({ value: snapshot, diagnostics: [] }),
    getUpdateBaseline: async () => ({ value: "reader-baseline", diagnostics: [] }),
    checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => ({
      value: {
        source,
        kind: "github",
        exactRevision: revision,
        baseline: "reader-baseline",
        changed: [{ path: address.path, name: "guide", description: "" }],
        unchanged: [],
        removed: [],
        added: [],
      },
      diagnostics: [],
    }),
    updateSkills: async (_environment: import("@skctl/core").CoreOptions, request) => {
      mutations.push(request);
      version = 1;
      snapshot = {
        ...snapshot,
        installedSkills: snapshot.installedSkills.map((skill) => ({
          ...skill,
          owner: { ...skill.owner, relevantRemoteRevision: revision },
        })),
      };
      return { value: undefined, diagnostics: [] };
    },
    loadInstalledSkill: async (_environment: import("@skctl/core").CoreOptions, { address }) => ({
      address,
      name: address.path,
      description: "",
      markdownText: `Installed version ${version}`,
      rawText: `Installed version ${version}`,
    }),
    listInstalledResources: async () => {
      resources.push(version);
      return [{ kind: "file", path: `v${version}.txt` }];
    },
    readInstalledResource: async (_environment: import("@skctl/core").CoreOptions, { path }) => ({
      kind: "text",
      path,
      format: "text",
      text: "Old resource content",
    }),
  });
  await parsedEnter(setup!);
  await openReaderTab(setup!, 1);
  await enterLive(setup!, "resource-browser");
  await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "resource-content");
  setup!.mockInput.pressKey("p", { ctrl: true });
  await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "palette-choices");
  const choices = setup!.renderer.root.findDescendantById("palette-choices") as SelectRenderable;
  const index = choices.options.findIndex((option) => option.value.id === "skill-check-updates");
  expect(index).toBeGreaterThanOrEqual(0);
  choices.setSelectedIndex(index);
  await parsedEnter(setup!);
  await setup!.waitFor(() => !!setup!.renderer.root.findDescendantById("updates-browser"));
  expect(mutations).toEqual([]);
  await enterLive(setup!, "updates-browser");
  await setup!.waitFor(() => !!setup!.renderer.root.findDescendantById("source-updates-browser"));
  await enterLive(setup!, "source-updates-update-all");
  await setup!.waitForFrame((frame) => frame.includes("Updated 1 Skill"), { maxPasses: 200 });
  expect(mutations).toHaveLength(1);
  expect(mutations[0]).toMatchObject({
    source: address.source,
    paths: [address.path],
    exactRevision: revision,
  });
  await enterLive(setup!, "route-back");
  await setup!.waitFor(() => !!setup!.renderer.root.findDescendantById("updates-browser"));
  await enterLive(setup!, "route-back");
  await setup!.waitForFrame((frame) => frame.includes("v1.txt"));
  expect(selectedReaderTab(setup!)).toBe(1);
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("reader-resources-status");
  setup!.mockInput.pressArrow("down");
  await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "resource-browser");
  expect(setup!.renderer.root.findDescendantById("resource-content")?.id).toBeUndefined();
  expect(setup!.captureCharFrame()).not.toContain("Old resource content");
  expect(resources).toEqual([0, 1]);
  expect(reads).toEqual(["guide", "guide"]);
  await openReaderTab(setup!, 0);
  await waitForBody("Installed version 1");
});
test("Collection dispatch uses only current B or explicitly checked A/C, including hidden targets", async () => {
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("Expected a complete Reader fixture");
  const template = base.installedSkills[0]!;
  const addresses = ["a", "b", "c"].map((path) => ({ source: "team-main", path }));
  const owner = {
    level: "project" as const,
    file: "/workspace/skctl/skctl.jsonc",
    pointer: "/collections/target",
  };
  const projection: WorkspaceView = {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "project"
        ? { ...config, direct: { ...config.direct, collections: [{ id: "target", owner }] } }
        : config,
    ),
    effective: {
      ...base.effective,
      status: "complete",
      collections: ["target"],
      collectionsView: [
        {
          id: "target",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
    installedSkills: addresses.map((address) => ({ ...template, address, name: address.path })),
  };
  const previews: unknown[] = [];
  const changes: unknown[] = [];
  await mount(144, 40, projection, {
    previewMembershipBatch: async (
      _environment: import("@skctl/core").CoreOptions,
      request,
      options,
    ) => {
      previews.push(request.additions.map((item) => item.address));
      void options;
      return {
        value: {
          kind: "membership-batch",
          collection: request.collection,
          decision: { kind: "direct", owner },
          additions: request.additions,
          removals: request.removals,
          affected: [],
          blockers: [],
          effectful: true,
          allowed: true,
        },
        diagnostics: [],
      };
    },
    editMembers: async (_environment: import("@skctl/core").CoreOptions, request) => {
      changes.push(request);
      return {
        value: { level: "project", file: "skctl.jsonc", changed: true },
        diagnostics: [],
      };
    },
  });
  await setup!.mockInput.typeText(" ");
  setup!.mockInput.pressArrow("down");
  setup!.mockInput.pressArrow("down");
  await setup!.renderOnce();
  await setup!.mockInput.typeText(" ");
  setup!.mockInput.pressArrow("up");
  await waitForBody("Body of b");
  const preview = async (id: string) => {
    await enterLive(setup!, id);
    await setup!.waitFor(
      () => !!setup!.renderer.root.findDescendantById("collection-handoff-choice"),
    );
    await enterLive(setup!, "collection-handoff-choice");
    await setup!.waitFor(
      () => !!setup!.renderer.root.findDescendantById("installed-skill-choice-submit"),
    );
    await enterLive(setup!, "installed-skill-choice-submit");
  };
  await openReaderTab(setup!, 2);
  await preview("reader-details-action-skill-add-to-collection");
  await setup!.waitFor(() => previews.length === 1);
  expect(previews[0]).toEqual([addresses[1]]);
  await setup!.waitFor(
    () =>
      changes.length === 1 && !setup!.renderer.root.findDescendantById("installed-skill-choice"),
  );
  expect(changes[0]).toMatchObject({ additions: [{ address: addresses[1] }] });
  await setup!.waitFor(() => !!setup!.renderer.root.findDescendantById("collection-detail-pane"));
  await enterLive(setup!, "route-back");
  await setup!.waitFor(() => !!setup!.renderer.root.findDescendantById("installed-skill-browser"));
  const browser = setup!.renderer.root.findDescendantById(
    "installed-skill-browser",
  ) as SelectRenderable;
  expect(
    browser.options.filter((option) => option.name.includes("✓")).map((option) => option.value),
  ).toEqual([JSON.stringify(["team-main", "a"]), JSON.stringify(["team-main", "c"])]);
  await focusLive(setup!, "skills-query");
  await setup!.mockInput.typeText("no-matches");
  await setup!.waitForFrame((frame) => frame.includes("No matching Skills"));
  expect(setup!.captureCharFrame()).toContain("Add 2 selected to Collection");
  await preview("workspace-batch-add-to-collection");
  await setup!.waitFor(() => previews.length === 2);
  expect(previews[1]).toEqual([addresses[0], addresses[2]]);
});
test("Enter enters the existing body and Escape returns to the same list row", async () => {
  await mount();
  await setup!.waitForFrame((frame) => frame.includes("Body of guide"));
  const browser = setup!.renderer.root.findDescendantById(
    "installed-skill-browser",
  ) as SelectRenderable;
  const body = setup!.renderer.root.findDescendantById("reader-scrollbox")!;
  await parsedEnter(setup!);
  expect(setup!.renderer.currentFocusedRenderable).toBe(body);
  expect(setup!.renderer.root.findDescendantById("installed-skill-browser")).toBe(browser);
  await capture("direct-reader-focused-144x40");
  await parsedEscape(setup!);
  expect(setup!.renderer.currentFocusedRenderable).toBe(browser);
  expect(browser.getSelectedOption()?.value).toBe(JSON.stringify(["team-main", "guide"]));
  expect(setup!.renderer.root.findDescendantById("reader-scrollbox")).toBe(body);
  await capture("direct-reader-focus-144x40");
});
test("reader Find owns text input and Escape returns to content before the list", async () => {
  await mount();
  await setup!.waitForFrame((frame) => frame.includes("Body of guide"));
  await parsedEnter(setup!);
  await setup!.mockInput.typeText("/");
  await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "reader-find");
  await setup!.mockInput.typeText("u q");
  await setup!.mockInput.pasteBracketedText(" /u q");
  expect((setup!.renderer.currentFocusedRenderable as InputRenderable).value).toBe("u q /u q");
  await parsedEscape(setup!);
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
  await parsedEscape(setup!);
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
});
test("43x13 matching Find keeps a body viewport and restores the ordinary toolbar on Escape", async () => {
  await mount(43, 13);
  await parsedEnter(setup!);
  await settleHighlighting(setup!.renderer.root);
  const body = setup!.renderer.root.findDescendantById("reader-scrollbox") as ScrollBoxRenderable;
  const bodyHeight = body.height;
  expect(setup!.renderer.root.findDescendantById("reader-find-open")).toBeUndefined();
  await executeReaderAction("reader.find", "Find");
  await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "reader-find");
  await setup!.mockInput.typeText("Line");
  await setup!.renderOnce();
  expect(body.height).toBeGreaterThanOrEqual(2);
  expect(body.height).toBe(bodyHeight - 1);
  expect(setup!.renderer.root.findDescendantById("reader-find-next")).toBeUndefined();
  expect(setup!.renderer.root.findDescendantById("reader-find")!.screenY).toBe(body.screenY - 1);
  await capture("direct-reader-find-43x13");
  await parsedEnter(setup!);
  expect(setup!.renderer.currentFocusedRenderable).toBe(body);
  await executeReaderAction("reader.find.next", "Next");
  await setup!.waitForFrame((frame) => frame.includes("2/80"));
  await parsedEscape(setup!);
  expect(body.height).toBeGreaterThanOrEqual(3);
  expect(body.height).toBe(bodyHeight);
  expect(setup!.renderer.currentFocusedRenderable).toBe(body);
  expect(
    setup!.renderer.root.findDescendantById("reader-action-skill-check-updates"),
  ).toBeDefined();
  expect(setup!.renderer.root.findDescendantById("reader-find-next")).toBeUndefined();
});
test.each([
  [100, 24],
  [80, 24],
  [43, 13],
])("direct reading stays reachable and returns at %ix%i", async (width, height) => {
  await mount(width, height);
  if (width < 100) await parsedEnter(setup!);
  await settleHighlighting(setup!.renderer.root);
  await setup!.renderOnce();
  await setup!.waitForFrame((frame) => frame.includes("Body of guide"));
  const body = setup!.renderer.root.findDescendantById("reader-scrollbox") as ScrollBoxRenderable;
  expect(body.height).toBeGreaterThanOrEqual(2);
  await capture(`direct-reader-${width}x${height}`);
  await focusLive(setup!, "reader-scrollbox");
  await parsedEscape(setup!);
  expect(setup!.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
});
test.each([
  [144, 40],
  [100, 24],
  [80, 24],
  [43, 13],
])(
  "long names and empty instructions retain controls and body space at %ix%i",
  async (width, height) => {
    const base = readerProjection();
    await mount(
      width,
      height,
      {
        ...base,
        installedSkills: base.installedSkills.map((skill) => ({
          ...skill,
          name: "很长的技能名称-e\u0301-\u{1f680}-with-extra-context-for-clipping",
        })),
      },
      {
        loadInstalledSkill: async (
          _environment: import("@skctl/core").CoreOptions,
          { address },
        ) => ({
          address,
          name: address.path,
          description: "",
          markdownText: "",
          rawText: "",
        }),
      },
    );
    await parsedEnter(setup!);
    await setup!.waitFor(
      () => !!setup!.renderer.root.findDescendantById("reader-action-skill-check-updates"),
    );
    await setup!.flush();
    const body = setup!.renderer.root.findDescendantById("reader-scrollbox") as ScrollBoxRenderable;
    const pane = setup!.renderer.root.findDescendantById("skill-reader-pane")!;
    const raw = setup!.renderer.root.findDescendantById("reader-raw");
    const update = setup!.renderer.root.findDescendantById("reader-action-skill-check-updates")!;
    expect(update.screenX).toBeGreaterThan(pane.screenX);
    expect(update.screenX + update.width).toBeLessThanOrEqual(pane.screenX + pane.width - 1);
    expect(setup!.captureCharFrame().split("\n")[update.screenY]).toContain("Check updates");
    expect(body.height).toBeGreaterThanOrEqual(3);
    if (raw) expect(raw.screenX + raw.width).toBeLessThanOrEqual(pane.screenX + pane.width);
    else {
      expect(width).toBe(43);
      expect((await executeReaderAction("reader.raw", "Raw")).verb).toBe("Raw");
      expect((await executeReaderAction("reader.raw", "Prose")).verb).toBe("Prose");
      expect(setup!.renderer.root.findDescendantById("reader-scrollbox")).toBe(body);
      expect(body.height).toBeGreaterThanOrEqual(3);
    }
    const identity = setup!.renderer.root.findDescendantById("reader-identity") as TextRenderable;
    expect(identity.plainText).toStartWith("很长");
    expect(Bun.stringWidth(identity.plainText)).toBeLessThanOrEqual(identity.width);
    expect(setup!.captureCharFrame()).not.toContain("Loading SKILL.md");
    expect(setup!.renderer.currentFocusedRenderable).toBe(body);
    await capture(`direct-reader-long-empty-${width}x${height}`);
    await openReaderTab(setup!, 2);
    const summary = setup!.renderer.root.findDescendantById("reader-details-summary")!;
    const text = (node: BaseRenderable): string =>
      node instanceof TextRenderable ? node.plainText : node.getChildren().map(text).join("\n");
    const fullName = "很长的技能名称-e\u0301-\u{1f680}-with-extra-context-for-clipping";
    if (identity.plainText !== fullName) {
      await setup!.waitFor(() => text(summary).includes(`Name\n${fullName}`));
      expect(text(summary)).toContain(`Name\n${fullName}`);
    } else {
      expect(identity.plainText).toBe(fullName);
    }
  },
);
