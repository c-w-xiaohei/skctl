/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { WorkspaceView } from "@skill-cli/core";
import { App } from "../src/app";
import { exposureTreePathKey } from "../src/collections/agent-access-tree";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection, readerSecondAddress } from "./installed-reader.fixture";
import {
  enterLive,
  focusLive,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  parsedEscape,
  waitForReaderBody,
} from "./reader-test-controls";

async function openSources(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-sources"));
  await enterLive(setup, "shell-section-tab-sources");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
}

test("Source updates replace the browser and Back restores its exact selected Source after resize", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openSources(setup);
    const browser = (await focusLive(setup, "source-browser")) as SelectRenderable;
    browser.setSelectedIndex(browser.options.findIndex((option) => option.value === "team-main"));
    await setup.flush();
    await focusLive(setup, "source-browser");
    const selected = browser.getSelectedOption()?.value;
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-updates-page"));
    expect(setup.renderer.root.findDescendantById("source-browser")).toBeUndefined();
    setup.resize(80, 16);
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("source-updates-page")).toBeDefined();
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    expect(
      (
        setup.renderer.root.findDescendantById("source-browser") as SelectRenderable
      ).getSelectedOption()?.value,
    ).toBe(selected);
  } finally {
    setup.renderer.destroy();
  }
});

test("Agent access opens the exact structural Skill while preserving an All Skills filter and checked state", async () => {
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const projection: WorkspaceView = {
    ...base,
    effective: {
      ...base.effective,
      managed: true,
      agent: { ...base.effective.agent, status: "available" as const },
      use: ["root"],
      collections: ["root"],
      collectionsView: [
        {
          id: "root",
          declared: [],
          repository: { derived: false, producers: [] },
          members: [{ name: "reference", address: readerSecondAddress, paths: [] }],
          references: [],
          links: [],
        },
      ],
    },
  };
  const checks: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, {
          installed: {
            checkUpdate: async ({ source }) => {
              checks.push(source);
              return {
                value: {
                  source,
                  kind: "github" as const,
                  baseline: "baseline:test",
                  exactRevision: "a".repeat(40),
                  changed: [],
                  added: [],
                  removed: [],
                  unchanged: [],
                },
                diagnostics: [],
              };
            },
            load: async ({ address }) => ({
              address,
              name: address.path,
              description: "",
              rawText: `Body ${address.path}`,
              markdownText: `# ${address.path}\n\nBody ${address.path}`,
            }),
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    const all = await openAllInstalledSkills(setup);
    setup.mockInput.pressKey(" ");
    await setup.waitFor(() => all.options[0]?.name.startsWith("✓ "));
    await focusLive(setup, "skills-query");
    await setup.mockInput.typeText("guide");
    await setup.waitFor(
      () =>
        (setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value ===
        "guide",
    );
    expect(all.options).toHaveLength(1);
    await enterLive(setup, "skills-view-tab-current-exposure");
    const rootKey = exposureTreePathKey({ segments: [{ collection: "root" }] });
    const skillKey = JSON.stringify([
      rootKey,
      "skill",
      "reference",
      readerSecondAddress.source,
      readerSecondAddress.path,
    ]);
    await focusLive(setup, "current-exposure-browser");
    await parsedEnter(setup);
    const exactName = `current-exposure-browser-row-${encodeURIComponent(skillKey)}-name`;
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById(exactName));
    const row = setup.renderer.root.findDescendantById(exactName)!;
    await setup.mockMouse.click(row.screenX, row.screenY);
    await waitForReaderBody(setup, "Body reference");
    await openReaderTab(setup, 2);
    await setup.waitForFrame((frame) =>
      frame.includes(`${readerSecondAddress.source}/${readerSecondAddress.path}`),
    );
    expect(setup.captureCharFrame()).not.toContain(`${readerSecondAddress.source}/guide`);
    await enterLive(setup, "reader-action-skill-check-updates");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-page"));
    expect(checks.every((source) => source === readerSecondAddress.source)).toBe(true);
    expect(checks).toContain(readerSecondAddress.source);
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("current-exposure-browser"));
    await enterLive(setup, "skills-view-tab-all-installed-skills");
    const restored = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    expect(restored.options).toHaveLength(1);
    expect(restored.getSelectedOption()?.value).toBe(JSON.stringify(["team-main", "guide"]));
    expect(restored.getSelectedOption()?.name).toStartWith("✓ ");
    expect((setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value).toBe(
      "guide",
    );
  } finally {
    setup.renderer.destroy();
  }
});

for (const originKind of ["direct", "via-link"] as const) {
  test(`${originKind} Collection membership keeps the exact colliding member address through Reader Details and Back`, async () => {
    const base = readerProjection();
    if (base.effective.status !== "complete") throw new Error("expected complete fixture");
    const owner = {
      level: "project" as const,
      file: "/workspace/skill-cli/skill-cli.jsonc",
      pointer: "/collections/team",
    };
    const origins =
      originKind === "direct"
        ? [{ kind: "direct" as const, collection: "team", entryName: "reference", owner }]
        : [
            {
              kind: "via-link" as const,
              links: [{ collection: "team", linkedCollection: "linked", owner }],
            },
          ];
    const projection: WorkspaceView = {
      ...base,
      effective: {
        ...base.effective,
        collections: ["team"],
        collectionsView: [
          {
            id: "team",
            declared: [owner],
            repository: { derived: false, producers: [] },
            members: [{ name: "reference", address: readerSecondAddress, paths: origins }],
            references: [],
            links: [],
          },
        ],
      },
    };
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(projection, {
            installed: {
              load: async ({ address }) => ({
                address,
                name: address.path,
                description: "",
                rawText: `Body ${address.path}`,
                markdownText: `# ${address.path}\n\nBody ${address.path}`,
              }),
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await enterLive(setup, "shell-section-tab-collections");
      await enterLive(setup, "collection-browser");
      const rows = (await focusLive(setup, "collection-relationships")) as SelectRenderable;
      await setup.waitFor(() => rows.options.some((option) => option.value.includes("reference")));
      await parsedEnter(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("collection-membership-inspector"),
      );
      await enterLive(setup, "membership.open-skill");
      await waitForReaderBody(setup, "Body reference");
      await openReaderTab(setup, 2);
      await setup.waitForFrame((frame) =>
        frame.includes(`${readerSecondAddress.source}/${readerSecondAddress.path}`),
      );
      expect(setup.captureCharFrame()).not.toContain("team-main/guide");
      await enterLive(setup, "route-back");
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("collection-membership-inspector"),
      );
      expect(setup.captureCharFrame()).toContain("In team");
    } finally {
      setup.renderer.destroy();
    }
  });
}
