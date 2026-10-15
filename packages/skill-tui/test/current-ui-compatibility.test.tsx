/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { CollectionCreateOverlay } from "../src/operations";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { enterLive, focusLive, parsedEnter, parsedEscape } from "./reader-test-controls";
import { problemRowKey, problemRows } from "../src/workspace/state";

const mountedIds = (setup: Awaited<ReturnType<typeof testRender>>, ids: readonly string[]) =>
  ids.map((id) => (setup.renderer.root.findDescendantById(id) ? `${id}=mounted` : `${id}=absent`));

test("Collection Create types in its live input and keeps Cancel first in native arrow traversal", async () => {
  const submitted: { level: string; collection: string }[] = [];
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
    const input = setup.renderer.root.findDescendantById("collection-create-id");
    expect(input).toBeInstanceOf(InputRenderable);
    if (!(input instanceof InputRenderable)) throw new Error("Collection ID input did not mount");
    await setup.mockInput.typeText("compat-team");
    expect(input.value).toBe("compat-team");
    expect(setup.renderer.root.findDescendantById("collection-create-id")).toBe(input);
    expect(submitted).toEqual([]);

    setup.mockInput.pressTab();
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable).toBe(input);
    setup.mockInput.pressArrow("down");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-create-cancel",
    );
    await parsedEnter(setup);
    expect(cancelled).toBe(1);
    expect(submitted).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }

  const created: { level: string; collection: string }[] = [];
  const submit = await testRender(
    () => (
      <CollectionCreateOverlay
        level="project"
        collection=""
        pending={false}
        onSubmit={(value) => created.push(value)}
        onCancel={() => cancelled++}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await submit.waitFor(
      () => submit.renderer.currentFocusedRenderable?.id === "collection-create-id",
    );
    await submit.mockInput.typeText("compat-team");
    submit.mockInput.pressArrow("down");
    await submit.waitFor(
      () => submit.renderer.currentFocusedRenderable?.id === "collection-create-cancel",
    );
    submit.mockInput.pressArrow("down");
    await submit.waitFor(
      () => submit.renderer.currentFocusedRenderable?.id === "collection-create-submit",
    );
    await parsedEnter(submit);
    expect(created).toEqual([{ level: "project", collection: "compat-team" }]);
    expect(cancelled).toBe(1);
  } finally {
    submit.renderer.destroy();
  }
});

test("Problems opens the exact Installed Skill inspector without loading its Reader", async () => {
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
                code: "COMPAT_DIAGNOSTIC",
                severity: "warning" as const,
                message: "Current handoff target",
                subject: { kind: "installed-skill" as const, address },
              },
            ],
          }
        : skill,
    ),
  };
  const problemKey = problemRowKey(
    problemRows(projection).find(
      (row) =>
        row.intent?.kind === "installed-skill" &&
        row.intent.address.source === address.source &&
        row.intent.address.path === address.path,
    )!,
  );
  let loads = 0;
  const loadedAddresses: { source: string; path: string }[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, {
          loadInstalled: async ({ address: requested }) => {
            loads++;
            loadedAddresses.push(requested);
            return {
              value: {
                address: requested,
                name: requested.path,
                description: "compatibility fixture",
                rawText: "# compatibility fixture",
                markdownText: "# compatibility fixture",
              },
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
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skills-view-tab-all-installed-skills"),
    );
    const problemsTab = setup.renderer.root.findDescendantById("skills-view-tab-problems");
    if (!problemsTab) throw new Error("Problems view tab not mounted");
    await setup.mockMouse.click(problemsTab.screenX, problemsTab.screenY);
    try {
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("problems-browser"));
    } catch (error) {
      throw new Error(
        `Problems browser did not mount at 80x24; ${mountedIds(setup, ["skills-view-tab-problems", "problems-browser", "skill-inspector-open-reader"])}\n${setup.captureCharFrame()}`,
        { cause: error },
      );
    }
    const browser = setup.renderer.root.findDescendantById("problems-browser");
    expect(browser).toBeInstanceOf(SelectRenderable);
    if (!(browser instanceof SelectRenderable))
      throw new Error("Problems browser is not native Select");
    const row = browser.options.find((option) => option.value === problemKey);
    expect(row).toBeDefined();
    expect(row?.value).toBe(problemKey);
    expect(row?.name).toContain(`${address.source}/${address.path}`);
    expect(row?.description.trim()).toBe("Current handoff target");
    expect(browser.options[browser.getSelectedIndex()]?.value).toBe(problemKey);
    expect(browser.getSelectedOption()?.value).toBe(problemKey);
    await focusLive(setup, "problems-browser");
    await parsedEnter(setup);
    try {
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
      );
    } catch (error) {
      throw new Error(
        `Problems row did not hand off to its Inspector at 80x24; ${mountedIds(setup, ["problems-browser", "skill-inspector", "skill-inspector-open-reader", "reader-views"])}\n${setup.captureCharFrame()}`,
        { cause: error },
      );
    }
    expect(setup.captureCharFrame()).toContain("guide");
    expect(setup.renderer.root.findDescendantById("problems-browser")).toBeUndefined();
    expect(loads).toBe(0);
    await enterLive(setup, "skill-inspector-open-reader");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
    await setup.waitFor(() => loads === 1);
    expect(loadedAddresses).toEqual([address]);
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
    );
    expect(setup.captureCharFrame()).toContain("guide");
    await parsedEscape(setup);
    await setup.waitFor(() => {
      const restored = setup.renderer.root.findDescendantById("problems-browser");
      return (
        restored instanceof SelectRenderable && restored.getSelectedOption()?.value === problemKey
      );
    });
    const restored = setup.renderer.root.findDescendantById("problems-browser");
    if (!(restored instanceof SelectRenderable))
      throw new Error(`Problems browser not restored\n${setup.captureCharFrame()}`);
    expect(restored.getSelectedOption()?.value).toBe(problemKey);
    expect(setup.renderer.currentFocusedRenderable).toBe(restored);
    expect(loads).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});
