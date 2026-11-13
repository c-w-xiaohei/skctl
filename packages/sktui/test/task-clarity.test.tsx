import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { CollectionHandoffOverlay } from "../src/operations/choices";
import {
  SourceAcquisitionFrame,
  SourceObservationOverlay,
  SourceSelectionOverlay,
} from "../src/operations/source";
import { CollectionContentOverlay } from "../src/operations/collection-forms";
import { createSignal } from "solid-js";
import { mkdir, writeFile } from "node:fs/promises";
import { enterLive, focusLive, parsedEscape } from "./reader-test-controls";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { openMainPage } from "./main-page-controls";
import { SkctlError } from "@skctl/core";

test("Collection Settings defers configuration management until explicitly opened", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
    { width: 120, height: 24 },
  );
  try {
    await openMainPage(setup, "collections");
    await enterLive(setup, "collection-browser");
    await enterLive(setup, "collection-tabs-tab-settings");
    expect(!!setup.renderer.root.findDescendantById("collection-location-open-project")).toBe(
      false,
    );
    expect(!!setup.renderer.root.findDescendantById("collection-use-project")).toBe(false);
    await mkdir("out/task-clarity", { recursive: true });
    await writeFile("out/task-clarity/settings-default-120x24.txt", setup.captureCharFrame());
    await enterLive(setup, "collection-configuration-details");
    expect(!!setup.renderer.root.findDescendantById("collection-location-open-project")).toBe(true);
    await writeFile("out/task-clarity/settings-details-120x24.txt", setup.captureCharFrame());
    await enterLive(setup, "collection-configuration-details");
    expect(!!setup.renderer.root.findDescendantById("collection-location-open-project")).toBe(
      false,
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("inline instruction save failure retains its mounted draft and retries the same edited fields", async () => {
  const writes: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(collectionsSourcesProjection(), {
          setCollectionContent: async (_environment, request) => {
            writes.push(request);
            if (writes.length === 1)
              throw new SkctlError(
                "CONFIG_CONFLICT",
                "Configuration changed. Retry after reviewing the location.",
              );
            return {
              value: { level: request.level, file: request.expectedOwner!.file, changed: true },
              diagnostics: [],
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await openMainPage(setup, "collections");
    await enterLive(setup, "collection-browser");
    await enterLive(setup, "collection-tabs-tab-description");
    await enterLive(setup, "collection-action-edit-collection-content");
    const input = (await focusLive(setup, "collection-content-description")) as InputRenderable;
    input.value = "Review team marketing work.";
    await enterLive(setup, "collection-content-save");
    await setup.waitForFrame((frame) => frame.includes("Configuration changed"));
    expect(setup.renderer.root.findDescendantById("collection-content-description") === input).toBe(
      true,
    );
    expect(input.value).toBe("Review team marketing work.");
    await enterLive(setup, "collection-content-save");
    await setup.waitFor(
      () => !setup.renderer.root.findDescendantById("collection-content-description"),
    );
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual(writes[1]);
    expect(writes[0]).not.toHaveProperty("instructions");
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection instruction pages do not offer a layout-only More menu", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
    { width: 120, height: 24 },
  );
  try {
    await openMainPage(setup, "collections");
    await enterLive(setup, "collection-browser");
    await enterLive(setup, "collection-tabs-tab-description");
    expect(!!setup.renderer.root.findDescendantById("collection-more")).toBe(false);
    await enterLive(setup, "collection-action-edit-collection-content");
    await setup.flush();
    const input = setup.renderer.root.findDescendantById("collection-content-description");
    let ancestor = input?.parent;
    while (ancestor && ancestor.id !== "collection-detail-pane") ancestor = ancestor.parent;
    expect(!!ancestor).toBe(true);
    await focusLive(setup, "collection-content-description");
    (input as InputRenderable).value = "Unsaved description";
    await parsedEscape(setup);
    expect(!!setup.renderer.root.findDescendantById("collection-content-description")).toBe(true);
    expect(!!setup.renderer.root.findDescendantById("collection-content-discard")).toBe(true);
    await enterLive(setup, "collection-content-keep");
    await setup.mockMouse.click(24, 0);
    await setup.flush();
    expect(
      (setup.renderer.root.findDescendantById("collection-content-description") as InputRenderable)
        .value,
    ).toBe("Unsaved description");
    await enterLive(setup, "collection-content-cancel");
    await enterLive(setup, "collection-content-discard");
    expect(!!setup.renderer.root.findDescendantById("collection-content-description")).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection selection groups declarations then resolves the exact write owner", async () => {
  const choices = [
    { collection: "marketing", level: "global" as const },
    { collection: "marketing", level: "project" as const },
    { collection: "engineering", level: "global" as const },
  ];
  const selected: unknown[] = [];
  const setup = await testRender(
    () => (
      <CollectionHandoffOverlay
        choices={choices}
        onSelect={(v) => selected.push(v)}
        onClose={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.flush();
    const list = setup.renderer.root.findDescendantById(
      "collection-handoff-choice",
    ) as SelectRenderable;
    expect(list.options).toHaveLength(2);
    expect(list.showDescription).toBe(false);
    await enterLive(setup, "collection-handoff-choice");
    expect(selected).toEqual([]);
    const owners = setup.renderer.root.findDescendantById(
      "collection-handoff-owner",
    ) as SelectRenderable;
    owners.selectedIndex = 1;
    await enterLive(setup, "collection-handoff-owner");
    expect(selected).toEqual([choices[1]]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Source candidates distinguish checking from reading and hide installed items by default", async () => {
  const toggled: string[] = [];
  const setup = await testRender(
    () => (
      <SourceSelectionOverlay
        review={{
          kind: "discovery",
          id: "review",
          intent: { kind: "source-discovery", source: "mine" },
          observation: {
            source: "mine",
            kind: "local",
            candidates: [
              {
                name: "alpha",
                path: "skills/alpha",
                description: "Complete description for the current candidate.",
              },
              { name: "existing", path: "skills/existing", description: "Already installed." },
            ],
          },
        }}
        installed={new Set(["skills/existing"])}
        selected={[]}
        query=""
        onQuery={() => {}}
        pending={false}
        onToggle={(v) => toggled.push(v)}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.flush();
    const list = setup.renderer.root.findDescendantById(
      "source-operation-selection",
    ) as SelectRenderable;
    expect(list.options.map((v) => v.value)).toEqual(["skills/alpha"]);
    expect(list.showDescription).toBe(false);
    await enterLive(setup, "source-operation-selection");
    expect(toggled).toEqual([]);
    expect(setup.captureCharFrame()).toContain("Complete description");
    await parsedEscape(setup);
    await focusLive(setup, "source-operation-selection");
    await setup.mockInput.typeText(" ");
    await setup.flush();
    expect(toggled).toEqual(["skills/alpha"]);
    await enterLive(setup, "source-operation-show-installed");
    const all = setup.renderer.root.findDescendantById(
      "source-operation-selection",
    ) as SelectRenderable;
    expect(all.options).toHaveLength(2);
  } finally {
    setup.renderer.destroy();
  }
});

for (const [width, height] of [
  [120, 24],
  [80, 24],
  [43, 13],
]) {
  test(`task frames keep controls visible and preserve background at ${width}x${height}`, async () => {
    let view!: (value: string) => void;
    const setup = await testRender(
      () => {
        const [surface, setSurface] = createSignal("picker");
        view = setSurface;
        return (
          <box width="100%" height="100%" flexDirection="column">
            <text>Existing workspace: generic-ooux</text>
            {surface() === "picker" && (
              <CollectionHandoffOverlay
                choices={Array.from({ length: 30 }, (_, index) => ({
                  collection: `collection-${index}`,
                  level: "global" as const,
                }))}
                onSelect={() => {}}
                onClose={() => {}}
                onCreate={() => {}}
              />
            )}
            {surface() === "editor" && (
              <box flexGrow={1} minHeight={0}>
                <CollectionContentOverlay
                  inline
                  collection="marketing"
                  owner={{
                    level: "global",
                    file: "/config/collections/marketing.jsonc",
                    pointer: "/collections/marketing",
                  }}
                  description="Plan marketing work."
                  pending={false}
                  onSave={() => {}}
                  onCancel={() => {}}
                />
              </box>
            )}
            {(surface() === "selection" || surface() === "finding") && (
              <SourceAcquisitionFrame source="example/library" observing={surface() === "finding"}>
                {surface() === "finding" ? (
                  <SourceObservationOverlay
                    inline
                    title="Discovering Skills"
                    source="example/library"
                    cancelling={false}
                    onRetry={() => {}}
                    onClose={() => {}}
                  />
                ) : (
                  <SourceSelectionOverlay
                    inline
                    review={{
                      kind: "discovery",
                      id: "capture",
                      intent: { kind: "source-discovery", source: "example/library" },
                      observation: {
                        kind: "github",
                        source: "example/library",
                        exactRevision: "a".repeat(40),
                        candidates: Array.from({ length: 40 }, (_, i) => ({
                          name: `skill-${i}`,
                          path: `skills/skill-${i}`,
                          description:
                            "Choose relevant Skills and read complete guidance without truncating the description in the candidate list. ".repeat(
                              3,
                            ),
                        })),
                      },
                    }}
                    installed={new Set()}
                    selected={[]}
                    query=""
                    onQuery={() => {}}
                    pending={false}
                    onToggle={() => {}}
                    onSubmit={() => {}}
                    onCancel={() => {}}
                  />
                )}
              </SourceAcquisitionFrame>
            )}
          </box>
        );
      },
      { width, height },
    );
    try {
      await mkdir("out/task-clarity", { recursive: true });
      for (const surface of ["picker", "editor", "finding", "selection"]) {
        view(surface);
        await setup.flush();
        const id =
          surface === "picker"
            ? "collection-handoff-cancel"
            : surface === "editor"
              ? "collection-content-cancel"
              : surface === "finding"
                ? "source-observation-progress"
                : "source-operation-cancel";
        const button = setup.renderer.root.findDescendantById(id)!;
        expect(button.screenY).toBeGreaterThanOrEqual(0);
        expect(button.screenY + button.height).toBeLessThanOrEqual(height);
        if (surface === "picker") expect(setup.captureCharFrame()).toContain("Existing workspace");
        await writeFile(
          `out/task-clarity/${surface}-${width}x${height}.txt`,
          setup.captureCharFrame(),
        );
      }
    } finally {
      setup.renderer.destroy();
    }
  });
}
