import { expect, test } from "bun:test";
import { MarkdownRenderable, TextBufferRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";

type Setup = Awaited<ReturnType<typeof testRender>>;

function textIn(renderable: { getChildren(): readonly unknown[] }): string {
  const children = renderable.getChildren() as {
    getChildren?: () => readonly unknown[];
    plainText?: string;
  }[];
  return children
    .flatMap((child) =>
      child instanceof TextBufferRenderable
        ? [child.plainText]
        : child.getChildren
          ? [textIn(child as { getChildren(): readonly unknown[] })]
          : [],
    )
    .join("\n");
}

async function openNarrowReader(setup: Setup) {
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
  );
  setup.mockInput.pressEnter();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
}

function expectReaderBounds(setup: Setup, width: number, height: number) {
  const reader = setup.renderer.root.findDescendantById("reader-scrollbox");
  const identity = setup.renderer.root.findDescendantById("reader-identity");
  const tabs = setup.renderer.root.findDescendantById("reader-tabs");
  expect(reader).toBeDefined();
  expect(identity).toBeDefined();
  expect(tabs).toBeDefined();
  for (const renderable of [identity!, tabs!, reader!, ...reader!.getChildren()]) {
    expect(renderable.screenX).toBeGreaterThanOrEqual(0);
    expect(renderable.screenY).toBeGreaterThanOrEqual(0);
    expect(renderable.screenY).toBeLessThan(height);
  }
  expect(identity!.screenY + identity!.height).toBeLessThanOrEqual(tabs!.screenY);
  expect(tabs!.screenY + tabs!.height).toBeLessThanOrEqual(reader!.screenY);
  const frame = setup.captureCharFrame().split("\n");
  expect(frame).toHaveLength(height + 1);
  for (const line of frame.slice(0, height)) expect(line.length).toBe(width);
}

function expectVisibleIdentity(setup: Setup, frame: string, source: string, path: string) {
  const identity = setup.renderer.root.findDescendantById("reader-identity")!;
  const lines = frame
    .split("\n")
    .slice(identity.screenY, identity.screenY + identity.height)
    .map((line) => line.slice(identity.screenX, identity.screenX + identity.width));
  const sourceLine = lines.findIndex((line) => line.includes("Source:"));
  const pathLine = lines.findIndex((line) => line.includes("Path:"));
  expect(sourceLine).toBeGreaterThanOrEqual(0);
  expect(pathLine).toBeGreaterThan(sourceLine);
  const visibleIdentity = lines.join("").replace(/\s/g, "");
  expect(visibleIdentity).toContain(`Source:${source}`);
  expect(visibleIdentity).toContain(`Path:${path}`);
}

test("RENDER Reader names one Installed Skill and retains exact ownership across sibling views", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
          listInstalledResources: async () => ({ value: [], diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-tabs"));
    for (const view of ["SKILL.md", "Resources", "Details"] as const) {
      const mountedText = textIn(setup.renderer.root);
      expect(mountedText).toContain("Reader · guide");
      expect(mountedText).toContain("Source: team-main");
      expect(mountedText).toContain("Path: guide");
      expect(setup.captureCharFrame()).toContain(view);
      if (view !== "Details") {
        setup.mockInput.pressKey("ARROW_RIGHT");
        await setup.renderOnce();
      }
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Reader visibly retains a long structural source and nested path at supported sizes", async () => {
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
  for (const [width, height] of [
    [120, 40],
    [80, 24],
    [79, 24],
    [43, 30],
  ] as const) {
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(
            {
              ...projection,
              installedSkills: [longSkill],
            },
            {
              loadInstalled: async () => ({
                value: { ...readerContent, address, name: longSkill.name },
                diagnostics: [],
              }),
            },
          )}
          exit={() => {}}
        />
      ),
      { width, height },
    );
    try {
      if (width < 80) await openNarrowReader(setup);
      else await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-scrollbox"));
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toContain("Reader · long-form-guides");
      expectVisibleIdentity(setup, frame, address.source, address.path);
      expect(frame).toContain("SKILL.md");
      expect(textIn(setup.renderer.root.findDescendantById("reader-scrollbox")!)).toContain(
        "# Guide",
      );
      if (width < 80) expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
      expectReaderBounds(setup, width, height);
    } finally {
      setup.renderer.destroy();
    }
  }
});

test("RENDER Reader-local identity and prose remain bounded at supported detail widths", async () => {
  const longProse =
    "A deliberately long fallback prose sentence that should wrap within the Reader rather than disappear beyond its bounded content surface.";
  for (const [width, height] of [
    [120, 40],
    [80, 24],
    [79, 24],
    [43, 30],
  ] as const) {
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalled: async () => ({
              value: {
                ...readerContent,
                markdownText: `# Guide\n\n${longProse}`,
                rawText: longProse,
              },
              diagnostics: [],
            }),
          })}
          exit={() => {}}
        />
      ),
      { width, height },
    );
    try {
      if (width < 80) await openNarrowReader(setup);
      else await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-scrollbox"));
      await setup.renderOnce();
      const mountedText = textIn(setup.renderer.root);
      expect(mountedText).toContain("Reader · guide");
      expect(mountedText).toContain("Source: team-main");
      expect(mountedText).toContain("Path: guide");
      expectReaderBounds(setup, width, height);

      const reader = setup.renderer.root.findDescendantById("reader-scrollbox")!;
      const markdown = reader
        .getChildren()
        .find((child) => child instanceof MarkdownRenderable) as MarkdownRenderable;
      expect(markdown.width).toBeLessThanOrEqual(reader.width);
      if (width === 43) {
        expect(markdown.width).toBe(42);
        expect(markdown.height).toBe(6);
      }
    } finally {
      setup.renderer.destroy();
    }
  }
});

test("RENDER Reader wraps long raw fallback prose without changing the native Markdown renderer", async () => {
  const longProse =
    "A deliberately long fallback prose sentence that should wrap within the Reader rather than disappear beyond its bounded content surface.";
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({
            value: {
              ...readerContent,
              markdownText: `# Guide\n\n${longProse}`,
              rawText: longProse,
            },
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 43, height: 30 },
  );
  try {
    await openNarrowReader(setup);
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-find");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-raw");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-line-0"));
    await setup.renderOnce();
    const fallback = setup.renderer.root.findDescendantById(
      "reader-line-0",
    ) as TextBufferRenderable;
    expect(fallback.wrapMode).toBe("word");
    expect(fallback.virtualLineCount).toBeGreaterThan(1);
    expect(fallback.width).toBeLessThanOrEqual(
      setup.renderer.root.findDescendantById("reader-scrollbox")!.width,
    );
  } finally {
    setup.renderer.destroy();
  }
});
