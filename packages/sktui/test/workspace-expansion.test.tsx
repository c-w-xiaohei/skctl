import { expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection, readerResources } from "./installed-reader.fixture";
import {
  enterLive,
  focusLive,
  live,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  parsedEscape,
} from "./reader-test-controls";
import { openMainPage } from "./main-page-controls";
import { openSettingsCategory } from "./settings-test-controls";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";

test("Collection Instructions and Settings retain the same view command without member actions", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await openMainPage(setup, "collections");
    await enterLive(setup, "collection-browser");
    for (const tab of ["description", "settings"]) {
      await enterLive(setup, `collection-tabs-tab-${tab}`);
      await enterLive(setup, "collection-more");
      expect(!!setup.renderer.root.findDescendantById("collection-current-details")).toBe(false);
      await enterLive(setup, "collection-current-workspace.toggle-view");
      await setup.waitFor(() => live(setup, "collection-detail-pane").width > 100);
      await parsedEscape(setup);
      await setup.waitFor(() => live(setup, "collection-detail-pane").width < 100);
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("resizing away from a wide More menu closes it without reopening on restore", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await openMainPage(setup, "sources");
    await enterLive(setup, "source-browser");
    await enterLive(setup, "source-more");
    setup.resize(43, 30);
    await setup.flush();
    setup.resize(120, 30);
    await setup.flush();
    expect(!!setup.renderer.root.findDescendantById("source-more-dialog")).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

test("Updates source navigation shares the width preference and expands the same change table", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await openMainPage(setup, "updates");
    await enterLive(setup, "updates-browser");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-updates-browser"));
    expect(live(setup, "updates-sources-pane").width).toBe(38);
    const table = live(setup, "source-updates-browser");
    const width = table.width;
    await enterLive(setup, "source-updates-more");
    await enterLive(setup, "source-updates-more-view");
    await setup.waitFor(() => table.width > width);
    expect(live(setup, "source-updates-browser") === table).toBe(true);
    await parsedEscape(setup);
    await setup.waitFor(() => table.width === width);
    await focusLive(setup, "source-updates-browser");
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
  } finally {
    setup.renderer.destroy();
  }
});

test("narrow Back reaches the Skills list while retaining the wide expansion intent", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterLive(setup, "installed-skill-browser");
    await enterLive(setup, "reader-more");
    await enterLive(setup, "reader-menu-view");
    setup.resize(43, 30);
    await setup.flush();
    await focusLive(setup, "reader-scrollbox");
    await parsedEscape(setup);
    await setup.waitForFrame((frame) => frame.includes("Skills (2)"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
    await parsedEnter(setup);
    setup.resize(120, 30);
    await setup.flush();
    expect(live(setup, "reader-pane").width).toBeGreaterThan(100);
  } finally {
    setup.renderer.destroy();
  }
});

test("Reader expands the same body, retains its position through page changes and resize, and Back restores split first", async () => {
  let reads = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => {
            reads++;
            return {
              ...readerContent,
              markdownText: Array.from({ length: 100 }, (_, i) => `Line ${i}`).join("\n\n"),
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterLive(setup, "installed-skill-browser");
    await focusLive(setup, "reader-scrollbox");
    const body = live(setup, "reader-scrollbox") as ScrollBoxRenderable;
    body.scrollTo(20);
    await setup.flush();
    const width = body.width;
    const scroll = body.scrollTop;
    await enterLive(setup, "reader-more");
    await enterLive(setup, "reader-menu-view");
    await setup
      .waitFor(() => body.width > width)
      .catch((cause) => {
        throw new Error(`expand ${body.width}/${width}\n${setup.captureCharFrame()}`, { cause });
      });
    expect(live(setup, "reader-scrollbox") === body).toBe(true);
    expect(body.scrollTop).toBe(scroll);
    await openMainPage(setup, "sources");
    await openMainPage(setup, "skills");
    await setup
      .waitFor(() => live(setup, "reader-scrollbox").width > width)
      .catch((cause) => {
        throw new Error(`page restore\n${setup.captureCharFrame()}`, { cause });
      });
    expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("installed-skill-browser");
    setup.resize(43, 30);
    await setup.flush();
    await enterLive(setup, "reader-more");
    expect(!!setup.renderer.root.findDescendantById("reader-menu-view")).toBe(false);
    await parsedEscape(setup);
    setup.resize(120, 30);
    await setup.flush();
    expect(live(setup, "reader-scrollbox").width).toBeGreaterThan(width);
    await focusLive(setup, "reader-scrollbox");
    await parsedEscape(setup);
    await setup
      .waitFor(() => live(setup, "reader-scrollbox").width === width)
      .catch((cause) => {
        throw new Error(`split restore\n${setup.captureCharFrame()}`, { cause });
      });
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(reads).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("expanded Reader closes its resource before restoring split and exposes Restore split through Actions", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          listInstalledResources: async () => readerResources,
          readInstalledResource: async (_environment, request) => ({
            kind: "text",
            path: request.path,
            format: "text",
            text: "Resource body",
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterLive(setup, "installed-skill-browser");
    const width = live(setup, "reader-pane").width;
    await enterLive(setup, "reader-more");
    await enterLive(setup, "reader-menu-view");
    await openReaderTab(setup, 1);
    const resources = (await focusLive(setup, "resource-browser")) as SelectRenderable;
    resources.setSelectedIndex(
      resources.options.findIndex((option) => option.value === "docs/guide.md"),
    );
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Resource body"));
    await focusLive(setup, "resource-content");
    await parsedEscape(setup);
    expect(!!setup.renderer.root.findDescendantById("resource-content")).toBe(false);
    expect(live(setup, "reader-pane").width).toBeGreaterThan(width);
    await enterLive(setup, "shell-more-actions");
    const choices = (await focusLive(setup, "palette-choices")) as SelectRenderable;
    const index = choices.options.findIndex(
      (option) => option.value.id === "workspace.toggle-view",
    );
    expect(index).toBeGreaterThanOrEqual(0);
    expect(choices.options[index]!.value.verb).toBe("Restore split");
    choices.setSelectedIndex(index);
    await parsedEnter(setup);
    await setup.waitFor(() => live(setup, "reader-pane").width === width);
  } finally {
    setup.renderer.destroy();
  }
});

test("Agent catalog expands the same preview and connections restore their host list", async () => {
  const base = collectionsSourcesProjection();
  if (base.effective.status !== "complete") throw new Error("Expected complete fixture");
  const effective = base.effective;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore({
          ...base,
          effective: {
            ...effective,
            agent: { ...effective.agent, status: "available" },
            use: ["team"],
          },
        })}
        integrations={{
          inspect: async (target) => ({
            target,
            recommended: "default",
            selectionReason: "Instruction file",
            cli: "/bin/skctl",
            revision: "one",
            entries: [],
            candidates: [],
            diagnostics: [],
            nextSteps: [],
          }),
          connect: async () => {
            throw new Error("Unexpected mutation");
          },
          disconnect: async () => {
            throw new Error("Unexpected mutation");
          },
        }}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await openMainPage(setup, "agent");
    await enterLive(setup, "current-exposure-browser");
    const preview = live(setup, "agent-node-description");
    const width = preview.width;
    await enterLive(setup, "agent-node-more");
    await enterLive(setup, "agent-node-more-view");
    await setup.waitFor(() => preview.width > width);
    expect(live(setup, "agent-node-description") === preview).toBe(true);
    setup.resize(43, 30);
    await setup.flush();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "agent-node-description",
    );
    setup.resize(120, 30);
    await setup.flush();
    await parsedEscape(setup);
    await setup.waitFor(() => preview.width === width);
    await enterLive(setup, "agent-view-tab-global");
    await enterLive(setup, "integration-hosts");
    const object = live(setup, "integration-object-pane");
    const hostWidth = object.width;
    await enterLive(setup, "integration-more");
    await enterLive(setup, "integration-more-view");
    await setup.waitFor(() => object.width > hostWidth);
    setup.resize(43, 30);
    await setup.flush();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "integration-connect",
    );
    setup.resize(120, 30);
    await setup.flush();
    await parsedEscape(setup);
    await setup.waitFor(() => object.width === hostWidth);
    expect(live(setup, "integration-object-pane") === object).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});

test.each([
  ["sources", "source-browser", "source-details-pane", "source-more", "source-more-view"],
  [
    "collections",
    "collection-browser",
    "collection-detail-pane",
    "collection-more",
    "collection-current-workspace.toggle-view",
  ],
  ["settings", "config-source-browser", "config-object-pane", "config-more", "config-more-view"],
] as const)(
  "%s expands its existing object and restores split before returning",
  async (page, browserId, objectId, moreId, viewId) => {
    const setup = await testRender(
      () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
      { width: 120, height: 30 },
    );
    try {
      await openMainPage(setup, page);
      if (page === "settings") await openSettingsCategory(setup, "sources");
      await enterLive(setup, browserId);
      const object = live(setup, objectId);
      const width = object.width;
      await enterLive(setup, moreId);
      await enterLive(setup, viewId);
      await setup.waitFor(() => live(setup, objectId).width > width);
      expect(live(setup, objectId) === object).toBe(true);
      await enterLive(setup, moreId);
      await enterLive(setup, "route-back");
      expect(!!setup.renderer.root.findDescendantById(viewId)).toBe(false);
      expect(live(setup, objectId).width).toBeGreaterThan(width);
      await parsedEscape(setup);
      await setup.waitFor(() => live(setup, objectId).width === width);
      expect(live(setup, objectId) === object).toBe(true);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test.each([
  ["sources", "source-browser", "source-details-pane", "source-more", "source-more-view"],
  [
    "collections",
    "collection-browser",
    "collection-detail-pane",
    "collection-more",
    "collection-current-workspace.toggle-view",
  ],
  ["settings", "config-source-browser", "config-object-pane", "config-more", "config-more-view"],
] as const)(
  "%s keeps narrow list navigation separate from its expansion intent",
  async (page, browserId, objectId, moreId, viewId) => {
    const setup = await testRender(
      () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
      { width: 120, height: 30 },
    );
    try {
      await openMainPage(setup, page);
      if (page === "settings") await openSettingsCategory(setup, "sources");
      await enterLive(setup, browserId);
      await enterLive(setup, moreId);
      await enterLive(setup, viewId);
      setup.resize(43, 30);
      await setup.flush();
      await enterLive(setup, "route-back");
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === browserId);
      const browser = live(setup, browserId);
      for (let node = browser; node.parent; node = node.parent) expect(node.visible).toBe(true);
      await parsedEnter(setup);
      setup.resize(120, 30);
      await setup.flush();
      expect(live(setup, objectId).width).toBeGreaterThan(100);
    } finally {
      setup.renderer.destroy();
    }
  },
);
