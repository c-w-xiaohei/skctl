import { expect, test } from "bun:test";
import { CliRenderEvents, MarkdownRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { selectScrollOffset, setSelectScrollOffset } from "../src/select-scroll";
import { directSourceCore, openReaderFromInspector } from "./direct-source.fixture";
import {
  openAllInstalledSkills,
  openWorkspaceProblems,
  focusLive,
  openInstallation,
  parsedEnter,
  parsedEscape,
  readerTab,
  waitForReaderBody,
} from "./reader-test-controls";
import {
  readerContent,
  readerProjection,
  readerSecondAddress,
  readerSecondContent,
} from "./installed-reader.fixture";
async function openReaderRaw(setup: Awaited<ReturnType<typeof testRender>>) {
  if (!setup.renderer.root.findDescendantById("installed-skill-browser"))
    await openInstalledSkills(setup);
  await openReaderFromInspector(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-scrollbox"));
  const scrollbox = setup.renderer.root.findDescendantById("reader-scrollbox")!;
  scrollbox.focus();
  await setup.renderOnce();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === scrollbox);
}
async function openInstalledSkills(setup: Awaited<ReturnType<typeof testRender>>) {
  await openAllInstalledSkills(setup);
}
async function openProblems(setup: Awaited<ReturnType<typeof testRender>>) {
  await openWorkspaceProblems(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("problems-browser"));
  await focusLive(setup, "problems-browser");
}
test("RENDER initial Workspace projection applies once and defers reader focus until its target registers", async () => {
  let loads = 0;
  let initialSignal: AbortSignal | undefined;
  let resolveWorkspace:
    | ((value: {
        readonly value: ReturnType<typeof readerProjection>;
        readonly diagnostics: [];
      }) => void)
    | undefined;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          getWorkspace: (_environment: import("@skctl/core").CoreOptions, options) =>
            new Promise((resolve) => {
              loads += 1;
              initialSignal = options?.signal;
              resolveWorkspace = resolve;
            }),
          loadInstalledSkill: async () => readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(loads).toBe(1);
    expect(setup.captureCharFrame()).toContain("Loading");
    setup.resize(100, 30);
    await setup.renderOnce();
    expect(loads).toBe(1);
    expect(initialSignal?.aborted).toBe(false);
    resolveWorkspace!({ value: readerProjection(), diagnostics: [] });
    await setup.renderOnce();
    await openInstalledSkills(setup);
    await openReaderFromInspector(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER App aborts its unresolved initial Workspace request when unmounted", async () => {
  let loads = 0;
  let initialSignal: AbortSignal | undefined;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          getWorkspace: (_environment: import("@skctl/core").CoreOptions, options) =>
            new Promise(() => {
              loads += 1;
              initialSignal = options?.signal;
            }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  await setup.renderOnce();
  expect(loads).toBe(1);
  expect(initialSignal?.aborted).toBe(false);
  setup.renderer.destroy();
  expect(initialSignal?.aborted).toBe(true);
});
test.serial(
  "RENDER App keeps the second native Markdown Reader visible after Details returns to the browser",
  async () => {
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalledSkill: async (_environment: import("@skctl/core").CoreOptions, request) =>
              request.address.path === readerSecondAddress.path
                ? readerSecondContent
                : readerContent,
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await openInstalledSkills(setup);
      await openReaderFromInspector(setup);
      await openInstallation(setup);
      expect(!!setup.renderer.root.findDescendantById("reader-details")).toBe(true);
      await parsedEscape(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("installed-skill-browser"),
      );
      const browser = setup.renderer.root.findDescendantById("installed-skill-browser")!;
      browser.focus();
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
      await setup.waitFor(() => {
        const value = (browser as import("@opentui/core").SelectRenderable).getSelectedOption()
          ?.value;
        return value === JSON.stringify([readerSecondAddress.source, readerSecondAddress.path]);
      });
      await parsedEnter(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
      await setup.waitFor(() => {
        const reader = setup.renderer.root.findDescendantById("reader-scrollbox");
        return !!reader
          ?.getChildren()
          .some(
            (child) =>
              child instanceof MarkdownRenderable &&
              child.content === readerSecondContent.markdownText,
          );
      });
      const markdown = setup.renderer.root
        .findDescendantById("reader-scrollbox")!
        .getChildren()
        .find((child) => child instanceof MarkdownRenderable) as MarkdownRenderable;
      expect(markdown.content).toBe(readerSecondContent.markdownText);
    } finally {
      setup.renderer.destroy();
    }
  },
);
test("RENDER App ignores a queued browser owner while Reader remains the narrow surface", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await setup.flush();
    await openInstalledSkills(setup);
    await openReaderRaw(setup);
    const focused: string[] = [];
    const observe = (
      target: {
        readonly id?: string;
      } | null,
    ) => focused.push(target?.id ?? "");
    setup.renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, observe);
    setup.resize(63, 24);
    setup.resize(120, 24);
    await Promise.resolve();
    await setup.renderOnce();
    expect(focused).not.toContain("installed-skill-browser");
    expect(!!setup.renderer.root.findDescendantById("installed-skill-browser")).toBe(true);
    expect(focused.filter((id) => id === "reader-scrollbox").length).toBeLessThanOrEqual(1);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
    setup.renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, observe);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER App teardown rejects a queued focus reconciliation", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  await openReaderRaw(setup);
  const focused: string[] = [];
  const observe = (
    target: {
      readonly id?: string;
    } | null,
  ) => focused.push(target?.id ?? "");
  setup.renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, observe);
  setup.resize(79, 24);
  setup.renderer.destroy();
  await Promise.resolve();
  expect(focused.filter(Boolean)).toEqual([]);
  setup.renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, observe);
});
test("RENDER closing the palette settles focus back on the originating browser, never the task surface", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openInstalledSkills(setup);
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    await parsedEscape(setup);
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("palette-choices"));
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("task");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER an unregistered physical focus event does not request a new desired target", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openInstalledSkills(setup);
    const observed: string[] = [];
    const observe = (
      target: {
        readonly id?: string;
      } | null,
    ) => observed.push(target?.id ?? "null");
    setup.renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, observe);
    setup.renderer.emit(CliRenderEvents.FOCUSED_RENDERABLE, null, undefined);
    await setup.renderOnce();
    expect(observed).toEqual(["null"]);
    expect(setup.renderer.root.findDescendantById("installed-skill-browser")).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
    await openReaderRaw(setup);
    expect(setup.renderer.root.findDescendantById("installed-skill-browser")).toBeDefined();
    const readerTabs = readerTab(setup, 0);
    readerTabs.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === readerTabs);
    const body = setup.renderer.root.findDescendantById("reader-scrollbox")!;
    expect(!!body).toBe(true);
    setup.renderer.emit(CliRenderEvents.FOCUSED_RENDERABLE, body, readerTabs);
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable === readerTabs).toBe(true);
    setup.renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, observe);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER nested palette close restores the original browser focus", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openInstalledSkills(setup);
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    setup.mockInput.pressKey("p", { ctrl: true });
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-choices");
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Problems Installed Skill drill-in opens Reader and restores its browser", async () => {
  const base = readerProjection();
  const projection = {
    ...base,
    installedSkills: [
      {
        ...base.installedSkills[0]!,
        problems: [
          {
            code: "SOURCE_DRIFT",
            severity: "warning" as const,
            message: "Observed drift",
            subject: {
              kind: "installed-skill" as const,
              address: base.installedSkills[0]!.address,
            },
          },
        ],
      },
    ],
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, { loadInstalledSkill: async () => readerContent })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openProblems(setup);
    const firstProblem = setup.renderer.root.findDescendantById(
      "problems-browser",
    ) as SelectRenderable;
    const firstProblemValue = firstProblem.getSelectedOption()?.value;
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
    expect(!!setup.renderer.root.findDescendantById("problems-browser")).toBe(false);
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "problems-browser");
    expect(setup.renderer.root.findDescendantById("problems-browser")).toBeDefined();
    expect(
      (
        setup.renderer.root.findDescendantById("problems-browser") as SelectRenderable
      ).getSelectedOption()?.value,
    ).toBe(firstProblemValue);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Problems diagnostic query keeps its exact Reader Skill and restores the selected row", async () => {
  const base = readerProjection();
  const first = {
    code: "FIRST_DIAGNOSTIC",
    severity: "warning" as const,
    message: "first diagnostic",
    subject: { kind: "installed-skill" as const, address: base.installedSkills[0]!.address },
  };
  const second = {
    code: "SECOND_DIAGNOSTIC",
    severity: "warning" as const,
    message: "second diagnostic",
    subject: { kind: "installed-skill" as const, address: base.installedSkills[1]!.address },
  };
  const projection = {
    ...base,
    diagnostics: [first, second],
    installedSkills: [
      { ...base.installedSkills[0]!, problems: [first] },
      { ...base.installedSkills[1]!, problems: [second] },
    ],
  };
  for (const width of [120, 80] as const) {
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(projection, {
            loadInstalledSkill: async (_environment, request) =>
              request.address.path === readerSecondAddress.path
                ? readerSecondContent
                : readerContent,
          })}
          exit={() => {}}
        />
      ),
      { width, height: 40 },
    );
    try {
      await openProblems(setup);
      const query = setup.renderer.root.findDescendantById("problems-query")!;
      query.focus();
      for (const character of "SECOND_DIAGNOSTIC") setup.mockInput.pressKey(character);
      await setup.waitFor(
        () =>
          (setup.renderer.root.findDescendantById("problems-browser") as SelectRenderable).options
            .length === 1,
      );
      const filtered = setup.renderer.root.findDescendantById(
        "problems-browser",
      ) as SelectRenderable;
      filtered.focus();
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable === filtered);
      const selected = filtered.getSelectedOption()?.value;
      await parsedEnter(setup);
      await waitForReaderBody(setup, "reference needle");
      expect(!!setup.renderer.root.findDescendantById("problems-browser")).toBe(false);
      await parsedEscape(setup);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "problems-browser");
      const restored = setup.renderer.root.findDescendantById(
        "problems-browser",
      ) as SelectRenderable;
      expect(restored.getSelectedOption()?.value).toBe(selected);
    } finally {
      setup.renderer.destroy();
    }
  }
});
test("RENDER Problems exposes distinct native values for structurally distinct diagnostics", async () => {
  const base = readerProjection();
  const projection = {
    ...base,
    diagnostics: [
      {
        code: "SAME",
        severity: "warning" as const,
        message: "same",
        location: { file: "a", pointer: "bc" },
      },
      {
        code: "SAME",
        severity: "warning" as const,
        message: "same",
        location: { file: "ab", pointer: "c" },
      },
    ],
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 32 },
  );
  try {
    await openProblems(setup);
    const browser = setup.renderer.root.findDescendantById("problems-browser") as SelectRenderable;
    expect(browser.options).toHaveLength(2);
    expect(browser.options[0]!.value).not.toBe(browser.options[1]!.value);
    setup.mockInput.pressArrow("down");
    await setup.waitFor(() => browser.getSelectedIndex() === 1);
    const selected = browser.getSelectedOption()?.value;
    expect(selected).toBe(browser.options[1]!.value);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Problems Reader return restores a non-first diagnostic row", async () => {
  const base = readerProjection();
  const first = {
    code: "FIRST_DIAGNOSTIC",
    severity: "warning" as const,
    message: "first diagnostic",
    subject: { kind: "installed-skill" as const, address: base.installedSkills[0]!.address },
  };
  const second = {
    code: "SECOND_DIAGNOSTIC",
    severity: "warning" as const,
    message: "second diagnostic",
    subject: { kind: "installed-skill" as const, address: base.installedSkills[1]!.address },
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore({
          ...base,
          diagnostics: [first, second],
          installedSkills: [
            { ...base.installedSkills[0]!, problems: [first] },
            { ...base.installedSkills[1]!, problems: [second] },
          ],
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openProblems(setup);
    const browser = setup.renderer.root.findDescendantById("problems-browser") as SelectRenderable;
    setup.mockInput.pressArrow("down");
    await setup.waitFor(() => browser.getSelectedIndex() === 1);
    const selected = browser.getSelectedOption()?.value;
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "problems-browser");
    const restored = setup.renderer.root.findDescendantById("problems-browser") as SelectRenderable;
    expect(restored.getSelectedOption()?.value).toBe(selected);
    expect(restored.getSelectedIndex()).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Problems drill-in restores native viewport and selected semantic row", async () => {
  const base = readerProjection();
  const diagnostics = Array.from({ length: 20 }, (_, index) => ({
    code: `DIAGNOSTIC_${index}`,
    severity: "warning" as const,
    message: `diagnostic ${index}`,
    subject: { kind: "installed-skill" as const, address: base.installedSkills[0]!.address },
  }));
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore({
          ...base,
          diagnostics,
          installedSkills: [{ ...base.installedSkills[0]!, problems: diagnostics }],
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await openProblems(setup);
    const browser = setup.renderer.root.findDescendantById("problems-browser") as SelectRenderable;
    browser.setSelectedIndex(12);
    setSelectScrollOffset(browser, 5);
    await setup.renderOnce();
    const scroll = selectScrollOffset(browser);
    browser.focus();
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "problems-browser");
    const restored = setup.renderer.root.findDescendantById("problems-browser") as SelectRenderable;
    expect(restored.getSelectedIndex()).toBe(12);
    expect(selectScrollOffset(restored)).toBe(scroll);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("problems-browser");
  } finally {
    setup.renderer.destroy();
  }
});
