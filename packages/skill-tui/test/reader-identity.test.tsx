import { expect, test } from "bun:test";
import {
  MarkdownRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextAttributes,
  TextBufferRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerAddress, readerContent, readerProjection } from "./installed-reader.fixture";
import {
  enterInstalledAddress,
  focusLive,
  live,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  selectedReaderTab,
  waitForReaderBody,
} from "./reader-test-controls";
type Setup = Awaited<ReturnType<typeof testRender>>;
function textIn(renderable: BaseRenderable): string {
  if (renderable instanceof TextBufferRenderable) return renderable.plainText;
  return renderable.getChildren().map(textIn).join("\n");
}
function expectReaderBounds(setup: Setup, width: number, height: number) {
  const reader = setup.renderer.root.findDescendantById("reader-scrollbox");
  const identity = setup.renderer.root.findDescendantById("reader-identity");
  const tabs = setup.renderer.root.findDescendantById("reader-views");
  expect(reader).toBeDefined();
  expect(identity).toBeDefined();
  expect(tabs).toBeDefined();
  for (const renderable of [identity!, tabs!, reader!, ...reader!.getChildren()]) {
    expect(renderable.width).toBeGreaterThan(0);
    expect(renderable.height).toBeGreaterThan(0);
    expect(renderable.screenX).toBeGreaterThanOrEqual(0);
    expect(renderable.screenX + renderable.width).toBeLessThanOrEqual(width);
    expect(renderable.screenY).toBeGreaterThanOrEqual(0);
    expect(renderable.screenY + renderable.height).toBeLessThanOrEqual(height);
  }
  expect(identity!.screenY + identity!.height).toBeLessThanOrEqual(tabs!.screenY);
  expect(tabs!.screenY + tabs!.height).toBeLessThanOrEqual(reader!.screenY);
  const frame = setup.captureCharFrame().split("\n");
  expect(frame).toHaveLength(height + 1);
  for (const line of frame.slice(0, height)) expect(line.length).toBe(width);
}
function expectVisibleIdentity(setup: Setup, frame: string, name: string) {
  const identity = setup.renderer.root.findDescendantById("reader-identity")!;
  const lines = frame
    .split("\n")
    .slice(identity.screenY, identity.screenY + identity.height)
    .map((line) => line.slice(identity.screenX, identity.screenX + identity.width));
  expect(identity.screenY + identity.height).toBeLessThanOrEqual(setup.renderer.height);
  expect(identity.height).toBe(1);
  expect(textIn(identity)).toBe(name);
  expect(lines.join(" ")).toContain(name);
  const painted = setup.captureSpans().lines[identity.screenY]!.spans;
  expect(
    painted.find((span) => span.text.includes(name))!.attributes & TextAttributes.BOLD,
  ).not.toBe(0);
}
test("RENDER Reader names one Installed Skill and retains exact ownership across sibling views", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => readerContent,
          listInstalledResources: async () => [],
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterInstalledAddress(setup, readerAddress);
    await waitForReaderBody(setup, "needle in prose");
    for (const [index, view] of ["SKILL.md", "Resources", "Details"].entries()) {
      expectVisibleIdentity(setup, setup.captureCharFrame(), "guide");
      expect<number>(selectedReaderTab(setup)).toBe(index);
      expect(
        (live(setup, "installed-skill-browser") as SelectRenderable).getSelectedOption()?.value,
      ).toBe(JSON.stringify([readerAddress.source, readerAddress.path]));
      expect(setup.captureCharFrame()).toContain(view);
      if (view === "Details") {
        await setup.waitForFrame((frame) => frame.includes("team-main/guide"));
        expect(textIn(live(setup, "reader-details-summary"))).toContain("Address\nteam-main/guide");
        expect(setup.captureCharFrame()).toContain("team-main/guide");
      }
      if (view !== "Details") {
        await openReaderTab(setup, (index + 1) as 1 | 2);
      }
    }
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Reader retains full structural identity and native Markdown/raw wrapping through supported resizes", async () => {
  const address = {
    source: "production-shared-skills-source-id",
    path: "domains/authoring/long-form-guides",
  };
  const projection = readerProjection();
  const installed = projection.installedSkills[0]!;
  const source = installed.source!;
  const longSkill = {
    ...installed,
    address,
    name: "long-form-guides",
    owner: { ...installed.owner, source: address.source },
    source: { ...source, id: address.source },
  };
  const longProse =
    "A deliberately long fallback prose sentence that should wrap within the Reader rather than disappear beyond its bounded content surface.";
  const reads: unknown[] = [];
  const paintedAddresses: string[] = [];
  let wideMarkdownHeight = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(
          { ...projection, installedSkills: [longSkill] },
          {
            loadInstalledSkill: async (
              _environment: import("@skill-cli/core").CoreOptions,
              request,
            ) => {
              reads.push(request.address);
              return {
                ...readerContent,
                address,
                name: longSkill.name,
                markdownText: `# Guide\n\n${longProse}`,
                rawText: longProse,
              };
            },
          },
        )}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    for (const [width, height] of [
      [120, 40],
      [80, 24],
      [79, 24],
      [43, 30],
    ] as const) {
      setup.resize(width, height);
      await setup.flush();
      await openAllInstalledSkills(setup);
      await enterInstalledAddress(setup, address);
      await waitForReaderBody(setup, "A deliberately long");
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
      const frame = setup.captureCharFrame();
      expectVisibleIdentity(setup, frame, longSkill.name);
      expect(frame).toContain("SKILL.md");
      expectReaderBounds(setup, width, height);
      const reader = live(setup, "reader-scrollbox") as ScrollBoxRenderable;
      const markdown = reader
        .getChildren()
        .find((child) => child instanceof MarkdownRenderable) as MarkdownRenderable;
      expect(markdown).toBeInstanceOf(MarkdownRenderable);
      expect(textIn(markdown)).toContain("Guide");
      expect(textIn(markdown)).toContain(longProse);
      expect(markdown.width).toBeGreaterThan(0);
      // The current bordered pane owns width; the retired 40x6 layout does not.
      expect(markdown.width).toBe(Math.min(88, reader.viewport.width));
      expect(markdown.height).toBeGreaterThan(1);
      if (width === 120) wideMarkdownHeight = markdown.height;
      if (width === 43) {
        expect(markdown.height).toBeGreaterThan(wideMarkdownHeight);
        expect(frame).toContain("bounded content surface.");
      }
      await openReaderTab(setup, 2);
      const fullAddress = `${address.source}/${address.path}`;
      const summary = live(setup, "reader-details-summary");
      await setup.waitFor(() => textIn(summary).includes(fullAddress));
      await setup.flush();
      expect(textIn(summary)).toContain(`Address\n${fullAddress}`);
      const paintedAddress = setup
        .captureCharFrame()
        .split("\n")
        .slice(summary.screenY, summary.screenY + summary.height)
        .map((line) => line.slice(summary.screenX, summary.screenX + summary.width))
        .join("")
        .replace(/\s/g, "");
      paintedAddresses.push(paintedAddress);
      expect(reads).toEqual([address]);
      await openReaderTab(setup, 0);
      await parsedEnter(setup);
    }
    setup.resize(79, 24);
    await setup.flush();
    await focusLive(setup, "reader-raw");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-line-0"));
    setup.resize(43, 30);
    await setup.renderOnce();
    const fallback = setup.renderer.root.findDescendantById(
      "reader-line-0",
    ) as TextBufferRenderable;
    expect(fallback.wrapMode).toBe("word");
    expect(fallback.virtualLineCount).toBeGreaterThan(1);
    expect(fallback.width).toBeLessThanOrEqual(
      setup.renderer.root.findDescendantById("reader-scrollbox")!.width,
    );
    for (const paintedAddress of paintedAddresses)
      expect(paintedAddress).toContain(`${address.source}/${address.path}`);
  } finally {
    setup.renderer.destroy();
  }
});
