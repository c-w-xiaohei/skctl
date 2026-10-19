import { expect, test } from "bun:test";
import { SelectRenderable, TextRenderable, type BaseRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { WorkspaceView } from "@skctl/core";
import { createSignal } from "solid-js";
import { ConfigPage } from "../src/config-page";
import { createConfigState } from "../src/config/state";
import { workspaceProjection } from "./direct-source.fixture";
import { focusLive, parsedEnter } from "./reader-test-controls";

function contributionProjection(sourceIds: readonly string[], collectionIds: readonly string[]) {
  const base = workspaceProjection();
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              configSources: [
                {
                  id: "shared-config",
                  owner: {
                    level: "project" as const,
                    file: config.file.file,
                    pointer: "/configSources/shared-config",
                  },
                  binding: {
                    kind: "github" as const,
                    origin: "https://github.com/acme/shared-config",
                    root: "config",
                    ref: "release",
                  },
                  adoption: { status: "adopted" as const, commit: "abc123" },
                  contributed: {
                    sources: sourceIds.map((id) => ({
                      id,
                      kind: "github" as const,
                      origin: "https://github.com/acme/contributed",
                      root: "skills",
                      ref: "main",
                      provenance: { level: "project" as const },
                      contribution: {
                        configSource: {
                          level: "project" as const,
                          file: config.file.file,
                          pointer: "/configSources/shared-config",
                        },
                        declaration: { level: "project" as const, pointer: `/sources/${id}` },
                      },
                      selectors: [],
                    })),
                    collections: collectionIds.map((id) => ({
                      id,
                      owner: {
                        level: "project" as const,
                        file: config.file.file,
                        pointer: `/configSources/shared-config/collections/${id}`,
                      },
                    })),
                  },
                },
              ],
            },
          }
        : config,
    ),
  } satisfies WorkspaceView;
}

const cases = [
  { name: "zero contributions", sources: [], collections: [] },
  { name: "one contribution", sources: ["one-source"], collections: [] },
  {
    name: "many contributions with long IDs",
    sources: [
      "source-" + "s".repeat(84),
      ...Array.from({ length: 9 }, (_, index) => `source-${index}`),
    ],
    collections: ["collection-" + "c".repeat(82), "collection-two", "collection-three"],
  },
] as const;

for (const scenario of cases) {
  for (const size of [
    { name: "wide", width: 120, height: 40 },
    { name: "compact", width: 80, height: 16 },
    { name: "short", width: 52, height: 12 },
  ]) {
    test(`RENDER ${scenario.name} stays dense and hands off the selected item at ${size.name} size`, async () => {
      const [projection, setProjection] = createSignal<WorkspaceView>(
        contributionProjection(scenario.sources, scenario.collections),
      );
      const state = createConfigState();
      state.land("project", "config-sources", "/configSources/shared-config");
      state.openConfigSourceInspector("project");
      const handoffs: unknown[] = [];
      const setup = await testRender(
        () => (
          <ConfigPage
            config={state}
            projection={projection}
            destination="project"
            actions={[]}
            onSelect={() => {}}
            onAction={() => {}}
            onBackConfigSourceInspector={() => state.backConfigSourceSurface("project")}
            onContribution={(target) => handoffs.push(target)}
          />
        ),
        size,
      );
      try {
        await setup.renderOnce();
        const inspector = setup.renderer.root.findDescendantById("config-source-inspector")!;
        const textNodes = (node: BaseRenderable): string[] =>
          node.id === "config-source-contributions"
            ? []
            : [
                ...(node instanceof TextRenderable ? [node.plainText] : []),
                ...node.getChildren().flatMap(textNodes),
              ];
        const inspectorText = textNodes(inspector);
        expect(inspectorText).toContain("Contributed Sources  " + scenario.sources.length);
        expect(inspectorText).toContain("Contributed Collections  " + scenario.collections.length);
        expect(inspectorText).toContain(
          "Owner  /workspace/skctl/skctl.jsonc /configSources/shared-config",
        );
        expect(inspectorText).toContain("Canonical Origin  https://github.com/acme/shared-config");
        expect(inspectorText).toContain("Applied commit  abc123");
        if (scenario.name === "zero contributions" && size.name === "wide") {
          setProjection((current) => ({
            ...current,
            configs: current.configs.map((config) => ({
              ...config,
              direct: {
                ...config.direct,
                configSources: config.direct.configSources.map((source) => ({
                  ...source,
                  binding: { kind: "local" as const, path: "/live/config", root: "" },
                  adoption: { status: "live" as const },
                })),
              },
            })),
          }));
          await setup.waitFor(() => {
            const current = setup.renderer.root.findDescendantById("config-source-inspector");
            return !!current && textNodes(current).includes("Adoption  live");
          });
          const current = setup.renderer.root.findDescendantById("config-source-inspector")!;
          expect(textNodes(current)).toContain("Local path  /live/config");
          expect(textNodes(current)).toContain("Source Root  ");
          expect(
            textNodes(current).some((line) =>
              /Applied commit|Tracked ref|Canonical Origin/.test(line),
            ),
          ).toBe(false);
        }

        const names = [
          ...scenario.sources.map((id) => `Source  ${id}`),
          ...scenario.collections.map((id) => `Collection  ${id}`),
        ];
        for (const name of names) expect(inspectorText).not.toContain(name);
        const list = await focusLive(setup, "config-source-contributions");
        expect(list).toBeInstanceOf(SelectRenderable);
        const selectable = list as SelectRenderable;
        expect(selectable.options).toHaveLength(names.length);
        expect(selectable.options.map((option) => option.value)).toEqual([
          ...scenario.sources.map((_, index) => `source:${index}`),
          ...scenario.collections.map((_, index) => `collection:${index}`),
        ]);
        if (names.length > 0) {
          const targetIndex = 0;
          for (let index = 0; index < targetIndex; index += 1)
            await setup.mockInput.pressArrow("down");
          await setup.waitFor(() => {
            const workArea = setup.renderer.root.findDescendantById("config-work-area")!;
            return (
              selectable.getSelectedIndex() === targetIndex &&
              selectable.screenY >= workArea.screenY &&
              selectable.screenY + selectable.height <= workArea.screenY + workArea.height
            );
          });
          await parsedEnter(setup);
          expect(handoffs).toHaveLength(1);
          const expectedSource =
            targetIndex < scenario.sources.length ? scenario.sources[targetIndex] : undefined;
          if (expectedSource) {
            expect(handoffs[0]).toMatchObject({
              kind: "source",
              source: {
                id: expectedSource,
                origin: "https://github.com/acme/contributed",
                root: "skills",
              },
              owner: {
                file: "/workspace/skctl/skctl.jsonc",
                pointer: "/configSources/shared-config",
              },
            });
          } else {
            expect(handoffs[0]).toMatchObject({
              kind: "collection",
              collection: scenario.collections[targetIndex - scenario.sources.length],
              owner: {
                file: "/workspace/skctl/skctl.jsonc",
                pointer: `/configSources/shared-config/collections/${scenario.collections[targetIndex - scenario.sources.length]}`,
              },
            });
          }
          expect(selectable.getSelectedIndex()).toBe(targetIndex);
          if (scenario.name === "many contributions with long IDs" && scenario.collections.length) {
            handoffs.length = 0;
            const active = (await focusLive(
              setup,
              "config-source-contributions",
            )) as SelectRenderable;
            for (let index = 0; index < scenario.sources.length; index += 1)
              await setup.mockInput.pressArrow("down");
            await setup.waitFor(() => active.getSelectedIndex() === scenario.sources.length);
            await parsedEnter(setup);
            expect(handoffs[0]).toMatchObject({
              kind: "collection",
              collection: scenario.collections[0],
              owner: {
                file: "/workspace/skctl/skctl.jsonc",
                pointer: `/configSources/shared-config/collections/${scenario.collections[0]}`,
              },
            });
            expect(active.getSelectedIndex()).toBe(scenario.sources.length);
          }
        } else {
          expect(handoffs).toHaveLength(0);
        }

        expect(setup.renderer.root.findDescendantById("config-source-inspector")).toBeDefined();
        const back = await focusLive(setup, "config-command-config.source.back");
        expect(back).toBeDefined();
        await parsedEnter(setup);
        expect(state.configSourceSurface("project")).toBe("list");
        expect(state.selection("project", "config-sources")).toBe("/configSources/shared-config");
      } finally {
        setup.renderer.destroy();
      }
    });
  }
}
