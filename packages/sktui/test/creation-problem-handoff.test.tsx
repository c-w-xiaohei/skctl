/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { CollectionCreateOverlay } from "../src/operations";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { enterLive, parsedEnter, parsedEscape, waitForReaderBody } from "./reader-test-controls";
import { problemRowKey, problemRows } from "../src/workspace/state";

for (const action of ["cancel", "submit"] as const) {
  test(`Collection creation preserves its live draft and ${action} has one explicit outcome`, async () => {
    const submitted: unknown[] = [];
    let cancelled = 0;
    const setup = await testRender(
      () => (
        <CollectionCreateOverlay
          level="project"
          collection=""
          pending={false}
          onSubmit={(value) => submitted.push(value)}
          onCancel={() => cancelled++}
        />
      ),
      { width: 80, height: 24 },
    );
    try {
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-create-id",
      );
      await setup.mockInput.typeText("team");
      setup.mockInput.pressArrow("down");
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-create-id");
      const input = setup.renderer.root.findDescendantById(
        "collection-create-id",
      ) as InputRenderable;
      expect(input.value).toBe("team");
      expect(submitted).toEqual([]);
      expect(cancelled).toBe(0);
      await enterLive(setup, `collection-create-${action}`);
      expect(submitted).toEqual(
        action === "submit" ? [{ level: "project", collection: "team" }] : [],
      );
      expect(cancelled).toBe(action === "cancel" ? 1 : 0);
    } finally {
      setup.renderer.destroy();
    }
  });
}

test("Problems opens the exact Skill in Reader and Back restores the diagnostic row", async () => {
  const base = readerProjection();
  const address = base.installedSkills[0]!.address;
  const projection = {
    ...base,
    installedSkills: base.installedSkills.map((skill, index) =>
      index === 0
        ? {
            ...skill,
            problems: [
              {
                code: "SKILL_DIAGNOSTIC",
                severity: "warning" as const,
                message: "Review this installed Skill",
                subject: { kind: "installed-skill" as const, address },
              },
            ],
          }
        : skill,
    ),
  };
  const problem = problemRows(projection).find((row) => row.intent?.kind === "installed-skill")!;
  const key = problemRowKey(problem);
  const loaded: (typeof address)[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, {
          loadInstalledSkill: async (_environment, request) => {
            loaded.push(request.address);
            return {
              address: request.address,
              name: request.address.path,
              description: "",
              rawText: "# Diagnostic Skill body",
              markdownText: "# Diagnostic Skill body",
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-view-tab-problems"));
    await enterLive(setup, "skills-view-tab-problems");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("problems-browser"));
    const browser = setup.renderer.root.findDescendantById("problems-browser") as SelectRenderable;
    expect(browser.getSelectedOption()?.value).toBe(key);
    await parsedEnter(setup);
    await waitForReaderBody(setup, "Diagnostic Skill body");
    expect(loaded).toEqual([address]);
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "problems-browser");
    const restored = setup.renderer.root.findDescendantById("problems-browser") as SelectRenderable;
    expect(restored.getSelectedOption()?.value).toBe(key);
    expect(loaded).toEqual([address]);
  } finally {
    setup.renderer.destroy();
  }
});
