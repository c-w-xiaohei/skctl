import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import { enterLive, openAllInstalledSkills, parsedEnter } from "./reader-test-controls";

test("Markdown source survives resize and the same More action returns to formatted content", async () => {
  let loads = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => {
            loads++;
            return readerContent;
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await openAllInstalledSkills(setup);
    await parsedEnter(setup);
    await enterLive(setup, "reader-more");
    await enterLive(setup, "reader-menu-raw");
    await setup.waitForFrame((frame) => frame.includes("title: Guide"));
    for (const width of [79, 43, 80, 120]) {
      setup.resize(width, 24);
      await setup.flush();
      expect(setup.renderer.root.findDescendantById("reader-line-0")).toBeDefined();
      const more = setup.renderer.root.findDescendantById("reader-more")!;
      expect(more.width).toBeGreaterThan(0);
      expect(more.screenX + more.width).toBeLessThanOrEqual(width);
    }
    await enterLive(setup, "reader-more");
    await enterLive(setup, "reader-menu-raw");
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("reader-line-0"));
    expect(loads).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});
