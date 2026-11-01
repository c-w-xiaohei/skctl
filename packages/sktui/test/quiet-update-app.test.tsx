/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import {
  BoxRenderable,
  DiffRenderable,
  InputRenderable,
  SelectRenderable,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import { ButtonRenderable } from "@tuiparts/core/button";
import { SkctlError, type WorkspaceView } from "@skctl/core";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { UpdatesPage } from "../src/updates/page";
import { deriveUpdateScope as buildUpdateScope } from "../src/updates/scope";
import { createUpdatesState } from "../src/updates/state";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import {
  enterLive,
  focusLive,
  openAllInstalledSkills,
  openReaderTab,
  openReaderSettings,
  parsedEnter,
  parsedEscape,
  selectedReaderTab,
} from "./reader-test-controls";
const revision = "d".repeat(40);
function fixture(count = 3) {
  const base = workspaceProjection({ includeContribution: false });
  const sources = ["team-main", "other"].map((id) => ({ ...base.effective.sources[0]!, id }));
  return {
    ...base,
    effective: { ...base.effective, sources },
    installedSkills: sources.flatMap((source) =>
      Array.from(
        { length: count },
        (_, index) => ["Research", "Audit", "Writing"][index] ?? `Skill ${index}`,
      ).map((name, index) => ({
        address: { source: source.id, path: `skill-${index}` },
        name,
        description: `${name} Skill`,
        owner: { source: source.id, health: "healthy" as const },
        source,
        collections: [],
        selectors: [],
        selectorViews: { status: "complete" as const, values: [] },
        aliases: [],
        problems: [],
      })),
    ),
  };
}
type Setup = Awaited<ReturnType<typeof testRender>>;
async function mount(
  width = 80,
  height = 24,
  pending: boolean | "other" = false,
  skillScope = false,
  count = 3,
  updateFailure?: SkctlError,
) {
  await mkdir("/tmp/opencode", { recursive: true });
  const cache = await mkdtemp("/tmp/opencode/quiet-update-app-");
  const prior = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
  process.env.SKTUI_UPDATE_SCHEDULE_DIR = cache;
  const projection = fixture(count);
  let currentProjection: WorkspaceView = projection;
  const loaded: {
    source: string;
    path: string;
  }[] = [];
  const acquisitions: string[] = [];
  const calls: {
    source: string;
    paths: readonly string[];
    exactRevision?: string;
    expectedBaseline?: string;
  }[] = [];
  const checks: string[] = [];
  const previews: {
    source: string;
    path: string;
    exactRevision?: string;
    expectedBaseline: string;
  }[] = [];
  let updateSignal: AbortSignal | undefined;
  let settle!: () => void;
  const core = directSourceCore(projection, {
    getUpdateBaseline: async () => ({ value: "checked-baseline", diagnostics: [] }),
    getWorkspace: async () => ({ value: currentProjection, diagnostics: [] }),
    discoverSkills: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
      acquisitions.push(`discover:${source}`);
      throw new Error("Browsing installed content must not discover a Source");
    },
    installSkills: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
      acquisitions.push(`install:${source}`);
      throw new Error("Browsing installed content must not install a Skill");
    },
    checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
      checks.push(source);
      return {
        value: {
          source,
          kind: "github",
          exactRevision: revision,
          baseline: "checked-baseline",
          changed: projection.installedSkills
            .filter((skill) => skill.address.source === source)
            .map((skill) => ({
              path: skill.address.path,
              name: skill.name,
              description: skill.description,
            })),
          unchanged: [],
          removed: [],
          added: [],
        },
        diagnostics: [],
      };
    },
    previewUpdate: async (_environment: import("@skctl/core").CoreOptions, request) => {
      previews.push(request);
      return {
        value: {
          address: { source: request.source, path: request.path },
          status: "ready",
          targetRevision: request.exactRevision!,
          removed: false,
          files: [
            {
              path: "SKILL.md",
              status: "modified",
              content: {
                kind: "text",
                before: `Installed ${request.path}\n`,
                after: `Checked ${request.path}\n`,
              },
            },
          ],
        },
        diagnostics: [],
      };
    },
    updateSkills: async (_environment: import("@skctl/core").CoreOptions, request, options) => {
      updateSignal = options?.signal;
      calls.push(request);
      if (updateFailure) throw updateFailure;
      if (pending && request.source === (pending === "other" ? "other" : "team-main"))
        await new Promise<void>((resolve) => {
          settle = resolve;
        });
      return { value: undefined, diagnostics: [] };
    },
    loadInstalledSkill: async (_environment: import("@skctl/core").CoreOptions, { address }) => {
      loaded.push(address);
      const skill = projection.installedSkills.find(
        (skill) => skill.address.source === address.source && skill.address.path === address.path,
      )!;
      const text = `# ${skill.name}\n\nInstalled body for ${address.source}/${address.path}\n\n${Array.from({ length: 50 }, (_, index) => `Content line ${index}`).join("\n\n")}`;
      return {
        address,
        name: skill.name,
        description: skill.description,
        rawText: text,
        markdownText: text,
      };
    },
  });
  let setup: Setup | undefined;
  try {
    setup = await testRender(() => <App core={core} exit={() => {}} />, { width, height });
    await setup.waitFor(
      () =>
        !!setup!.renderer.root.findDescendantById("shell-section-tab-updates") ||
        !!setup!.renderer.root.findDescendantById("shell-pages-select"),
    );
    await openAllInstalledSkills(setup);
    await setup.waitFor(() => loaded.length === 1);
    expect(loaded).toEqual([{ source: "team-main", path: "skill-0" }]);
    if (skillScope) {
      await enterLive(setup, "installed-skill-browser");
      await enterLive(setup, "reader-action-skill-check-updates");
    } else await openMainPage(setup, "updates");
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Source") &&
        frame.includes("team-main") &&
        frame.includes("Updates available"),
      { maxPasses: 200 },
    );
    return {
      setup,
      calls,
      checks,
      previews,
      loaded,
      acquisitions,
      driftOwnership(address: { source: string; path: string }) {
        currentProjection = {
          ...currentProjection,
          installedSkills: currentProjection.installedSkills.map((skill) =>
            skill.address.source === address.source && skill.address.path === address.path
              ? { ...skill, owner: { ...skill.owner, health: "drifted" } }
              : skill,
          ),
        };
      },
      signal: () => updateSignal,
      settle: () => settle?.(),
      async dispose() {
        settle?.();
        setup!.renderer.destroy();
        if (prior === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
        else process.env.SKTUI_UPDATE_SCHEDULE_DIR = prior;
        await rm(cache, { recursive: true, force: true });
      },
    };
  } catch (error) {
    setup?.renderer.destroy();
    if (prior === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
    else process.env.SKTUI_UPDATE_SCHEDULE_DIR = prior;
    await rm(cache, { recursive: true, force: true });
    throw error;
  }
}
async function capture(setup: Setup, name: string) {
  const root = process.env.QUIET_UPDATE_CAPTURE_DIR;
  if (!root) return;
  for (let frame = 0; frame < 3; frame++) await setup.renderOnce();
  await mkdir(root, { recursive: true });
  await writeFile(join(root, `${name}.txt`), setup.captureCharFrame());
  await writeFile(join(root, `${name}.json`), JSON.stringify(setup.captureSpans(), null, 2));
}
function expectHeaderActivitySpacing(setup: Setup, width: number) {
  const status = setup.renderer.root.findDescendantById("process-status")!;
  const adjacent = setup.renderer.root.findDescendantById("shell-more-actions")!;
  expect(status.screenX - (adjacent.screenX + adjacent.width)).toBeGreaterThanOrEqual(1);
  expect(status.screenX + status.width).toBeLessThanOrEqual(width - 1);
}
test.each([
  [144, 40],
  [100, 24],
  [80, 24],
  [43, 13],
])(
  "background checking is visible in the top navigation without opening Updates at %ix%i",
  async (width, height) => {
    await mkdir("/tmp/opencode", { recursive: true });
    const cache = await mkdtemp("/tmp/opencode/footer-checking-");
    const prior = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
    process.env.SKTUI_UPDATE_SCHEDULE_DIR = cache;
    let signal: AbortSignal | undefined;
    let checks = 0;
    const projection = fixture();
    const core = directSourceCore(projection, {
      checkUpdate: async (_environment: import("@skctl/core").CoreOptions, _request, options) => {
        checks += 1;
        signal = options?.signal;
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        });
        throw new Error("This fixture only settles on cancellation");
      },
    });
    let setup: Setup | undefined;
    try {
      setup = await testRender(() => <App core={core} exit={() => {}} />, { width, height });
      await setup.waitFor(
        () => checks === 1 && !!setup!.renderer.root.findDescendantById("installed-skill-browser"),
      );
      const status = setup.renderer.root.findDescendantById("process-status") as TextRenderable;
      await setup.waitFor(() => status.plainText.includes("Checking"));
      await setup.flush();
      expectHeaderActivitySpacing(setup, width);
      expect(setup.renderer.root.findDescendantById("updates-browser")).toBeUndefined();
      expect(setup.renderer.root.findDescendantById("command-status")!.height).toBe(1);
      const header = setup.renderer.root.findDescendantById("global-bar")!;
      const footer = setup.renderer.root.findDescendantById("command-status")!;
      expect(status.screenY).toBeLessThan(header.screenY + header.height - 1);
      expect(status.screenX + status.width).toBeLessThanOrEqual(width - 1);
      expect(footer.findDescendantById("process-status")).toBeUndefined();
      for (const id of ["shell-more-actions"]) {
        const control = setup.renderer.root.findDescendantById(id)!;
        expect(control.screenX + control.width).toBeLessThanOrEqual(width - 1);
        expect(
          status.screenX + status.width <= control.screenX ||
            status.screenX >= control.screenX + control.width,
        ).toBe(true);
      }
      expect(signal?.aborted).toBe(false);
      expect(checks).toBe(1);
      await capture(setup, `top-checking-${width}x${height}`);
      await focusLive(setup, "installed-skill-browser");
      await chooseAction(setup, "checks.task.show");
      await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("updates-browser"));
      expect(checks).toBe(1);
      expect(signal?.aborted).toBe(false);
      await openSection(setup, "sources");
      await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("source-browser"));
      await focusLive(setup, "source-browser");
      await chooseAction(setup, "checks.task.stop");
      await setup.waitFor(() => signal?.aborted === true && !status.plainText.includes("Checking"));
      await openSection(setup, "updates");
      await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("updates-browser"));
      expect(checks).toBe(1);
      await focusLive(setup, "updates-browser");
      await setup.mockInput.typeText("r");
      await setup.waitFor(() => checks === 2);
      expect(signal?.aborted).toBe(false);
    } finally {
      setup?.renderer.destroy();
      if (prior === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
      else process.env.SKTUI_UPDATE_SCHEDULE_DIR = prior;
      await rm(cache, { recursive: true, force: true });
    }
  },
);
test.each([
  [120, 40],
  [80, 24],
  [43, 13],
])(
  "Source-first App keeps its table and direct all-update usable at %ix%i",
  async (width, height) => {
    const mounted = await mount(width, height);
    try {
      const { setup, calls, loaded, acquisitions } = mounted;
      const initialReads = [...loaded];
      const primary = setup.renderer.root.findDescendantById("updates-update-all")!;
      const table = setup.renderer.root.findDescendantById("updates-browser")!;
      expect(table).toBeInstanceOf(BoxRenderable);
      expect(primary).toBeInstanceOf(ButtonRenderable);
      expect(primary.screenY + primary.height).toBeLessThanOrEqual(height);
      expect(table.height).toBeGreaterThanOrEqual(height === 13 ? 4 : 2);
      const footer = setup.renderer.root.findDescendantById("command-status")!;
      expect(footer.height).toBe(1);
      expect(footer.screenY).toBe(height - 1);
      for (const id of ["updates-update-source", "updates-check"]) {
        const action = setup.renderer.root.findDescendantById(id)!;
        expect(action).toBeInstanceOf(ButtonRenderable);
        expect(action.screenY).toBe(primary.screenY);
        expect(action.screenX + action.width).toBeLessThanOrEqual(width - 1);
      }
      expect(
        setup.renderer.root.findDescendantById("updates-browser-row-team-main:cell-source"),
      ).toBeInstanceOf(TextRenderable);
      expect(
        setup.renderer.root.findDescendantById("updates-browser-row-other:cell-source"),
      ).toBeInstanceOf(TextRenderable);
      expect(
        setup.renderer.root.findDescendantById("updates-browser-row-team-main%00skill-0"),
      ).toBeUndefined();
      await capture(setup, `idle-${width}x${height}`);
      await enterLive(setup, "updates-update-all");
      await setup.waitFor(() => calls.length === 2, { maxPasses: 200 });
      expect(calls).toEqual(
        ["team-main", "other"].map((source) => ({
          source,
          paths: ["skill-0", "skill-1", "skill-2"],
          exactRevision: revision,
          expectedBaseline: "checked-baseline",
        })),
      );
      expect(loaded).toEqual(initialReads);
      expect(acquisitions).toEqual([]);
      expect(setup.renderer.root.findDescendantById("updates-review-execute")).toBeUndefined();
      expect(setup.renderer.root.findDescendantById("source-updates-submit")).toBeUndefined();
      await setup.waitForFrame((frame) => frame.includes("Updated"), { maxPasses: 200 });
      await capture(setup, `updated-${width}x${height}`);
    } finally {
      await mounted.dispose();
    }
  },
);
test("Source cursor update targets that Source without opening Skills or selecting rows", async () => {
  const mounted = await mount();
  try {
    const { setup, calls } = mounted;
    await focusLive(setup, "updates-browser");
    await setup.mockInput.typeText("u");
    await setup.waitFor(() => calls.length === 1);
    await setup.waitForFrame((frame) => frame.includes("Updated 3"));
    expect(calls[0]).toMatchObject({
      source: "team-main",
      paths: ["skill-0", "skill-1", "skill-2"],
    });
    expect(setup.renderer.root.findDescendantById("source-updates-browser")).toBeUndefined();
    const other = setup.renderer.root.findDescendantById(
      "updates-browser-row-other:cell-status",
    ) as TextRenderable;
    expect(other.plainText).not.toBe("Updated");
  } finally {
    await mounted.dispose();
  }
});
test("Source drill-down updates one Skill without selecting or marking other Skills updated", async () => {
  const mounted = await mount();
  try {
    const { setup, calls } = mounted;
    await enterLive(setup, "updates-browser");
    await focusLive(setup, "source-updates-browser");
    await setup.mockInput.typeText("u");
    await setup.waitFor(() => calls.length === 1);
    expect(calls[0]).toMatchObject({
      paths: ["skill-0"],
      exactRevision: revision,
      expectedBaseline: "checked-baseline",
    });
    await setup.waitForFrame((frame) => frame.includes("Updated 1"), { maxPasses: 200 });
    const first = setup.renderer.root.findDescendantById(
      "source-updates-browser-row-team-main%00skill-0:cell-status",
    ) as TextRenderable;
    const second = setup.renderer.root.findDescendantById(
      "source-updates-browser-row-team-main%00skill-1:cell-status",
    ) as TextRenderable;
    expect(first.plainText).toBe("Updated");
    expect(second.plainText).not.toBe("Updated");
  } finally {
    await mounted.dispose();
  }
});
test.each([
  [80, 24],
  [43, 13],
])(
  "a metadata rejection shows its failing Skill and readable recovery without hiding the table at %ix%i",
  async (width, height) => {
    const failure = new SkctlError(
      "INVALID_ARGUMENT",
      "Invalid SKILL.md at skill-0/SKILL.md: description must be a non-empty string",
      [
        {
          code: "UPDATE_NOT_APPLIED",
          severity: "warning",
          message: "Rejected before publication",
          subject: { kind: "installed-skill", address: { source: "team-main", path: "skill-0" } },
          suggestion: "Fix this Source file, then recheck updates.",
        },
      ],
    );
    const mounted = await mount(width, height, false, false, 3, failure);
    try {
      const { setup, calls } = mounted;
      await enterLive(setup, "updates-browser");
      await setup.mockInput.typeText("u");
      await setup.waitForFrame((frame) => frame.includes("Needs attention"));
      expect(calls).toHaveLength(1);
      const status = setup.renderer.root.findDescendantById(
        "source-updates-browser-row-team-main%00skill-0:cell-status",
      ) as TextRenderable;
      expect(status.plainText).toBe("Needs attention");
      expect(setup.captureCharFrame()).not.toContain("Verify result");
      expect(setup.captureCharFrame()).not.toContain("outcome needs verification");
      expect(setup.captureCharFrame()).not.toContain("description must be a non-empty string");
      const table = setup.renderer.root.findDescendantById("source-updates-browser")!;
      expect(table.height).toBeGreaterThanOrEqual(2);
      await capture(setup, `metadata-summary-${width}x${height}`);
      await setup.mockInput.typeText("d");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "source-updates-feedback-pane",
      );
      setup.mockInput.pressKey("HOME");
      await setup.waitForFrame((frame) => frame.includes("skill-0/SKILL.md"));
      setup.mockInput.pressKey("END");
      await setup.waitForFrame((frame) => frame.includes("recheck updates"));
      await capture(setup, `metadata-not-applied-${width}x${height}`);
      await parsedEscape(setup);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable === table);
      expect(calls).toHaveLength(1);
    } finally {
      await mounted.dispose();
    }
  },
);
test.each([
  [120, 40],
  [80, 24],
  [43, 13],
])(
  "ownership feedback inspects the affected Skill without retrying a mutation at %ix%i",
  async (width, height) => {
    const mounted = await mount(width, height);
    try {
      const { setup, calls, loaded, checks, acquisitions } = mounted;
      mounted.driftOwnership({ source: "team-main", path: "skill-0" });
      await focusLive(setup, "updates-browser");
      await setup.mockInput.typeText("u");
      await setup.waitFor(() => {
        const status = setup.renderer.root.findDescendantById(
          "updates-browser-row-team-main:cell-status",
        );
        return status instanceof TextRenderable && status.plainText === "Needs attention";
      });
      expect(calls).toEqual([]);
      expect(setup.captureCharFrame()).not.toContain("ownership changed or is unhealthy");
      expect(
        setup.renderer.root.findDescendantById("updates-browser")!.height,
      ).toBeGreaterThanOrEqual(2);
      await capture(setup, `ownership-summary-${width}x${height}`);
      const beforeChecks = checks.length;
      await chooseAction(setup, "updates.feedback-recover");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-details"));
      await setup.waitFor(() => selectedReaderTab(setup) === 2);
      expect(selectedReaderTab(setup)).toBe(2);
      expect(loaded).toEqual([{ source: "team-main", path: "skill-0" }]);
      expect(calls).toEqual([]);
      expect(checks).toHaveLength(beforeChecks);
      expect(acquisitions).toEqual([]);
      await parsedEscape(setup);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "updates-browser");
    } finally {
      await mounted.dispose();
    }
  },
);
test.each([
  [80, 24],
  [43, 13],
])(
  "diagnostic logs use shared Actions and keyboard guidance, then close to the initiating panel at %ix%i",
  async (width, height) => {
    const mounted = await mount(width, height);
    try {
      const { setup, calls } = mounted;
      const origin = await focusLive(setup, "updates-browser");
      await chooseAction(setup, "diagnostics.logs");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "diagnostic-log-content",
      );
      await setup.waitForFrame(
        (frame) => frame.includes("↑↓ scroll") && frame.includes("Esc close"),
      );
      await capture(setup, `diagnostic-logs-${width}x${height}`);
      setup.mockInput.pressTab();
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "diagnostic-log-close",
      );
      await setup.waitForFrame((frame) => frame.includes("Enter Close"));
      setup.mockInput.pressTab({ shift: true });
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "diagnostic-log-content",
      );
      expect(calls).toEqual([]);
      await parsedEscape(setup);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable === origin);
    } finally {
      await mounted.dispose();
    }
  },
);
test.each([
  [80, 24],
  [43, 13],
])(
  "an issue in one Source never hides Stop for another running Source at %ix%i",
  async (width, height) => {
    const mounted = await mount(width, height, "other");
    try {
      const { setup, calls } = mounted;
      mounted.driftOwnership({ source: "team-main", path: "skill-0" });
      await enterLive(setup, "updates-update-all");
      await setup.waitForFrame(
        (frame) => frame.includes("Updating") && frame.includes("Stop update"),
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]!.source).toBe("other");
      const stop = setup.renderer.root.findDescendantById("updates-stop")!;
      expect(stop.screenY + stop.height).toBeLessThanOrEqual(height - 1);
      await capture(setup, `ownership-running-${width}x${height}`);
      await focusLive(setup, "updates-browser");
      await setup.mockInput.typeText("d");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "updates-feedback-pane",
      );
      const readingStop = setup.renderer.root.findDescendantById("updates-stop")!;
      expect(readingStop.screenY + readingStop.height).toBeLessThanOrEqual(height - 1);
      await setup.mockInput.typeText("s");
      await setup.waitFor(() => mounted.signal()?.aborted === true);
      mounted.settle();
      await setup.waitFor(() => !setup.renderer.root.findDescendantById("updates-stop"));
      expect(calls).toHaveLength(1);
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
  "top navigation keeps the existing update visible when browsing another page at %ix%i",
  async (width, height) => {
    const mounted = await mount(width, height, true);
    try {
      const { setup, calls } = mounted;
      const chromeGeometry = () =>
        [
          "shell-context-panel",
          "shell-activity",
          "workarea-navigation-pane",
          "route-back-slot",
          "section-nav",
          "route-content",
        ].map((id) => {
          const node = setup.renderer.root.findDescendantById(id)!;
          return [node.screenX, node.screenY, node.width, node.height];
        });
      await setup.flush();
      const chrome = chromeGeometry();
      await enterLive(setup, "updates-update-all");
      await setup.waitFor(() => calls.length === 1);
      const status = () =>
        setup.renderer.root.findDescendantById("process-status") as TextRenderable;
      await setup.waitFor(() => status()?.plainText.includes("Updating"));
      await setup.flush();
      expect(chromeGeometry()).toEqual(chrome);
      expectHeaderActivitySpacing(setup, width);
      const header = setup.renderer.root.findDescendantById("global-bar")!;
      expect(status().screenX + status().width).toBeLessThanOrEqual(width - 1);
      expect(status().screenY).toBeLessThan(header.screenY + header.height - 1);
      expect(
        setup.renderer.root
          .findDescendantById("command-status")!
          .findDescendantById("process-status"),
      ).toBeUndefined();
      await openMainPage(setup, "sources");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
      await setup.flush();
      expect(chromeGeometry()).toEqual(chrome);
      expect(status().plainText).toContain("Updating");
      expect(mounted.signal()?.aborted).toBe(false);
      expect(calls).toHaveLength(1);
      await capture(setup, `top-updating-away-${width}x${height}`);
      if (width === 80) {
        const checks = mounted.checks.length;
        for (const [nextWidth, nextHeight] of [
          [43, 13],
          [100, 24],
          [80, 24],
        ] as const) {
          setup.resize(nextWidth, nextHeight);
          await setup.flush();
          const bar = setup.renderer.root.findDescendantById("global-bar")!;
          expect(status().screenY).toBeLessThan(bar.screenY + bar.height - 1);
          expect(status().plainText).toContain("Updating");
          expectHeaderActivitySpacing(setup, nextWidth);
          for (const id of ["shell-more-actions"]) {
            const control = setup.renderer.root.findDescendantById(id)!;
            expect(
              status().screenX + status().width <= control.screenX ||
                status().screenX >= control.screenX + control.width,
            ).toBe(true);
          }
          expect(mounted.signal()?.aborted).toBe(false);
          expect(calls).toHaveLength(1);
          expect(mounted.checks.length).toBe(checks);
        }
      }
      mounted.settle();
      await setup.waitFor(() => calls.length === 2);
      await setup.waitFor(() => status().plainText.includes("Updated"));
      await setup.flush();
      expect(chromeGeometry()).toEqual(chrome);
      expect(status().screenX + status().width).toBeLessThanOrEqual(width - 1);
      expectHeaderActivitySpacing(setup, width);
      for (const id of ["shell-more-actions"]) {
        const control = setup.renderer.root.findDescendantById(id)!;
        expect(
          status().screenX + status().width <= control.screenX ||
            status().screenX >= control.screenX + control.width,
          JSON.stringify({
            id,
            status: { x: status().screenX, width: status().width },
            control: { x: control.screenX, width: control.width },
            frame: setup.captureCharFrame(),
          }),
        ).toBe(true);
      }
      expect(
        (setup.renderer.root.findDescendantById("navigation-guidance") as TextRenderable).plainText,
      ).toContain("Ctrl+P Actions");
      expect(setup.renderer.root.findDescendantById("source-browser")).toBeDefined();
      await capture(setup, `top-updated-spaced-${width}x${height}`);
    } finally {
      await mounted.dispose();
    }
  },
);
test("current-item Button follows the Skill cursor and pointer activation submits once", async () => {
  const mounted = await mount();
  try {
    const { setup, calls } = mounted;
    await enterLive(setup, "updates-browser");
    await focusLive(setup, "source-updates-browser");
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    const button = setup.renderer.root.findDescendantById("source-updates-update-skill")!;
    await setup.mockMouse.click(button.screenX + 1, button.screenY);
    await setup.waitFor(() => calls.length === 1);
    expect(calls[0]).toMatchObject({ paths: ["skill-1"] });
  } finally {
    await mounted.dispose();
  }
});
test("quiet App preserves hidden selection, isolates text entry and keeps arrows in the table", async () => {
  const mounted = await mount();
  try {
    const { setup, calls } = mounted;
    await enterLive(setup, "updates-browser");
    const browser = await focusLive(setup, "source-updates-browser");
    await setup.mockInput.typeText(" ");
    await setup.renderOnce();
    setup.mockInput.pressKey("HOME");
    setup.mockInput.pressArrow("up");
    setup.mockInput.pressArrow("left");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable === browser).toBe(true);
    await setup.mockInput.typeText("/");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof InputRenderable);
    await setup.mockInput.typeText("Audit");
    await setup.renderOnce();
    expect(calls).toEqual([]);
    const input = setup.renderer.currentFocusedRenderable;
    setup.mockInput.pressArrow("left");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable === input).toBe(true);
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("selected") && frame.includes("hidden"));
    await enterLive(setup, "source-updates-update-all");
    await setup.waitFor(() => calls.length === 1);
    expect(calls[0]).toMatchObject({ source: "team-main", paths: ["skill-0"] });
    await capture(setup, "hidden-selection");
  } finally {
    await mounted.dispose();
  }
});
test("quiet App Tab reaches actions without walking to list boundaries; Esc only clears selection", async () => {
  const mounted = await mount();
  try {
    const { setup, calls } = mounted;
    await focusLive(setup, "updates-browser");
    await setup.mockInput.typeText(" ");
    await setup.renderOnce();
    await parsedEscape(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("updates-browser");
    expect(calls).toEqual([]);
    let reached = false;
    for (let index = 0; index < 8; index++) {
      setup.mockInput.pressTab();
      await setup.renderOnce();
      if (setup.renderer.currentFocusedRenderable?.id === "updates-update-all") {
        reached = true;
        break;
      }
    }
    expect(reached).toBe(true);
  } finally {
    await mounted.dispose();
  }
});
test.each([
  [80, 24],
  [43, 13],
])(
  "Source-first App keeps Stop and its table usable during execution at %ix%i",
  async (width, height) => {
    const mounted = await mount(width, height, true);
    try {
      const { setup, calls } = mounted;
      await enterLive(setup, "updates-update-all");
      await setup.waitForFrame((frame) => frame.includes("Updating") && frame.includes("Stop"), {
        maxPasses: 200,
      });
      expect(setup.renderer.root.findDescendantById("updates-review-execute")).toBeUndefined();
      const table = setup.renderer.root.findDescendantById("updates-browser")!;
      const stop = setup.renderer.root.findDescendantById("updates-stop")!;
      expect(table.height).toBeGreaterThanOrEqual(2);
      expect(stop.screenY + stop.height).toBeLessThanOrEqual(height);
      await capture(setup, `running-${width}x${height}`);
      await setup.mockInput.typeText("s");
      await setup.waitFor(() => mounted.signal()?.aborted === true);
      mounted.settle();
      await setup.waitFor(() => !setup.renderer.root.findDescendantById("updates-stop"));
      expect(calls).toHaveLength(1);
      expect(setup.renderer.root.findDescendantById("updates-stop")).toBeUndefined();
      const committed = setup.renderer.root.findDescendantById(
        "updates-browser-row-team-main:cell-status",
      ) as TextRenderable;
      expect(committed.plainText).toBe("Updated");
      await focusLive(setup, "updates-browser");
      setup.mockInput.pressArrow("down");
      await setup.waitForFrame((frame) => frame.includes("Not run"));
    } finally {
      await mounted.dispose();
    }
  },
);
test("Source drill-down cannot widen a Skill-scoped update to other installed Skills", async () => {
  const mounted = await mount(80, 24, false, true);
  try {
    const { setup, calls } = mounted;
    expect(calls).toEqual([]);
    await enterLive(setup, "updates-update-all");
    await setup.waitForFrame((frame) => frame.includes("Updated 1"));
    calls.length = 0;
    await enterLive(setup, "updates-browser");
    await setup.waitForFrame((frame) => frame.includes("Research"));
    expect(
      setup.renderer.root.findDescendantById("source-updates-browser-header-status"),
    ).toBeInstanceOf(TextRenderable);
    expect(
      (
        setup.renderer.root.findDescendantById(
          "source-updates-browser-row-team-main%00skill-0:cell-status",
        ) as TextRenderable
      ).plainText,
    ).toBe("Updated");
    expect(
      setup.renderer.root.findDescendantById("source-updates-browser-row-team-main%00skill-1"),
    ).toBeUndefined();
    await capture(setup, "skill-scope-source-detail");
    await enterLive(setup, "source-updates-update-all");
    await setup.waitFor(() => calls.length === 1);
    expect(calls[0]).toMatchObject({ source: "team-main", paths: ["skill-0"] });
  } finally {
    await mounted.dispose();
  }
});
test("Recheck in Source drill-down checks only that Source", async () => {
  const mounted = await mount();
  try {
    const { setup, checks } = mounted;
    await enterLive(setup, "updates-browser");
    const before = checks.length;
    await chooseAction(setup, "source-updates.check");
    await setup.waitFor(() => checks.length > before);
    expect(checks.slice(before)).toEqual(["team-main"]);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-updates-browser");
  } finally {
    await mounted.dispose();
  }
});
async function chooseAction(setup: Setup, id: string) {
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
  const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
  const index = choices.options.findIndex((option) => option.value.id === id);
  expect(index).toBeGreaterThanOrEqual(0);
  for (let row = 0; row < index; row++) setup.mockInput.pressArrow("down");
  await parsedEnter(setup);
}
async function openSection(setup: Setup, section: "skills" | "sources" | "updates") {
  await openMainPage(setup, section);
}
test.each([
  [144, 40],
  [100, 24],
])(
  "Skill Reader exposes direct native actions and Actions omits obsolete disclosure controls at %ix%i",
  async (width, height) => {
    const mounted = await mount(width, height);
    try {
      const { setup, calls, loaded, checks, acquisitions } = mounted;
      await openSection(setup, "skills");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-scrollbox"));
      const update = setup.renderer.root.findDescendantById("reader-action-skill-check-updates")!;
      expect(update).toBeInstanceOf(ButtonRenderable);
      expect(
        setup.renderer.root.findDescendantById("reader-action-skill-add-to-collection"),
      ).toBeUndefined();
      await setup.renderOnce();
      expect(setup.renderer.root.findDescendantById("skill-preview-open")).toBeUndefined();
      expect(setup.renderer.root.findDescendantById("skill-inspector")).toBeUndefined();
      await capture(setup, `operate-skill-reader-${width}x${height}`);
      await focusLive(setup, "installed-skill-browser");
      const beforeChecks = checks.length;
      setup.mockInput.pressKey("p", { ctrl: true });
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
      const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
      for (const id of ["skill.preview.actions", "skill.preview.open"])
        expect(choices.options.some((option) => option.value.id === id)).toBe(false);
      const target = choices.options.find(
        (option) => option.value.id === "skill-check-updates",
      )?.value;
      expect(target).toMatchObject({ enabled: true, destination: "Updates" });
      await capture(setup, `operate-skill-actions-${width}x${height}`);
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      expect(calls).toEqual([]);
      expect(checks).toHaveLength(beforeChecks);
      expect(loaded).toEqual([{ source: "team-main", path: "skill-0" }]);
      expect(acquisitions).toEqual([]);
      await openReaderTab(setup, 2);
      await openReaderSettings(setup);
      const add = setup.renderer.root.findDescendantById(
        "reader-details-action-skill-add-to-collection",
      )!;
      expect(add).toBeInstanceOf(ButtonRenderable);
      add.focus();
      await setup.flush();
      expect(add.screenY).toBeGreaterThan(update.screenY);
      // Checking opens review without mutation; only explicit submission updates the current Skill.
      await enterLive(setup, "reader-action-skill-check-updates");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-update-all"));
      expect(calls).toEqual([]);
      await enterLive(setup, "updates-update-all");
      await setup.waitFor(() => calls.length === 1);
      expect(calls).toEqual([
        {
          source: "team-main",
          paths: ["skill-0"],
          exactRevision: revision,
          expectedBaseline: "checked-baseline",
        },
      ]);
    } finally {
      await mounted.dispose();
    }
  },
);
test("shared filter lists apply an exact Source from a pointer row and preserve the browser on close", async () => {
  const mounted = await mount(120, 30);
  try {
    const { setup, calls } = mounted;
    await openSection(setup, "skills");
    await enterLive(setup, "open-skills-filter");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skills-filter-dimensions",
    );
    await setup.renderOnce();
    const categories = setup.renderer.root.findDescendantById(
      "skills-filter-dimensions",
    ) as SelectRenderable;
    const category = categories.options.findIndex((option) => option.value === "Source");
    expect(category).toBeGreaterThanOrEqual(0);
    await setup.mockMouse.click(categories.screenX + 2, categories.screenY + category);
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skills-filter-search",
    );
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skills-filter-values",
    );
    const values = setup.renderer.root.findDescendantById(
      "skills-filter-values",
    ) as SelectRenderable;
    const source = values.options.findIndex((option) => option.value === "other");
    expect(source).toBeGreaterThanOrEqual(0);
    await setup.mockMouse.click(values.screenX + 2, values.screenY + source);
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("skills-filter-overlay")).toBeDefined();
    await parsedEscape(setup);
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("skills-filter-overlay"));
    const browser = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    expect(browser.options).toHaveLength(3);
    expect(browser.options.every((option) => JSON.parse(option.value)[0] === "other")).toBe(true);
    expect(calls).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test.each([
  [80, 24],
  [43, 13],
])(
  "shared task Actions return to and stop the original update while another page is mounted at %ix%i",
  async (width, height) => {
    const mounted = await mount(width, height, true);
    try {
      const { setup, calls, checks } = mounted;
      await enterLive(setup, "updates-update-all");
      await setup.waitFor(() => calls.length === 1);
      const beforeChecks = checks.length;
      await openSection(setup, "sources");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
      await focusLive(setup, "source-browser");
      await chooseAction(setup, "updates.task.show");
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "updates-browser");
      expect(calls).toHaveLength(1);
      expect(checks.length).toBe(beforeChecks);
      expect(mounted.signal()?.aborted).toBe(false);
      await chooseAction(setup, "navigate.settings");
      await setup.waitFor(
        () =>
          !setup.renderer.root.findDescendantById("updates-browser") &&
          !setup.renderer.root.findDescendantById("source-browser"),
      );
      expect(mounted.signal()?.aborted).toBe(false);
      await focusLive(setup, "settings-section-tab-sources");
      await chooseAction(setup, "updates.task.stop");
      await setup.waitFor(() => mounted.signal()?.aborted === true);
      const status = setup.renderer.root.findDescendantById("process-status") as TextRenderable;
      expect(status.plainText).toContain("Stopping");
      await capture(setup, `task-stopping-away-${width}x${height}`);
      mounted.settle();
      await setup.waitFor(() => !status.plainText.includes("Stopping"));
      expect(status.plainText).toContain("Review");
      expect(calls).toHaveLength(1);
      expect(setup.renderer.root.findDescendantById("source-browser")).toBeUndefined();
      await chooseAction(setup, "updates.task.show");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
      expect(
        (
          setup.renderer.root.findDescendantById(
            "updates-browser-row-team-main:cell-status",
          ) as TextRenderable
        ).plainText,
      ).toBe("Updated");
      expect(
        (
          setup.renderer.root.findDescendantById(
            "updates-browser-row-other:cell-status",
          ) as TextRenderable
        ).plainText,
      ).toBe("Not run");
    } finally {
      await mounted.dispose();
    }
  },
);
test.each([
  [80, 24],
  [43, 13],
])(
  "shared Actions opens Source details without a page-local options menu at %ix%i",
  async (width, height) => {
    const mounted = await mount(width, height);
    try {
      const { setup, checks, calls } = mounted;
      await enterLive(setup, "updates-browser");
      await capture(setup, `source-actions-before-${width}x${height}`);
      expect(!!setup.renderer.root.findDescendantById("source-updates-more")).toBe(false);
      const before = checks.length;
      await chooseAction(setup, "source-updates.source-details");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-details-pane"));
      expect(calls).toEqual([]);
      expect(checks.length).toBe(before);
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "source-updates-browser",
      );
    } finally {
      await mounted.dispose();
    }
  },
);
test("Actions lists live update targets and disabled reasons; unavailable selection cannot mutate", async () => {
  const mounted = await mount();
  try {
    const { setup, calls } = mounted;
    await focusLive(setup, "updates-browser");
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    const current = choices.options.find(
      (option) => option.value.id === "updates.update-source",
    )!.value;
    expect(current.shortcut).toBe("u");
    expect(current.destination).toContain("team-main");
    const clearIndex = choices.options.findIndex((option) => option.value.id === "updates.clear");
    expect(clearIndex).toBeGreaterThanOrEqual(0);
    for (let row = 0; row < clearIndex; row++) setup.mockInput.pressArrow("down");
    await parsedEnter(setup);
    expect(calls).toEqual([]);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-choices");
    await setup.waitForFrame((frame) => frame.includes("No selected Skills"));
    await capture(setup, "actions-disabled-80x24");
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "updates-browser");
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    await chooseAction(setup, "updates.update-source");
    await setup.waitFor(() => calls.length === 1);
    expect(calls[0]).toMatchObject({ source: "other", paths: ["skill-0", "skill-1", "skill-2"] });
  } finally {
    await mounted.dispose();
  }
});
test.each([
  [80, 24],
  [43, 13],
])(
  "Actions search keeps typing separate from execution and runs the current Source at %ix%i",
  async (width, height) => {
    const mounted = await mount(width, height);
    try {
      const { setup, calls } = mounted;
      await focusLive(setup, "updates-browser");
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
      await enterLive(setup, "shell-more-actions");
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
      await setup.mockInput.typeText("/");
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-query");
      await setup.mockInput.typeText("Update Source");
      const choices = setup.renderer.root.findDescendantById("palette-choices") as SelectRenderable;
      await setup.waitFor(() => choices.options.length === 1);
      setup.mockInput.pressKey("u", { ctrl: true });
      await setup.renderOnce();
      expect(calls).toEqual([]);
      // Ctrl+U is an editing key here; restoring the query is still text input.
      await setup.mockInput.typeText("Update Source");
      await setup.waitFor(() => choices.options.length === 1);
      expect(choices.options[0]!.value.id).toBe("updates.update-source");
      await capture(setup, `action-search-${width}x${height}`);
      await parsedEnter(setup);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable === choices);
      expect(calls).toEqual([]);
      await parsedEnter(setup);
      await setup.waitFor(() => calls.length === 1);
      expect(calls[0]).toMatchObject({ source: "other", paths: ["skill-0", "skill-1", "skill-2"] });
    } finally {
      await mounted.dispose();
    }
  },
);
test("Actions can start filtering without a remembered slash binding, then return to the same Source", async () => {
  const mounted = await mount();
  try {
    const { setup, calls } = mounted;
    await focusLive(setup, "updates-browser");
    await chooseAction(setup, "updates.filter");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "updates-query");
    await setup.mockInput.typeText("other");
    await parsedEnter(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "updates-browser");
    await chooseAction(setup, "updates.update-source");
    await setup.waitFor(() => calls.length === 1);
    expect(calls[0]).toMatchObject({ source: "other" });
  } finally {
    await mounted.dispose();
  }
});
test.each([
  [80, 24],
  [43, 13],
])(
  "Actions removes an unmounted page's commands and restores current-object targeting on return at %ix%i",
  async (width, height) => {
    const mounted = await mount(width, height);
    try {
      const { setup, calls } = mounted;
      await focusLive(setup, "updates-browser");
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
      await chooseAction(setup, "navigate.settings");
      await setup.waitFor(() => !setup.renderer.root.findDescendantById("updates-browser"));
      await focusLive(setup, "settings-section-tab-sources");
      setup.mockInput.pressKey("p", { ctrl: true });
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
      const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
      expect(
        choices.options.some(
          (option) =>
            option.value.id.startsWith("updates.") || option.value.id.startsWith("source-updates."),
        ),
      ).toBe(false);
      expect(choices.options.some((option) => option.value.id === "diagnostics.logs")).toBe(true);
      await parsedEscape(setup);
      await chooseAction(setup, "navigate.updates");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
      await focusLive(setup, "updates-browser");
      await chooseAction(setup, "updates.update-source");
      await setup.waitFor(() => calls.length === 1);
      expect(calls[0]).toMatchObject({ source: "other", paths: ["skill-0", "skill-1", "skill-2"] });
    } finally {
      await mounted.dispose();
    }
  },
);
test("Source scan orders updates before current and unchecked results without confusing unknown with zero", async () => {
  const base = workspaceProjection({ includeContribution: false });
  const ids = ["unchecked", "already-current", "has-updates"];
  const sources = ids.map((id) => ({ ...base.effective.sources[0]!, id }));
  const skills = sources.map((source) => ({
    ...fixture().installedSkills[0]!,
    source,
    address: { source: source.id, path: "guide" },
    owner: { source: source.id, health: "healthy" as const },
  }));
  const projection = {
    ...base,
    effective: { ...base.effective, sources },
    installedSkills: skills,
  };
  const state = createUpdatesState(buildUpdateScope(projection, { kind: "workspace" }));
  const candidate = { path: "guide", name: "Guide", description: "Installed Skill" };
  state.observe({
    source: "already-current",
    kind: "github",
    exactRevision: revision,
    changed: [],
    unchanged: [candidate],
    added: [],
    removed: [],
    baseline: "baseline:test",
  });
  state.observe({
    source: "has-updates",
    kind: "github",
    exactRevision: revision,
    changed: [candidate],
    unchanged: [],
    added: [],
    removed: [],
    baseline: "baseline:test",
  });
  const submitted: unknown[] = [];
  const opened: string[] = [];
  const setup = await testRender(
    () => (
      <UpdatesPage
        state={state}
        skills={skills}
        onCheck={() => {}}
        onUpdate={(addresses) => submitted.push(addresses)}
        onStop={() => {}}
        onOpenSource={(id) => opened.push(id)}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    for (let index = 0; index < 3; index++) await setup.renderOnce();
    const cell = (source: string, column: string) =>
      setup.renderer.root.findDescendantById(
        `updates-browser-row-${source}:cell-${column}`,
      ) as TextRenderable;
    expect(cell("has-updates", "source").screenY).toBeLessThan(
      cell("already-current", "source").screenY,
    );
    expect(cell("already-current", "source").screenY).toBeLessThan(
      cell("unchecked", "source").screenY,
    );
    expect(cell("has-updates", "updates").plainText).toBe("1");
    expect(cell("already-current", "updates").plainText).toBe("0");
    expect(cell("unchecked", "updates").plainText).toBe("—");
    expect(setup.renderer.root.findDescendantById("updates-summary")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("updates-query")).toBeUndefined();
    const actions = setup.renderer.root.findDescendantById("updates-actions-pane")!;
    expect(actions.screenY).toBeGreaterThan(cell("unchecked", "source").screenY);
    const primary = setup.renderer.root.findDescendantById("updates-update-all")!;
    await capture(setup, "mixed-source-scan-120x24");
    await setup.mockMouse.click(primary.screenX + 1, primary.screenY);
    expect(submitted).toEqual([skills.map((skill) => skill.address)]);
    const browser = await focusLive(setup, "updates-browser");
    await parsedEnter(setup);
    expect(opened).toEqual(["has-updates"]);
    // A later check can move content, but must retain the current Source identity.
    state.observe({
      source: "unchecked",
      kind: "github",
      exactRevision: revision,
      changed: [candidate],
      unchanged: [],
      added: [],
      removed: [],
      baseline: "baseline:test",
    });
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable === browser).toBe(true);
    await parsedEnter(setup);
    expect(opened).toEqual(["has-updates", "has-updates"]);
  } finally {
    setup.renderer.destroy();
  }
});
test("Source selection survives drill-down and Back; all-update remains bounded to the selected Source", async () => {
  const mounted = await mount();
  try {
    const { setup, calls } = mounted;
    await focusLive(setup, "updates-browser");
    setup.mockInput.pressArrow("down");
    await setup.mockInput.typeText(" ");
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Research"));
    await capture(setup, "selected-source-detail");
    await enterLive(setup, "route-back");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
    const browser = await focusLive(setup, "updates-browser");
    expect(browser).toBeInstanceOf(BoxRenderable);
    const other = setup.renderer.root.findDescendantById(
      "updates-browser-row-other:check",
    ) as TextRenderable;
    expect(other.plainText).toContain("✓");
    await enterLive(setup, "updates-update-all");
    await setup.waitFor(() => calls.length === 1);
    expect(calls[0]).toMatchObject({ source: "other", paths: ["skill-0", "skill-1", "skill-2"] });
  } finally {
    await mounted.dispose();
  }
});
test("Ctrl+U submits the selected Source directly from its table without toolbar travel", async () => {
  const mounted = await mount();
  try {
    const { setup, calls } = mounted;
    const table = await focusLive(setup, "updates-browser");
    await setup.mockInput.typeText(" ");
    setup.mockInput.pressKey("u", { ctrl: true });
    await setup.waitFor(() => calls.length === 1);
    expect(calls[0]).toMatchObject({
      source: "team-main",
      paths: ["skill-0", "skill-1", "skill-2"],
    });
    expect(setup.renderer.currentFocusedRenderable === table).toBe(true);
  } finally {
    await mounted.dispose();
  }
});
test("slash opens filtering in the command area; typing owns Ctrl+U and Esc restores the Source cursor", async () => {
  const mounted = await mount();
  try {
    const { setup, calls } = mounted;
    expect(setup.renderer.root.findDescendantById("updates-query")).toBeUndefined();
    await focusLive(setup, "updates-browser");
    await setup.mockInput.typeText("/");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof InputRenderable);
    await setup.renderOnce();
    await setup.renderOnce();
    const input = setup.renderer.currentFocusedRenderable as InputRenderable;
    const source = setup.renderer.root.findDescendantById(
      "updates-browser-row-team-main:cell-source",
    )!;
    expect(input.screenY).toBeGreaterThan(source.screenY);
    setup.mockInput.pressKey("u", { ctrl: true });
    await setup.renderOnce();
    expect(calls).toEqual([]);
    await setup.mockInput.typeText("other");
    await setup.waitFor(
      () => !setup.renderer.root.findDescendantById("updates-browser-row-team-main"),
    );
    await capture(setup, "footer-filter-80x24");
    await parsedEscape(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("updates-browser-row-team-main"),
    );
    expect(setup.renderer.root.findDescendantById("updates-query")).toBeUndefined();
    await setup.mockInput.typeText("u");
    await setup.waitFor(() => calls.length === 1);
    expect(calls[0]).toMatchObject({ source: "team-main" });
  } finally {
    await mounted.dispose();
  }
});
test("Source Skill Enter previews its checked diff and one Esc restores filter, selection, cursor and scroll", async () => {
  const mounted = await mount(80, 24, false, false, 120);
  try {
    const { setup, loaded, calls, checks, acquisitions, previews } = mounted;
    await enterLive(setup, "updates-browser");
    await focusLive(setup, "source-updates-browser");
    await setup.mockInput.typeText("/");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof InputRenderable);
    setup.mockInput.pressKey("u", { ctrl: true });
    await setup.renderOnce();
    expect(calls).toEqual([]);
    await setup.mockInput.typeText("Skill 1");
    await parsedEnter(setup);
    setup.mockInput.pressKey("END");
    await setup.mockInput.typeText(" ");
    const body = setup.renderer.root.findDescendantById(
      "source-updates-browser-body",
    ) as ScrollBoxRenderable;
    await setup.waitFor(() => body.scrollTop > 0);
    const before = body.scrollTop;
    expect(loaded).toEqual([{ source: "team-main", path: "skill-0" }]);
    const beforeChecks = checks.length;
    await parsedEnter(setup);
    await setup.waitFor(
      () =>
        setup.renderer.root.findDescendantById("source-updates-preview-diff") instanceof
        DiffRenderable,
    );
    await setup.waitForFrame((frame) => frame.includes("Checked skill-119"));
    expect(previews).toEqual([
      {
        source: "team-main",
        path: "skill-119",
        exactRevision: revision,
        expectedBaseline: "checked-baseline",
      },
    ]);
    expect(loaded).toEqual([{ source: "team-main", path: "skill-0" }]);
    expect(calls).toEqual([]);
    expect(checks).toHaveLength(beforeChecks);
    expect(acquisitions).toEqual([]);
    expect(setup.renderer.root.findDescendantById("skill-inspector-open-reader")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("skill-detail-actions-toggle")).toBeUndefined();
    await capture(setup, "skill-preview-80x24");
    await focusLive(setup, "source-updates-preview-content-pane");
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-updates-browser"));
    await setup.waitForFrame((frame) => frame.includes("Filter: Skill 1"));
    const restored = setup.renderer.root.findDescendantById(
      "source-updates-browser-body",
    ) as ScrollBoxRenderable;
    await setup.waitFor(() => restored.scrollTop === before);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-updates-browser");
    const check = setup.renderer.root.findDescendantById(
      "source-updates-browser-row-team-main%00skill-119:check",
    ) as TextRenderable;
    expect(check.plainText).toContain("✓");
    expect(loaded).toHaveLength(1);
    expect(acquisitions).toEqual([]);
    await capture(setup, "preview-return-80x24");
    await setup.mockInput.typeText("u");
    await setup.waitFor(() => calls.length === 1);
    expect(calls).toEqual([
      {
        source: "team-main",
        paths: ["skill-119"],
        exactRevision: revision,
        expectedBaseline: "checked-baseline",
      },
    ]);
  } finally {
    await mounted.dispose();
  }
});
