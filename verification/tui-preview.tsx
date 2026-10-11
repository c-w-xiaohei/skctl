import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { testRender } from "@opentui/solid";
import {
  ScrollBoxRenderable,
  SelectRenderable,
  type CapturedFrame,
  type RGBA,
} from "@opentui/core";
import { selectScrollOffset } from "../packages/skill-tui/src/select-scroll";
import { createSkillCliCore } from "@skill-cli/core";
import { App } from "../packages/skill-tui/src/app";

// A bounded visual preview, not a test-suite runner. It reads a real Core projection
// and mounts production App. No mutation, build, network fixture, or assertion suite.
// Readiness follows parsed input, including the native standalone-Esc delay.
const output = resolve(process.argv[3] ?? "tmp/tui-visual-reset-preview");
const project = resolve(process.argv[2] ?? ".");
const core = createSkillCliCore({ cwd: project, project });
const startedAt = new Date().toISOString();
const sources = await Promise.all(
  [
    "packages/skill-tui/src/app.tsx",
    "packages/skill-tui/src/workspace-page.tsx",
    "packages/skill-tui/src/ui/route-shell.tsx",
    "packages/skill-tui/src/components/navigation-list.tsx",
    "packages/skill-tui/src/ui/pane.tsx",
    "packages/skill-tui/src/ui/data-list.tsx",
    "packages/skill-tui/src/ui/list-text.ts",
    "packages/skill-tui/src/collections-page.tsx",
    "packages/skill-tui/src/config-page.tsx",
    "packages/skill-tui/src/select-scroll.ts",
    "packages/skill-tui/src/components/section-tabs.tsx",
    "packages/skill-tui/src/workspace/state.ts",
    "packages/skill-tui/src/route.ts",
    "packages/skill-tui/src/navigation.ts",
    "packages/skill-tui/src/reader.tsx",
    "packages/skill-tui/src/ui/theme.ts",
    "packages/skill-tui/src/ui/command-button.tsx",
    "packages/skill-tui/package.json",
    "packages/skill-core/package.json",
    "package.json",
    "bun.lock",
  ].map(async (path) => ({
    path,
    sha256: new Bun.CryptoHasher("sha256").update(await readFile(path)).digest("hex"),
  })),
);
const projection = await core.workspace.get();
const previewCore = { ...core, workspace: { get: async () => projection } };
await mkdir(output, { recursive: true });

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const color = (value: RGBA, fallback: string) => {
  if (value.intent === "default") return fallback;
  const [r, g, b] = value.toInts();
  return `rgb(${r},${g},${b})`;
};
function frameHtml(frame: CapturedFrame) {
  return frame.lines
    .map((line) =>
      line.spans
        .map(
          (span) =>
            `<span style="color:${color(span.fg, "#e4e7ec")};background:${color(span.bg, "#1b2025")};${span.attributes & 1 ? "font-weight:bold;" : ""}">${escapeHtml(span.text)}</span>`,
        )
        .join(""),
    )
    .join("\n");
}

const samples: { label: string; html: string }[] = [];
const interactions: unknown[] = [];
type Setup = Awaited<ReturnType<typeof testRender>>;
async function parsedEscape(setup: Setup) {
  await new Promise<void>((resolve, reject) => {
    const parsed = (event: { name: string }) => {
      if (event.name !== "escape" && event.name !== "esc") return;
      clearTimeout(timeout);
      setup.renderer.keyInput.off("keypress", parsed);
      resolve();
    };
    const timeout = setTimeout(() => {
      setup.renderer.keyInput.off("keypress", parsed);
      reject(new Error("Preview Esc was not parsed within one second"));
    }, 1000);
    setup.renderer.keyInput.prependListener("keypress", parsed);
    setup.mockInput.pressEscape();
  });
  await setup.renderOnce();
  await setup.renderOnce();
}
async function pointerFocusCycle(setup: Setup, id: string) {
  const target = setup.renderer.root.findDescendantById(id);
  if (!target) throw new Error(`Preview surface not mounted: ${id}`);
  await setup.mockMouse.click(target.screenX + 1, target.screenY + 1);
  await setup.renderOnce();
  const start = setup.renderer.currentFocusedRenderable?.id;
  const forward: (string | undefined)[] = [];
  for (let step = 0; step < 40; step++) {
    setup.mockInput.pressTab();
    await setup.renderOnce();
    const current = setup.renderer.currentFocusedRenderable?.id;
    forward.push(current);
    if (current === start) break;
  }
  const backward: (string | undefined)[] = [];
  for (let step = 0; step < forward.length; step++) {
    setup.mockInput.pressTab({ shift: true });
    await setup.renderOnce();
    backward.push(setup.renderer.currentFocusedRenderable?.id);
  }
  interactions.push({ pane: id, pointerFocus: start, forward, backward });
}
for (const [width, height] of [
  [120, 40],
  [80, 24],
  [43, 30],
] as const) {
  const setup = await testRender(() => <App core={previewCore} exit={() => {}} />, {
    width,
    height,
  });
  try {
    await setup.waitForVisualIdle({ maxFrames: 20 });
    const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
    browser?.focus();
    await setup.renderOnce();
    await setup.renderOnce();
    const frame = setup.captureSpans();
    await writeFile(join(output, `${width}x${height}-skills.txt`), setup.captureCharFrame());
    samples.push({ label: `${width}×${height} — Skills`, html: frameHtml(frame) });
    if (width === 120) {
      for (let step = 0; step < 11; step++) setup.mockInput.pressArrow("down");
      await setup.renderOnce();
      await setup.renderOnce();
      await writeFile(join(output, "120x40-selected.txt"), setup.captureCharFrame());
      samples.push({
        label: "120×40 — selected Skill and its live details",
        html: frameHtml(setup.captureSpans()),
      });
      for (let step = 0; step < 55; step++) setup.mockInput.pressArrow("down");
      await setup.renderOnce();
      await setup.renderOnce();
      await writeFile(join(output, "120x40-before-scrolled-click.txt"), setup.captureCharFrame());
      const clickBefore =
        browser instanceof SelectRenderable
          ? {
              x: browser.screenX + 3,
              y: browser.screenY + 2,
              screenY: browser.screenY,
              offset: selectScrollOffset(browser),
              expectedOption: browser.options[selectScrollOffset(browser) + 2],
              selectedOption: browser.getSelectedOption(),
              isDestroyed: browser.isDestroyed,
            }
          : undefined;
      if (browser) await setup.mockMouse.click(browser.screenX + 3, browser.screenY + 2);
      await setup.renderOnce();
      await setup.renderOnce();
      await writeFile(
        join(output, "scrolled-click.json"),
        JSON.stringify(
          {
            before: clickBefore,
            after:
              browser instanceof SelectRenderable
                ? {
                    selectedOption: browser.getSelectedOption(),
                    offset: selectScrollOffset(browser),
                    screenY: browser.screenY,
                    isDestroyed: browser.isDestroyed,
                  }
                : undefined,
          },
          null,
          2,
        ),
      );
      await writeFile(join(output, "120x40-scrolled-click.txt"), setup.captureCharFrame());
      samples.push({
        label: "120×40 — click a visible row after scrolling",
        html: frameHtml(setup.captureSpans()),
      });
      await parsedEscape(setup);
      const beforeScope = setup.renderer.root.findDescendantById("installed-skill-browser");
      const savedScopeOffset =
        beforeScope instanceof SelectRenderable ? selectScrollOffset(beforeScope) : undefined;
      const unassignedTab = setup.renderer.root.findDescendantById("skills-view-tab-unassigned");
      if (unassignedTab)
        await setup.mockMouse.click(unassignedTab.screenX + 1, unassignedTab.screenY);
      await setup.renderOnce();
      await setup.renderOnce();
      const unassignedBrowser = setup.renderer.root.findDescendantById("installed-skill-browser");
      unassignedBrowser?.focus();
      for (let step = 0; step < 6; step++) setup.mockInput.pressArrow("down");
      await setup.renderOnce();
      const allTab = setup.renderer.root.findDescendantById("skills-view-tab-all-installed-skills");
      if (allTab) await setup.mockMouse.click(allTab.screenX + 1, allTab.screenY);
      await setup.renderOnce();
      await setup.renderOnce();
      const returnedBrowser = setup.renderer.root.findDescendantById("installed-skill-browser");
      interactions.push({
        pane: "Skills scopes",
        beforeAllOffset: savedScopeOffset,
        unassignedOptions:
          unassignedBrowser instanceof SelectRenderable ? unassignedBrowser.options.length : 0,
        returnedAllOffset:
          returnedBrowser instanceof SelectRenderable
            ? selectScrollOffset(returnedBrowser)
            : undefined,
      });
      const navigation = setup.renderer.root.findDescendantById("shell-section-navigation");
      if (navigation) await setup.mockMouse.click(navigation.screenX + 2, navigation.screenY + 1);
      await setup.renderOnce();
      await setup.renderOnce();
      await writeFile(join(output, "120x40-collections.txt"), setup.captureCharFrame());
      samples.push({ label: "120×40 — Collections", html: frameHtml(setup.captureSpans()) });
      await pointerFocusCycle(setup, "collection-relationships");
      const collectionBrowser = setup.renderer.root.findDescendantById("collection-browser");
      collectionBrowser?.focus();
      setup.mockInput.pressEnter();
      await setup.renderOnce();
      await setup.renderOnce();
      await writeFile(join(output, "120x40-collection-details.txt"), setup.captureCharFrame());
      samples.push({ label: "120×40 — Collection details", html: frameHtml(setup.captureSpans()) });
      const workspaceTab = setup.renderer.root.findDescendantById("top-navigation-tab-workspace");
      workspaceTab?.focus();
      setup.mockInput.pressArrow("right");
      await setup.renderOnce();
      await setup.renderOnce();
      setup.renderer.root.findDescendantById("config-source-browser")?.focus();
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
      await setup.renderOnce();
      await writeFile(join(output, "120x40-global-sources.txt"), setup.captureCharFrame());
      samples.push({
        label: "120×40 — Global Config / Sources",
        html: frameHtml(setup.captureSpans()),
      });
      await pointerFocusCycle(setup, "config-declaration-metadata");
    } else {
      setup.mockInput.pressEnter();
      await setup.renderOnce();
      await setup.renderOnce();
      await writeFile(join(output, `${width}x${height}-details.txt`), setup.captureCharFrame());
      samples.push({
        label: `${width}×${height} — Skill details`,
        html: frameHtml(setup.captureSpans()),
      });
      await parsedEscape(setup);
      await writeFile(join(output, `${width}x${height}-return.txt`), setup.captureCharFrame());
      samples.push({
        label: `${width}×${height} — Esc returns to library`,
        html: frameHtml(setup.captureSpans()),
      });
    }
  } finally {
    setup.renderer.destroy();
  }
}
await writeFile(join(output, "interaction-traces.json"), JSON.stringify(interactions, null, 2));
const compact = await testRender(() => <App core={previewCore} exit={() => {}} />, {
  width: 80,
  height: 16,
});
try {
  await compact.waitForVisualIdle({ maxFrames: 20 });
  const sourcesTab = compact.renderer.root.findDescendantById("shell-section-tab-sources");
  if (!sourcesTab) throw new Error("Compact Sources navigation not mounted");
  await compact.mockMouse.click(sourcesTab.screenX + 1, sourcesTab.screenY);
  await compact.renderOnce();
  await compact.renderOnce();
  const sourceBrowser = compact.renderer.root.findDescendantById("source-browser");
  if (!(sourceBrowser instanceof SelectRenderable)) throw new Error("Source browser not mounted");
  sourceBrowser.focus();
  for (let step = 0; step < sourceBrowser.options.length; step++)
    compact.mockInput.pressArrow("down");
  await compact.renderOnce();
  const sourceBefore = {
    offset: selectScrollOffset(sourceBrowser),
    selected: sourceBrowser.getSelectedOption(),
    height: sourceBrowser.height,
    options: sourceBrowser.options.length,
  };
  await writeFile(join(output, "80x16-source-before-open.txt"), compact.captureCharFrame());
  await writeFile(
    join(output, "source-return-readiness.json"),
    JSON.stringify({ sourceBefore, focus: compact.renderer.currentFocusedRenderable?.id }, null, 2),
  );
  sourceBrowser.focus();
  compact.mockInput.pressEnter();
  await compact.renderOnce();
  await compact.renderOnce();
  await writeFile(join(output, "80x16-source-open.txt"), compact.captureCharFrame());
  const metadata = compact.renderer.root.findDescendantById("source-metadata");
  if (!(metadata instanceof ScrollBoxRenderable)) throw new Error("Source metadata not mounted");
  metadata.scrollTop = 2;
  await compact.renderOnce();
  const savedMetadataScroll = metadata.scrollTop;
  const follow = compact.renderer.root.findDescendantById("source-command-skills");
  if (!follow) throw new Error("Source relationship command not mounted");
  follow.focus();
  compact.mockInput.pressEnter();
  await compact.renderOnce();
  await compact.renderOnce();
  await parsedEscape(compact);
  const returnedMetadata = compact.renderer.root.findDescendantById("source-metadata");
  interactions.push({
    pane: "Source metadata return",
    saved: savedMetadataScroll,
    returned:
      returnedMetadata instanceof ScrollBoxRenderable ? returnedMetadata.scrollTop : undefined,
  });
  await writeFile(join(output, "80x16-source-detail-return.txt"), compact.captureCharFrame());
  samples.push({
    label: "80×16 — scrolled Source details after Esc",
    html: frameHtml(compact.captureSpans()),
  });
  await parsedEscape(compact);
  const returnedSources = compact.renderer.root.findDescendantById("source-browser");
  interactions.push({
    pane: "Compact Source list return",
    before: sourceBefore,
    after:
      returnedSources instanceof SelectRenderable
        ? {
            offset: selectScrollOffset(returnedSources),
            selected: returnedSources.getSelectedOption(),
            height: returnedSources.height,
          }
        : undefined,
  });
  await writeFile(join(output, "80x16-source-list-return.txt"), compact.captureCharFrame());
  samples.push({
    label: "80×16 — compact Source list after Esc",
    html: frameHtml(compact.captureSpans()),
  });
  const globalTab = compact.renderer.root.findDescendantById("top-navigation-tab-global");
  if (!globalTab) throw new Error("Compact Global navigation not mounted");
  await compact.mockMouse.click(globalTab.screenX + 1, globalTab.screenY);
  await compact.renderOnce();
  await compact.renderOnce();
  await writeFile(join(output, "80x16-config-sources.txt"), compact.captureCharFrame());
  samples.push({ label: "80×16 — Global Config Sources", html: frameHtml(compact.captureSpans()) });
} finally {
  compact.renderer.destroy();
}
await writeFile(join(output, "interaction-traces.json"), JSON.stringify(interactions, null, 2));
await writeFile(
  join(output, "preview.html"),
  `<!doctype html><meta charset="utf-8"><title>skill-cli UI preview</title><style>body{background:#101317;color:#b8c0cc;padding:24px;font:14px system-ui}pre{display:inline-block;background:#1b2025;padding:12px;font:14px/20px monospace;white-space:pre}section{margin-bottom:32px;overflow:auto}h2{font-size:16px}</style><h1>Production App — bounded renderer preview</h1><p>Real Core snapshot; no mutations. Captured OpenTUI cells, not a native terminal screenshot or human approval.</p>${samples.map((sample) => `<section><h2>${sample.label}</h2><pre>${sample.html}</pre></section>`).join("")}`,
);
console.log(`Saved ${samples.length} UI previews to ${output}`);
await writeFile(
  join(output, "manifest.json"),
  JSON.stringify(
    {
      startedAt,
      capturedAt: new Date().toISOString(),
      project,
      sources,
      sizes: [
        [120, 40],
        [80, 24],
        [43, 30],
        [80, 16],
      ],
      boundary:
        "production App + real Core read snapshot + in-memory native renderer; not packaged PTY or human approval",
    },
    null,
    2,
  ),
);
