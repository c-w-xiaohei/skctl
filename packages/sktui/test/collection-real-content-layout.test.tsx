/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { BoxRenderable, Renderable, ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { mkdir, writeFile } from "node:fs/promises";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { openMainPage } from "./main-page-controls";
import { collectionFilterPathKey } from "../src/collections/collection-filter-tree";
import { enterLive, parsedEnter, parsedEscape } from "./reader-test-controls";

const collectionId = "aaron-marketing-email";
const skillName = "email-creative-builder";
const address = { source: "aaron-marketing", path: `email/${skillName}` };
const description =
  'Use when the user asks to "write the email", "draft subject lines", or "build email creative"; produces the pre-click unit — subject-line variants + preheader + body copy, one clear CTA, and a plain-text alt — message-matched to the destination page and claims-ledger-aware. Not for pre-scoring or ranking subject-line variants (spam/truncation/render pre-score) — use subject-line-lab; not for scoring the email or computing EQS — use email-quality-auditor; not for a multi-step flow — use email-sequence-designer; not for the A/B test plan — use send-experiment-designer. 邮件文案/主题行/邮件创意';

function projection() {
  const base = collectionsSourcesProjection();
  if (base.effective.status !== "complete") throw new Error("Complete fixture required");
  const owner = {
    level: "global" as const,
    file: "/home/user/.config/skctl/config.json",
    pointer: `/collections/${collectionId}/members/${skillName}`,
  };
  const member = {
    name: skillName,
    address,
    paths: [{ kind: "direct" as const, collection: collectionId, entryName: skillName, owner }],
  };
  const members = [
    member,
    ...[
      "cold-outbound-sequencer",
      "deliverability-qa",
      "dynamic-email-personalizer",
      "email-quality-auditor",
      "email-render-preflight",
      "email-sequence-designer",
      "inbox-placement-diagnoser",
      "list-hygiene-operator",
      "send-experiment-designer",
    ].map((name) => ({
      ...member,
      name,
      address: { ...address, path: `email/${name}` },
      paths: member.paths.map((path) => ({
        ...path,
        entryName: name,
        owner: { ...owner, pointer: `/collections/${collectionId}/members/${name}` },
      })),
    })),
  ];
  return {
    ...base,
    installedSkills: members.map((item) => ({
      ...base.installedSkills[0]!,
      name: item.name,
      address: item.address,
      description,
      collections: [{ id: collectionId, entry: item.name, paths: item.paths }],
    })),
    effective: {
      ...base.effective,
      collections: [collectionId],
      collectionsView: [
        {
          ...base.effective.collectionsView[0]!,
          id: collectionId,
          members,
          references: [],
          links: [],
          declared: [{ ...owner, pointer: `/collections/${collectionId}` }],
        },
      ],
    },
  };
}

test("real Collection copy stays inside the terminal and single ownership stays in the member workspace", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection(), {
          checkUpdate: async (_environment, _request, context) =>
            new Promise((_resolve, reject) => {
              context?.signal?.addEventListener(
                "abort",
                () => reject(new Error("Stopped fixture check")),
                { once: true },
              );
            }),
        })}
        exit={() => {}}
      />
    ),
    { width: 140, height: 32 },
  );
  try {
    await openMainPage(setup, "collections");
    const rowId = `collection-browser-row-${encodeURIComponent(collectionFilterPathKey({ segments: [{ collection: collectionId }] }))}-name`;
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById(rowId));
    const row = setup.renderer.root.findDescendantById(rowId)!;
    await setup.mockMouse.click(row.screenX + 1, row.screenY);
    await setup.flush();
    await mkdir("out/collection-overflow", { recursive: true });
    await writeFile("out/collection-overflow/members.txt", setup.captureCharFrame());
    const geometry = () =>
      [
        "route-shell",
        "global-bar",
        "section-nav",
        "collections-list-pane",
        "collection-detail-pane",
        "collection-relationships",
      ].flatMap((id) => {
        const node = setup.renderer.root.findDescendantById(id);
        return node
          ? [{ id, x: node.screenX, width: node.width, right: node.screenX + node.width }]
          : [];
      });
    for (const width of [140, 120, 110, 100, 80, 60, 43, 140]) {
      setup.resize(width, 16);
      await setup.flush();
      if (!setup.renderer.root.findDescendantById("collection-detail-pane")) {
        const browser = setup.renderer.root.findDescendantById("collection-browser")!;
        await setup.mockMouse.click(browser.screenX + 5, browser.screenY);
        await parsedEnter(setup);
        await setup.flush();
      }
      for (const node of geometry().filter((node) => node.width > 0)) {
        expect(node.x, `${width}: ${node.id}`).toBeGreaterThanOrEqual(0);
        expect(node.right, `${width}: ${node.id}`).toBeLessThanOrEqual(width);
      }
      for (const id of [
        "shell-section-tab-skills",
        "shell-section-tab-settings",
        "shell-pages-select",
        "collection-current-membership.open-owner",
        "process-status",
      ]) {
        const node = setup.renderer.root.findDescendantById(id);
        if (!node || !node.visible) continue;
        expect(node.screenX, `${width}: ${id}`).toBeGreaterThanOrEqual(0);
        expect(node.screenX + node.width, `${width}: ${id}`).toBeLessThanOrEqual(width);
      }
      const pane = setup.renderer.root.findDescendantById("collection-detail-pane");
      if (pane) {
        const overflowing: string[] = [];
        const inspect = (node: import("@opentui/core").BaseRenderable) => {
          if (
            node instanceof Renderable &&
            node.visible &&
            node.height > 0 &&
            node.screenY >= pane.screenY &&
            node.screenY < pane.screenY + pane.height &&
            node.screenX + node.width > pane.screenX + pane.width
          )
            overflowing.push(`${node.id}:${node.screenX}+${node.width}`);
          node.getChildren().forEach(inspect);
        };
        inspect(pane);
        expect(overflowing, `right overflow at ${width}`).toEqual([]);
      }
      await writeFile(`out/collection-overflow/${width}-members.txt`, setup.captureCharFrame());
    }
    const ownership = setup.renderer.root.findDescendantById("collection-current-details");
    if (ownership) {
      await setup.mockMouse.click(ownership.screenX + 1, ownership.screenY);
      await setup.flush();
    }
    await writeFile("out/collection-overflow/origin.txt", setup.captureCharFrame());
    expect(!!setup.renderer.root.findDescendantById("collection-relationships")).toBe(true);
    expect(
      setup.renderer.root.findDescendantById("collection-inspector-surface")!.height,
    ).toBeLessThanOrEqual(14);
    expect(setup.renderer.root.findDescendantById("membership.open-owner")).toBeInstanceOf(
      BoxRenderable,
    );
    for (const width of [80, 43]) {
      setup.resize(width, 13);
      await setup.flush();
      for (const id of ["membership.open-owner"]) {
        const action = setup.renderer.root.findDescendantById(id)!;
        expect(action.screenX + action.width, `${width}: ${id}`).toBeLessThanOrEqual(width - 2);
        expect(action.screenY + action.height, `${width}: ${id}`).toBeLessThanOrEqual(11);
        expect(action.height).toBe(1);
      }
      const body = setup.renderer.root.findDescendantById(
        "collection-membership-inspector",
      ) as ScrollBoxRenderable;
      body.scrollTo(body.scrollHeight);
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("builder");
      await writeFile(`out/collection-overflow/${width}-origin.txt`, setup.captureCharFrame());
    }
    setup.resize(140, 16);
    await setup.flush();
    await parsedEscape(setup);
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("collection-inspector-surface")).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-relationships");
    const table = setup.renderer.root.findDescendantById("collection-relationships")!;
    table.focus();
    setup.mockInput.pressArrow("down");
    await setup.flush();
    expect(!!setup.renderer.root.findDescendantById("collection-inspector-surface")).toBe(false);
    expect(setup.captureCharFrame()).toContain("cold-outbound");
    await enterLive(setup, "collection-tabs-tab-description");
    await setup.flush();
    expect(!!setup.renderer.root.findDescendantById("collection-inspector-surface")).toBe(false);
    expect(!!setup.renderer.root.findDescendantById("collection-description")).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});
