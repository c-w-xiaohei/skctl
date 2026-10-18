import { afterEach, expect, test } from "bun:test";
import {
  CodeRenderable,
  MarkdownRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { App } from "../src/app";
import { directOwner, directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import {
  focusLive,
  openAllInstalledSkills,
  parsedEnter,
  parsedEscape,
} from "./reader-test-controls";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

async function arrow(direction: "up" | "down") {
  await new Promise<void>((resolve) => {
    const parsed = () => {
      setup!.renderer.keyInput.off("keypress", parsed);
      resolve();
    };
    setup!.renderer.keyInput.prependListener("keypress", parsed);
    setup!.mockInput.pressArrow(direction);
  });
  await setup!.renderOnce();
}

function projection() {
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("Complete fixture required");
  return {
    ...base,
    effective: {
      ...base.effective,
      managed: true,
      use: ["root"],
      collections: ["root", "child"],
      agent: { ...base.effective.agent, status: "available" as const },
      collectionsView: [
        {
          id: "root",
          description: "Root task description",
          declared: [directOwner],
          repository: { derived: false, producers: [] },
          members: base.installedSkills.map((skill) => ({
            name: skill.name,
            address: skill.address,
            paths: [],
          })),
          references: [
            {
              name: "child",
              collection: "child",
              description: "Child task description",
              owner: directOwner,
            },
          ],
          links: [],
        },
        {
          id: "child",
          description: "Child task description",
          declared: [directOwner],
          repository: { derived: false, producers: [] },
          members: [{ name: "reference", address: base.installedSkills[1]!.address, paths: [] }],
          references: [],
          links: [],
        },
      ],
    },
  };
}

async function capture(name: string) {
  const directory = process.env.QUIET_UPDATE_CAPTURE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await setup!.flush();
  const settle = async (node: BaseRenderable): Promise<void> => {
    if (node instanceof CodeRenderable) await node.highlightingDone;
    for (const child of node.getChildren()) await settle(child);
  };
  await settle(setup!.renderer.root);
  await setup!.renderOnce();
  await writeFile(join(directory, `${name}.txt`), setup!.captureCharFrame());
}

async function waitForBody(text: string) {
  const nodes = (node: BaseRenderable): BaseRenderable[] => [
    node,
    ...node.getChildren().flatMap(nodes),
  ];
  try {
    await setup!.waitFor(() =>
      nodes(setup!.renderer.root).some(
        (node) => node instanceof CodeRenderable && node.plainText.includes(text),
      ),
    );
    for (const node of nodes(setup!.renderer.root))
      if (node instanceof CodeRenderable) await node.highlightingDone;
    await setup!.renderOnce();
    expect(setup!.captureCharFrame()).toContain(text);
  } catch (error) {
    console.error(
      "Reader body diagnostic",
      nodes(setup!.renderer.root)
        .filter(
          (node) =>
            node.id === "reader-scrollbox" ||
            node instanceof CodeRenderable ||
            node instanceof MarkdownRenderable,
        )
        .map((node) => ({
          id: node.id,
          text:
            node instanceof MarkdownRenderable
              ? node.content
              : node instanceof CodeRenderable
                ? node.plainText
                : undefined,
        })),
      setup!.captureCharFrame(),
    );
    throw error;
  }
}

test("default disclosure is guided and selection reads directly in a stable Reader", async () => {
  const reads: string[] = [];
  setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection(), {
          installed: {
            load: async ({ address }) => {
              reads.push(address.path);
              return {
                address,
                name: address.path,
                description: "",
                markdownText: `# ${address.path}\n\nBody: ${address.path}`,
                rawText: `Body: ${address.path}`,
              };
            },
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 144, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup!.renderer.currentFocusedRenderable?.id === "current-exposure-browser",
    );
  } catch (error) {
    console.error(
      "Startup focus",
      setup.renderer.currentFocusedRenderable?.id,
      "Tree focusable",
      setup.renderer.root.findDescendantById("current-exposure-browser")?.focusable,
    );
    await capture("agent-startup-debug");
    throw error;
  }
  const tree = setup.renderer.currentFocusedRenderable as ScrollBoxRenderable;
  expect(reads).toEqual([]);
  await setup.waitForFrame((frame) => frame.includes("Enter expand"));
  await capture("agent-startup-144x40");
  await parsedEnter(setup);
  expect(setup.renderer.currentFocusedRenderable).toBe(tree);
  expect(reads).toEqual([]);
  await arrow("down");
  expect(reads).toEqual([]);
  await arrow("down");
  await waitForBody("Body: guide");
  const body = setup.renderer.root.findDescendantById("reader-scrollbox")!;
  expect(body).toBeDefined();
  expect(reads).toEqual(["guide"]);
  await arrow("down");
  await waitForBody("Body: reference");
  expect(setup.renderer.root.findDescendantById("reader-scrollbox")).toBe(body);
  await arrow("up");
  await waitForBody("Body: guide");
  expect(setup.renderer.root.findDescendantById("reader-scrollbox")).toBe(body);
  expect(reads).toEqual(["guide", "reference"]);
  for (let round = 0; round < 3; round++) {
    await arrow("down");
    await waitForBody("Body: reference");
    await arrow("up");
    await waitForBody("Body: guide");
    expect(setup.renderer.root.findDescendantById("reader-scrollbox")).toBe(body);
  }
  expect(reads).toEqual(["guide", "reference"]);
  await parsedEnter(setup);
  expect(setup.renderer.currentFocusedRenderable).toBe(body);
  for (const [width, height] of [
    [144, 40],
    [100, 24],
    [80, 24],
    [43, 13],
  ]) {
    setup.resize(width!, height!);
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Body: guide"));
    expect(setup.renderer.root.findDescendantById("reader-scrollbox")).toBe(body);
    expect(setup.renderer.currentFocusedRenderable).toBe(body);
    await capture(`agent-reader-${width}x${height}`);
  }
  await parsedEscape(setup);
  await setup.waitFor(() => setup!.renderer.currentFocusedRenderable === tree);
});

test("All Skills Collection tree filters descendants and survives popup clearing and responsive hiding", async () => {
  setup = await testRender(() => <App core={directSourceCore(projection())} exit={() => {}} />, {
    width: 144,
    height: 40,
  });
  await openAllInstalledSkills(setup);
  await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("collection-filter-tree"));
  const tree = setup.renderer.root.findDescendantById(
    "collection-filter-tree",
  ) as ScrollBoxRenderable;
  const browser = setup.renderer.root.findDescendantById(
    "installed-skill-browser",
  ) as SelectRenderable;
  await focusLive(setup, "collection-filter-tree");
  await arrow("down");
  await arrow("down");
  await setup.renderOnce();
  expect(browser.options).toHaveLength(2);
  await setup.waitFor(
    () => !!setup!.renderer.root.findDescendantById("clear-skills-filter-collection"),
  );
  await parsedEnter(setup);
  await arrow("down");
  await setup.renderOnce();
  expect(browser.options).toHaveLength(1);
  expect(browser.getSelectedOption()?.value).toBe(JSON.stringify(["team-main", "reference"]));
  await setup.waitForFrame(
    (frame) => frame.includes("No children") && !frame.includes("Enter expand"),
  );
  await capture("inventory-collections-144x40");
  await focusLive(setup, "open-skills-filter");
  await parsedEnter(setup);
  await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("skills-filter-clear-all"));
  await capture("filter-144x40");
  for (const [width, height] of [
    [100, 24],
    [80, 24],
    [43, 13],
  ]) {
    setup.resize(width!, height!);
    await capture(`filter-${width}x${height}`);
  }
  setup.resize(144, 40);
  await setup.renderOnce();
  await focusLive(setup, "skills-filter-clear-all");
  await parsedEnter(setup);
  await parsedEscape(setup);
  expect(browser.options).toHaveLength(2);
  setup.resize(100, 24);
  await setup.renderOnce();
  expect(tree.focusable).toBe(false);
  setup.resize(144, 40);
  await setup.renderOnce();
  expect(setup.renderer.root.findDescendantById("collection-filter-tree")).toBe(tree);
  expect(browser.options).toHaveLength(2);
});

test("native Tree scrollbar focus keeps Tree commands and does not select another object", async () => {
  const base = projection();
  const root = base.effective.collectionsView[0]!;
  const dense = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: [
        {
          ...root,
          members: [
            ...root.members,
            ...Array.from({ length: 60 }, (_, i) => ({
              name: `item-${i}`,
              address: { source: "team-main", path: `item-${i}` },
              paths: [],
            })),
          ],
        },
        base.effective.collectionsView[1]!,
      ],
    },
  };
  setup = await testRender(() => <App core={directSourceCore(dense)} exit={() => {}} />, {
    width: 100,
    height: 24,
  });
  await setup.waitFor(
    () => setup!.renderer.currentFocusedRenderable?.id === "current-exposure-browser",
  );
  await parsedEnter(setup);
  const tree = setup.renderer.root.findDescendantById(
    "current-exposure-browser",
  ) as ScrollBoxRenderable;
  const thumb = tree.verticalScrollBar.slider;
  await setup.renderOnce();
  await setup.mockMouse.click(thumb.screenX, thumb.screenY);
  await setup.waitForFrame((frame) => frame.includes("Enter collapse"));
  expect(setup.renderer.currentFocusedRenderable).toBe(tree.verticalScrollBar);
  expect(setup.captureCharFrame()).toContain("Root task description");
  await parsedEnter(setup);
  await setup.waitForFrame((frame) => frame.includes("Enter expand"));
  expect(tree.scrollTop).toBe(0);
});

test("an incomplete projection offers Problems without suggesting an unrelated Managed mutation", async () => {
  const base = projection();
  const unavailable = {
    ...base,
    effective: {
      status: "unavailable" as const,
      sources: base.effective.sources,
      collections: [],
      agent: base.effective.agent,
      reasons: [
        {
          code: "CONFIG_INVALID" as const,
          severity: "warning" as const,
          message: "Fix the unreadable Collection declaration",
        },
      ],
    },
  };
  setup = await testRender(() => <App core={directSourceCore(unavailable)} exit={() => {}} />, {
    width: 100,
    height: 24,
  });
  await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("current-exposure-problems"));
  expect(
    setup.renderer.root.findDescendantById("current-exposure-enable-managed-opencode"),
  ).toBeUndefined();
  await focusLive(setup, "current-exposure-problems");
  await parsedEnter(setup);
  try {
    await setup.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "problems-browser");
  } catch (error) {
    console.error(
      "Problems handoff",
      setup.renderer.currentFocusedRenderable?.id,
      setup.captureCharFrame(),
    );
    throw error;
  }
  expect(setup.captureCharFrame()).toContain("Fix the unreadable Collection declaration");
});
