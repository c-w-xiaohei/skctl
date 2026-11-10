import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { mkdir, writeFile } from "node:fs/promises";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { enterLive, filterUncollectedSkills, openAllInstalledSkills } from "./reader-test-controls";

for (const [width, height] of [
  [120, 30],
  [100, 24],
  [43, 13],
]) {
  test(`Skills keeps a quiet fixed header before and after filtering at ${width}x${height}`, async () => {
    const setup = await testRender(
      () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
      { width, height },
    );
    try {
      await openAllInstalledSkills(setup);
      const node = (id: string) => setup.renderer.root.findDescendantById(id)!;
      const queryY = node("skills-query").screenY;
      const listY = node("installed-skill-browser").screenY;
      expect(queryY).toBe(node("skills-browser-more").screenY + 1);
      expect(listY).toBe(queryY + 1 + (height >= 24 ? 1 : 0));
      expect(node("installed-skill-browser").height).toBeGreaterThanOrEqual(6);
      expect(node("install-skills")).toBeUndefined();
      await mkdir("out/skills-quiet", { recursive: true });
      await writeFile(`out/skills-quiet/default-${width}x${height}.txt`, setup.captureCharFrame());
      await filterUncollectedSkills(setup);
      expect(node("skills-query").screenY).toBe(queryY);
      expect(node("installed-skill-browser").screenY).toBe(listY);
      expect(node("skills-filter-chips")).toBeUndefined();
      await writeFile(`out/skills-quiet/filtered-${width}x${height}.txt`, setup.captureCharFrame());
      await enterLive(setup, "skills-browser-more");
      await enterLive(setup, "skills-browser-more-workspace.collections.open");
      await setup.waitFor(() => !!node("collection-filter-tree"));
    } finally {
      setup.renderer.destroy();
    }
  });
}
