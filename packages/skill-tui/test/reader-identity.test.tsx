import { expect, test } from "bun:test";
import { MarkdownRenderable, TextBufferRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, openReaderFromInspector } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import { focusLive, openReaderTab, parsedEnter } from "./reader-test-controls";

type Setup = Awaited<ReturnType<typeof testRender>>;

function textIn(renderable: { getChildren(): readonly unknown[] }): string {
  const plainText = (renderable as { plainText?: string }).plainText;
  if (plainText !== undefined) return plainText;
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
  await openReaderFromInspector(setup);
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
}

function expectReaderBounds(setup: Setup, width: number, height: number) {
  const reader = setup.renderer.root.findDescendantById("reader-scrollbox");
  const identity = setup.renderer.root.findDescendantById("reader-identity");
  const tabs = setup.renderer.root.findDescendantById("reader-views");
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

function expectVisibleIdentity(setup: Setup, frame: string, name: string, address: string) {
  const identity = setup.renderer.root.findDescendantById("reader-identity")!;
  const lines = frame
    .split("\n")
    .slice(identity.screenY, identity.screenY + identity.height)
    .map((line) => line.slice(identity.screenX, identity.screenX + identity.width));
  expect(identity.screenY + identity.height).toBeLessThanOrEqual(setup.renderer.height);
  expect(textIn(identity)).toContain(`Reader · ${name}`);
  expect(textIn(identity)).toContain(address);
  expect(lines.join(" ")).toContain("Reader");
  expect(lines.join("").replace(/\s/g, "")).toContain(address.replace(/\s/g, ""));
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
    await openReaderFromInspector(setup);
    await setup.waitFor(() => textIn(setup.renderer.root).includes("Reader · guide"));
    for (const [index, view] of ["SKILL.md", "Resources", "Details"].entries()) {
      const mountedText = textIn(setup.renderer.root);
      expect(mountedText).toContain("Reader · guide");
      expect(mountedText).toContain("team-main/guide");
      expect(setup.captureCharFrame()).toContain(view);
      if (view !== "Details") {
        await openReaderTab(setup, (index + 1) as 1 | 2);
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
      else await openReaderFromInspector(setup);
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toContain("Reader · long-form-guides");
      expectVisibleIdentity(setup, frame, longSkill.name, `${address.source}/${address.path}`);
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
      else await openReaderFromInspector(setup);
      await setup.renderOnce();
      const mountedText = textIn(setup.renderer.root);
      expect(mountedText).toContain("Reader · guide");
      expect(mountedText).toContain("team-main/guide");
      expectReaderBounds(setup, width, height);

      const reader = setup.renderer.root.findDescendantById("reader-scrollbox")!;
      const markdown = reader
        .getChildren()
        .find((child) => child instanceof MarkdownRenderable) as MarkdownRenderable;
      expect(markdown.width).toBeLessThanOrEqual(reader.width);
      if (width === 43) {
        expect(markdown.width).toBe(40);
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
    await focusLive(setup, "reader-raw");
    await parsedEnter(setup);
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
