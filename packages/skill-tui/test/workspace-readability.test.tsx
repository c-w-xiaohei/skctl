import { afterEach, expect, test } from "bun:test";
import {
  CodeRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { App } from "../src/app";
import { exposureTreePathKey } from "../src/collections/agent-access-tree";
import { directOwner, directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { focusLive, parsedEnter, waitForReaderBody } from "./reader-test-controls";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

const description =
  "Domain discovery, bounded contexts, subdomains, aggregates, interactions, context maps, and model review. ".repeat(
    6,
  );
const rootKey = exposureTreePathKey({ segments: [{ collection: "产品构思" }] });
const rowId = (key: string) => `current-exposure-browser-row-${encodeURIComponent(key)}`;
const nodes = (node: BaseRenderable): BaseRenderable[] => [
  node,
  ...node.getChildren().flatMap(nodes),
];

function fixture() {
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("Complete fixture required");
  const collection = (
    id: string,
    references: readonly {
      name: string;
      collection: string;
      description: string;
      owner: typeof directOwner;
    }[] = [],
  ) => ({
    id,
    description,
    declared: [directOwner],
    repository: { derived: false, producers: [] },
    members: [{ name: "guide", address: base.installedSkills[0]!.address, paths: [] }],
    references,
    links: [],
  });
  return {
    ...base,
    effective: {
      ...base.effective,
      managed: true,
      agent: { ...base.effective.agent, status: "available" as const },
      use: ["产品构思"],
      collectionsView: [
        collection("产品构思", [
          {
            name: "domain-driven-design",
            collection: "domain-driven-design",
            description,
            owner: directOwner,
          },
        ]),
        collection("domain-driven-design"),
      ],
    },
  };
}

async function mount(width: number, height: number) {
  setup = await testRender(
    () => (
      <App
        core={directSourceCore(fixture(), {
          installed: {
            load: async ({ address }) => ({
              address,
              name: address.path,
              description: "Guide",
              rawText: "# Guide\n\nUsage instructions.",
              markdownText: "# Guide\n\nUsage instructions.",
            }),
          },
        })}
        exit={() => {}}
      />
    ),
    { width, height },
  );
  await setup.waitFor(
    () => setup!.renderer.currentFocusedRenderable?.id === "current-exposure-browser",
  );
  await setup.flush();
}

async function capture(name: string) {
  const directory = process.env.QUIET_UPDATE_CAPTURE_DIR;
  if (!directory) return;
  for (const node of nodes(setup!.renderer.root))
    if (node instanceof CodeRenderable) await node.highlightingDone;
  await setup!.flush();
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.txt`), setup!.captureCharFrame());
  await writeFile(join(directory, `${name}.json`), JSON.stringify(setup!.captureSpans(), null, 2));
}

test.each([
  [144, 40],
  [100, 24],
  [80, 24],
  [43, 13],
])("Agent access explains its purpose, types and expansion at %ix%i", async (width, height) => {
  await mount(width, height);
  const frame = setup!.captureCharFrame();
  expect(frame).toContain("Shared with your agent");
  expect(frame).toContain("S Skill");
  expect(frame).toContain(height > 18 ? "C Collection" : "C Col");
  expect(frame).toContain("Enter expand");
  expect(frame).not.toContain("▦");
  expect(frame).not.toContain("≡");
  const marker = setup!.renderer.root.findDescendantById(
    `${rowId(rootKey)}-kind`,
  ) as TextRenderable;
  expect(marker.plainText.trim()).toBe("C");
  const disclosure = setup!.renderer.root.findDescendantById(`${rowId(rootKey)}-disclosure`)!;
  expect(disclosure.width).toBe(3);
  await capture(`guided-tree-${width}x${height}`);
  await setup!.mockMouse.click(disclosure.screenX + 2, disclosure.screenY);
  await setup!.flush();
  const skillKey = JSON.stringify([rootKey, "skill", "guide", "team-main", "guide"]);
  expect(
    (
      setup!.renderer.root.findDescendantById(`${rowId(skillKey)}-kind`) as TextRenderable
    ).plainText.trim(),
  ).toBe("S");
  expect(
    (setup!.renderer.root.findDescendantById("current-exposure-browser") as ScrollBoxRenderable)
      .viewport.height,
  ).toBeGreaterThanOrEqual(3);
  const skillName = setup!.renderer.root.findDescendantById(`${rowId(skillKey)}-name`)!;
  await setup!.mockMouse.click(skillName.screenX + 1, skillName.screenY);
  await parsedEnter(setup!);
  await waitForReaderBody(setup!, "Usage instructions.");
  await capture(`reader-readable-${width}x${height}`);
});

test.each([
  [144, 40],
  [100, 24],
])(
  "Collection reference separates identity, origin and bounded description at %ix%i",
  async (width, height) => {
    await mount(width, height);
    await parsedEnter(setup!);
    setup!.mockInput.pressArrow("down");
    await setup!.waitFor(
      () =>
        (setup!.renderer.root.findDescendantById("agent-node-title") as TextRenderable)
          ?.plainText === "domain-driven-design",
    );
    await setup!.flush();
    expect(setup!.captureCharFrame()).not.toContain("domain-driven-design → domain-driven-design");
    expect(setup!.captureCharFrame()).toContain("From 产品构思");
    const descriptionText = setup!.renderer.root.findDescendantById(
      "agent-node-description-text",
    ) as TextRenderable;
    expect(descriptionText.plainText).toBe(description);
    expect(descriptionText.width).toBeLessThanOrEqual(88);
    const title = setup!.renderer.root.findDescendantById("agent-node-title")!;
    const details = setup!.renderer.root.findDescendantById("agent-access-collection-details")!;
    expect(details.screenY).toBe(title.screenY);
    expect(descriptionText.screenY).toBeGreaterThan(title.screenY + 1);
    await capture(`collection-readable-${width}x${height}`);
    await focusLive(setup!, "agent-node-description");
    setup!.mockInput.pressKey("PAGEDOWN");
    await setup!.renderOnce();
    expect(setup!.renderer.currentFocusedRenderable?.id).toBe("agent-node-description");
  },
);
