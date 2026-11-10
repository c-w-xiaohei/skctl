import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { Breadcrumbs } from "../src/ui/breadcrumbs";
import { createFocusRegistry } from "../src/focus";
import { enterLive } from "./reader-test-controls";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { openMainPage } from "./main-page-controls";
import { TextRenderable, type BaseRenderable } from "@opentui/core";
import { mkdir, writeFile } from "node:fs/promises";

test("inventory breadcrumbs follow visible objects consistently across wide and narrow pages", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
    { width: 144, height: 30 },
  );
  const text = (node: BaseRenderable): string =>
    node instanceof TextRenderable ? node.plainText : node.getChildren().map(text).join("");
  try {
    for (const [page, browser] of [
      ["skills", "installed-skill-browser"],
      ["collections", "collection-browser"],
      ["sources", "source-browser"],
    ] as const) {
      setup.resize(144, 30);
      await setup.flush();
      await openMainPage(setup, page);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById(browser));
      await setup.flush();
      const path = () => text(setup.renderer.root.findDescendantById("workspace-breadcrumbs")!);
      expect(path()).toContain("›");
      const widePath = path();
      setup.renderer.root.findDescendantById(browser)!.focus();
      await setup.flush();
      expect(path()).toBe(widePath);
      await enterLive(setup, "breadcrumb-0");
      await setup.flush();
      expect(path()).toBe(widePath);
      await mkdir("out/navigation-consistency", { recursive: true });
      await writeFile(`out/navigation-consistency/${page}-144x30.txt`, setup.captureCharFrame());
      setup.resize(43, 13);
      await setup.flush();
      expect(path()).toBe(page[0]!.toUpperCase() + page.slice(1));
      await enterLive(setup, browser);
      expect(path()).toContain("›");
      await enterLive(setup, "breadcrumb-0");
      await setup.flush();
      expect(path()).toBe(page[0]!.toUpperCase() + page.slice(1));
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("breadcrumb ancestors navigate and narrow paths retain the current item within the row", async () => {
  const calls: string[] = [];
  const setup = await testRender(
    () => (
      <Breadcrumbs
        focusRegistry={createFocusRegistry()}
        items={[
          { label: "Skills", select: () => calls.push("root") },
          { label: "team-main/guide", select: () => calls.push("skill") },
          { label: "Resources", select: () => calls.push("resources") },
          { label: "config.json" },
        ]}
      />
    ),
    { width: 100, height: 3 },
  );
  try {
    await setup.flush();
    await enterLive(setup, "breadcrumb-1");
    expect(calls).toEqual(["skill"]);
    setup.resize(28, 3);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("config.json");
    expect(setup.captureCharFrame()).toContain("…");
    expect(setup.captureCharFrame()).not.toContain("team-main");
    await enterLive(setup, "breadcrumb-0");
    expect(calls).toEqual(["skill", "root"]);
  } finally {
    setup.renderer.destroy();
  }
});
