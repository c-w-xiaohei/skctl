import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { mkdir, writeFile } from "node:fs/promises";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { openMainPage } from "./main-page-controls";
import { enterLive, openAllInstalledSkills } from "./reader-test-controls";

for (const height of [13, 18, 20, 23, 24, 40]) {
  test(`workspace tools are contiguous with one body gap only at normal height ${height}`, async () => {
    const setup = await testRender(
      () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
      { width: 144, height },
    );
    const node = (id: string) => {
      const value = setup.renderer.root.findDescendantById(id);
      if (!value) throw new Error(`Missing ${id}`);
      return value;
    };
    const gap = height >= 24 ? 1 : 0;
    const capture = async (page: string) => {
      await setup.flush();
      await mkdir("out/workspace-density", { recursive: true });
      await writeFile(`out/workspace-density/${page}-144x${height}.txt`, setup.captureCharFrame());
    };
    try {
      await openAllInstalledSkills(setup);
      expect(node("skills-query").screenY).toBe(node("skills-browser-more").screenY + 1);
      expect(node("installed-skill-browser").screenY).toBe(node("skills-query").screenY + 1 + gap);
      await enterLive(setup, "installed-skill-browser");
      expect(node("reader-object-actions").screenY).toBe(node("reader-identity-row").screenY + 1);
      expect(node("reader-tools").screenY).toBe(node("reader-object-actions").screenY + 1);
      await capture("skills");
      await openMainPage(setup, "sources");
      expect(node("source-view").screenY).toBe(node("source-content-controls-pane").screenY + 1);
      expect(node("source-content-controls-pane").screenY).toBe(
        node("source-details-pane").screenY + (height >= 24 ? 2 : 1),
      );
      await capture("sources");
      await openMainPage(setup, "collections");
      expect(node("collections-query").screenY).toBe(node("collections-browser-more").screenY + 1);
      expect(node("collection-browser").screenY).toBe(node("collections-query").screenY + 1 + gap);
      await enterLive(setup, "collection-browser");
      expect(node("collection-tabs-tab-members").screenY).toBe(
        node("collection-toolbar").screenY + 1,
      );
      expect(node("collection-relationships").screenY).toBe(
        node("collection-tabs-tab-members").screenY + 1 + gap,
      );
      await capture("collections");
      await openMainPage(setup, "settings");
      expect(node("settings-categories").screenY).toBe(
        node("config-browser-pane").screenY + (height >= 24 ? 2 : 1) + gap,
      );
      await capture("settings");
      await openMainPage(setup, "agent");
      await enterLive(setup, "agent-view-tab-global");
      expect(node("integration-actions-pane").screenY).toBe(
        node("integration-object-pane").screenY + (height >= 24 ? 2 : 1),
      );
      expect(node("integration-entries-pane").screenY).toBe(
        node("integration-actions-pane").screenY + 1 + gap,
      );
      await capture("agent");
      await openMainPage(setup, "updates");
      const actions = node("updates-actions-pane");
      expect(node("updates-data-pane").screenY).toBe(actions.screenY + actions.height + gap);
      await capture("updates");
    } finally {
      setup.renderer.destroy();
    }
  });
}
