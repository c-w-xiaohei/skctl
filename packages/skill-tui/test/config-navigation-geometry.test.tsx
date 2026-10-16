/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { enterLive, focusLive, parsedEnter } from "./reader-test-controls";

for (const level of ["global", "project", "local"] as const) {
  test.each([132, 139, 140, 144, 150, 100, 80, 79, 43])(
    `all ${level} configuration page tabs fit without moving chrome at %i columns`,
    async (width) => {
      const setup = await testRender(
        () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
        { width, height: 24 },
      );
      const geometry = () =>
        ["section-nav", "shell-context-panel", "shell-activity"].map((id) => {
          const node = setup.renderer.root.findDescendantById(id)!;
          return [node.screenX, node.screenY, node.width, node.height];
        });
      try {
        await setup.flush();
        const before = geometry();
        await enterLive(setup, "shell-scope-select");
        const choices = setup.renderer.root.findDescendantById("scope-choices") as SelectRenderable;
        const index = choices.options.findIndex((option) => option.value === level);
        expect(index).toBeGreaterThanOrEqual(0);
        await focusLive(setup, choices.id);
        for (let step = 0; step < index; step++) {
          setup.mockInput.pressArrow("down");
          await setup.flush();
        }
        await parsedEnter(setup);
        await setup.flush();
        const viewport = setup.renderer.root.findDescendantById("section-nav")!;
        for (const page of ["sources", "config-sources", "collections", "integrations"]) {
          const tab = setup.renderer.root.findDescendantById(`shell-section-${level}-tab-${page}`)!;
          expect(tab).toBeDefined();
          expect(tab.screenY).toBe(0);
          expect(tab.screenX).toBeGreaterThanOrEqual(viewport.screenX);
          expect(tab.screenX + tab.width).toBeLessThanOrEqual(viewport.screenX + viewport.width);
        }
        expect(geometry()).toEqual(before);
        if (width >= 132) expect(setup.captureCharFrame().split("\n")[0]).toContain("Integrations");
        else expect(setup.captureCharFrame().split("\n")[0]).toContain("Agents");
        await enterLive(setup, `shell-section-${level}-tab-integrations`);
        await setup.flush();
        expect(geometry()).toEqual(before);
        if (process.env.PAGE_INTERACTION_CAPTURE_DIR) {
          const directory = process.env.PAGE_INTERACTION_CAPTURE_DIR;
          await mkdir(directory, { recursive: true });
          await writeFile(
            join(directory, `config-chrome-${level}-${width}.txt`),
            setup.captureCharFrame(),
          );
          await writeFile(
            join(directory, `config-chrome-${level}-${width}.json`),
            JSON.stringify(setup.captureSpans(), null, 2),
          );
        }
      } finally {
        setup.renderer.destroy();
      }
    },
  );
}
