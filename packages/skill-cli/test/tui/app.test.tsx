import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { SkillCliError } from "../../src/core/api";
import { directOwner, directSourceCore, workspaceProjection } from "./direct-source.fixture";

async function awaitParsedEscape(setup: Awaited<ReturnType<typeof testRender>>) {
  await new Promise<void>((resolve) => {
    const onKeypress = (event: { readonly name: string }) => {
      if (event.name === "escape" || event.name === "esc") {
        setup.renderer.keyInput.off("keypress", onKeypress);
        resolve();
      }
    };
    setup.renderer.keyInput.prependListener("keypress", onKeypress);
    setup.mockInput.pressKey("ESCAPE");
  });
}

async function populated(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.renderOnce();
  await Promise.resolve();
  await setup.waitForFrame((frame) => frame.includes("Skills"));
  if (setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser") {
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.renderOnce();
  }
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("workspace-section-browser");
  setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN"]);
  setup.mockInput.pressEnter();
  await setup.waitForFrame((frame) => frame.includes("team-main"));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
}

async function openActions(setup: Awaited<ReturnType<typeof testRender>>) {
  setup.mockInput.pressEnter();
  await setup.waitForFrame(
    (frame) => frame.includes("Open Config") && frame.includes("Remove Source"),
  );
  await setup.renderOnce();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-action-menu");
}

test("RENDER keyboard browser selects a contributed Source then opens its contextual Actions", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await populated(setup);
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Open Config Source"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-action-menu");
    expect(setup.captureCharFrame()).not.toContain("Remove Source");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Add Skills selects observed eligible roots, disables installed roots, and installs the exact revision once", async () => {
  const calls: unknown[] = [];
  const projection = {
    ...workspaceProjection(),
    installedSkills: [
      {
        address: { source: "team-main", path: "installed" },
        name: "installed",
        description: "Already here",
        owner: { source: "team-main", health: "healthy" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" as const },
        aliases: [],
        problems: [],
      },
    ],
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, {
          discover: async (request) => ({
            value: {
              source: request.source,
              kind: "github",
              exactRevision: "reviewed",
              candidates: [
                {
                  path: "installed",
                  name: "installed",
                  description: "Already here",
                },
                { path: "new", name: "new", description: "Install me" },
              ],
            },
            diagnostics: [],
          }),
          install: async (request) => {
            calls.push(request);
            return { value: [], diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) => frame.includes("Add Skills") && frame.includes("Revision: reviewed"),
    );
    expect(setup.captureCharFrame()).toContain("[-] Available installed");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-operation-selection");
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => calls.length === 1);
    expect(calls).toEqual([{ source: "team-main", paths: ["new"], exactRevision: "reviewed" }]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Check Updates labels categories and applies only a selected Changed root at its observation revision", async () => {
  const calls: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          checkUpdate: async () => ({
            value: {
              source: "team-main",
              kind: "github",
              exactRevision: "update-commit",
              changed: [
                {
                  path: "changed",
                  name: "changed",
                  description: "Changed skill",
                },
              ],
              added: [{ path: "new", name: "new", description: "New skill" }],
              removed: [{ path: "old", name: "old", description: "Removed skill" }],
              unchanged: [{ path: "same", name: "same", description: "Same skill" }],
            },
            diagnostics: [],
          }),
          update: async (request) => {
            calls.push(request);
            return { value: undefined, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) => frame.includes("Changed changed") && frame.includes("Unchanged same"),
    );
    expect(setup.captureCharFrame()).toContain("[-] New new");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKeys([
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
    ]);
    setup.mockInput.pressEnter();
    await setup.waitFor(() => calls.length === 1);
    expect(calls).toEqual([
      {
        source: "team-main",
        paths: ["changed"],
        exactRevision: "update-commit",
      },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER View Installed Skills filters exact structural Source ownership", async () => {
  const projection = {
    ...workspaceProjection(),
    installedSkills: [
      {
        address: { source: "team-main", path: "review" },
        name: "review",
        description: "Team review",
        owner: { source: "team-main", health: "healthy" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" as const },
        aliases: [],
        problems: [],
      },
      {
        address: { source: "team-config/lark", path: "doc" },
        name: "doc",
        description: "Lark docs",
        owner: { source: "team-config/lark", health: "healthy" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" as const },
        aliases: [],
        problems: [],
      },
    ],
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Installed Skills from") &&
        frame.includes("team-main") &&
        frame.includes("Team review") &&
        !frame.includes("Lark docs"),
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER filtered Installed Skills selection leaves Source context intact and Escape returns to it", async () => {
  const projection = {
    ...workspaceProjection(),
    installedSkills: [
      {
        address: { source: "team-main", path: "first" },
        name: "first",
        description: "First",
        owner: { source: "team-main", health: "missing" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" as const },
        aliases: [],
        problems: [],
      },
      {
        address: { source: "team-main", path: "second" },
        name: "second",
        description: "Second",
        owner: { source: "team-main", health: "drifted" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" as const },
        aliases: [],
        problems: [],
      },
    ],
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) => frame.includes("! first  First") && frame.includes("! second  Second"),
    );
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    await awaitParsedEscape(setup);
    await setup.waitForFrame(
      (frame) => frame.includes("team-main") && frame.includes("View Installed Skills"),
    );
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Project Source browser initializes its visual first row before contextual actions", async () => {
  const calls: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          discover: async (request) => {
            calls.push(request);
            return {
              value: { source: request.source, kind: "github", candidates: [] },
              diagnostics: [],
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup);
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitForFrame((frame) => frame.includes("Palette"));
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Direct sources"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-source-browser");
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Add Skills"));
    setup.mockInput.pressEnter();
    await setup.waitFor(() => calls.length === 1);
    expect(calls).toEqual([{ source: "team-main" }]);
  } finally {
    setup.renderer.destroy();
  }
});

async function projectContributedSource(setup: Awaited<ReturnType<typeof testRender>>) {
  await populated(setup);
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitForFrame((frame) => frame.includes("Palette"));
  setup.mockInput.pressArrow("down");
  setup.mockInput.pressArrow("down");
  setup.mockInput.pressEnter();
  await setup.waitForFrame((frame) => frame.includes("team-main Direct Source"));
  setup.mockInput.pressArrow("down");
  setup.mockInput.pressEnter();
  await setup.waitForFrame((frame) => frame.includes("Open Config Source"));
}

test("RENDER Project contributed Source installs selected observed roots at its exact revision", async () => {
  const calls: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          discover: async (request) => {
            calls.push(["discover", request]);
            return {
              value: {
                source: request.source,
                kind: "github",
                exactRevision: "contributed-install",
                candidates: [{ path: "review", name: "review", description: "Review" }],
              },
              diagnostics: [],
            };
          },
          install: async (request) => {
            calls.push(["install", request]);
            return { value: [], diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await projectContributedSource(setup);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Revision: contributed-install"));
    setup.mockInput.pressEnter();
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitFor(() => calls.length === 2);
    expect(calls).toEqual([
      ["discover", { source: "team-config/lark" }],
      [
        "install",
        { source: "team-config/lark", paths: ["review"], exactRevision: "contributed-install" },
      ],
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Project contributed Source updates only selected Changed roots at its exact revision", async () => {
  const calls: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          checkUpdate: async (request) => {
            calls.push(["check", request]);
            return {
              value: {
                source: request.source,
                kind: "github",
                exactRevision: "contributed-update",
                changed: [{ path: "review", name: "review", description: "Changed" }],
                added: [{ path: "new", name: "new", description: "New" }],
                removed: [],
                unchanged: [],
              },
              diagnostics: [],
            };
          },
          update: async (request) => {
            calls.push(["update", request]);
            return { value: undefined, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await projectContributedSource(setup);
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) => frame.includes("Changed review") && frame.includes("New new"),
    );
    setup.mockInput.pressEnter();
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitFor(() => calls.length === 2);
    expect(calls).toEqual([
      ["check", { source: "team-config/lark" }],
      [
        "update",
        { source: "team-config/lark", paths: ["review"], exactRevision: "contributed-update" },
      ],
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Project contributed Source filters unhealthy Installed Skills and returns to Config context", async () => {
  const projection = {
    ...workspaceProjection(),
    installedSkills: [
      {
        address: { source: "team-config/lark", path: "doc" },
        name: "doc",
        description: "Lark",
        owner: { source: "team-config/lark", health: "unresolved-config" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" as const },
        aliases: [],
        problems: [],
      },
    ],
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await projectContributedSource(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Installed Skills from") &&
        frame.includes("config/lark") &&
        frame.includes("! doc  Lark"),
    );
    await awaitParsedEscape(setup);
    await setup.waitForFrame(
      (frame) => frame.includes("team-config/lark") && frame.includes("Open Config Source"),
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Escape aborts a pending Add Skills observation before it opens a selection", async () => {
  let aborts = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          discover: (_request, options) =>
            new Promise((_, reject) =>
              options?.signal?.addEventListener("abort", () => {
                aborts++;
                reject(new SkillCliError("CANCELLED", "cancelled"));
              }),
            ),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await awaitParsedEscape(setup);
    await setup.waitFor(() => aborts === 1);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Open Config and Open Config Source route to their exact selected owner rows", async () => {
  const direct = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await populated(direct);
    await openActions(direct);
    direct.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    direct.mockInput.pressEnter();
    await direct.waitForFrame((frame) => frame.includes("team-main Direct Source"));
    expect(direct.captureCharFrame()).toContain("▶ team-main Direct Source");
  } finally {
    direct.renderer.destroy();
  }

  const contributed = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await populated(contributed);
    contributed.mockInput.pressArrow("down");
    await openActions(contributed);
    contributed.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    contributed.mockInput.pressEnter();
    await contributed.waitForFrame(
      (frame) => frame.includes("> team-config") && frame.includes("Direct config-sources"),
    );
    expect(contributed.captureCharFrame()).toContain("> team-config");
  } finally {
    contributed.renderer.destroy();
  }
});

test("RENDER blocked impact repair select opens the exact Rebind repair form", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          preview: async () => ({
            value: {
              kind: "source-removal",
              source: "team-main",
              owner: directOwner,
              installed: [{ source: "team-main", path: "review" }],
              repairs: [
                {
                  address: { source: "team-main", path: "review" },
                  actions: ["rebind", "uninstall"],
                },
              ],
              blockers: [
                {
                  reason: "installed",
                  address: { source: "team-main", path: "review" },
                },
              ],
              allowed: false,
            },
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Removal is blocked"));
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Rebind Skill") &&
        frame.includes("Replacement Source-root-relative Skill path"),
    );
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("rebind-source-choice");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Palette routes its Project destination and omits contributed removal", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await populated(setup);
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitForFrame((frame) => frame.includes("Palette") && frame.includes("Project"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-menu");
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Direct sources"));
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER normal Ctrl+C exits exactly once", async () => {
  let exits = 0;
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => exits++} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await populated(setup);
    setup.mockInput.pressCtrlC();
    setup.mockInput.pressCtrlC();
    expect(exits).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Escape cancels a pending preview exactly once and late preview success cannot reopen confirmation", async () => {
  let aborts = 0;
  let resolvePreview:
    | ((value: {
        readonly value: {
          readonly kind: "source-removal";
          readonly source: string;
          readonly owner: typeof directOwner;
          readonly installed: [];
          readonly repairs: [];
          readonly blockers: [];
          readonly allowed: true;
        };
        readonly diagnostics: [];
      }) => void)
    | undefined;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          preview: (options) =>
            new Promise((resolve) => {
              resolvePreview = resolve;
              options?.signal?.addEventListener("abort", () => aborts++);
            }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Reviewing Source removal impact"));
    await Promise.resolve();
    await setup.renderOnce();
    await awaitParsedEscape(setup);
    await setup.renderOnce();
    resolvePreview!({
      value: {
        kind: "source-removal",
        source: "team-main",
        owner: directOwner,
        installed: [],
        repairs: [],
        blockers: [],
        allowed: true,
      },
      diagnostics: [],
    });
    await setup.renderOnce();
    expect(aborts).toBe(1);
    expect(setup.captureCharFrame()).not.toContain("Remove this direct Source declaration?");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER allowed removal confirms once, refreshes once, and reselects the nearest Source", async () => {
  let removes = 0;
  let gets = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          remove: async () => {
            removes++;
            return { value: undefined, diagnostics: [] };
          },
          get: async () => ({
            value:
              ++gets === 1 ? workspaceProjection() : workspaceProjection({ includeDirect: false }),
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Remove this direct Source declaration?"));
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) =>
        frame.includes("team-config/lark") &&
        !frame.includes("Remove this direct Source declaration?"),
    );
    expect(removes).toBe(1);
    expect(gets).toBe(2);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER preview failure closes its pending surface, retains the exact error, and permits retry", async () => {
  let previews = 0;
  let removes = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          preview: async () => {
            previews++;
            if (previews === 1) throw new SkillCliError("WRITE_FAILED", "preview disk full");
            return {
              value: {
                kind: "source-removal",
                source: "team-main",
                owner: directOwner,
                installed: [],
                repairs: [],
                blockers: [],
                allowed: true,
              },
              diagnostics: [],
            };
          },
          remove: async () => {
            removes++;
            return { value: undefined, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) =>
        frame.includes("WRITE_FAILED: preview disk full") &&
        !frame.includes("Reviewing Source removal impact"),
    );
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Remove this direct Source declaration?"));
    expect(removes).toBe(0);
    expect(previews).toBe(2);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER preview owner mismatch closes the preview, exposes TRANSACTION_CONFLICT, and permits retry", async () => {
  let previews = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          preview: async () => {
            previews++;
            return {
              value: {
                kind: "source-removal",
                source: "team-main",
                owner: previews === 1 ? { ...directOwner, pointer: "/sources/other" } : directOwner,
                installed: [],
                repairs: [],
                blockers: [],
                allowed: true,
              },
              diagnostics: [],
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) =>
        frame.includes(
          "TRANSACTION_CONFLICT: Source removal preview no longer matches the selected declaration",
        ) && !frame.includes("Reviewing Source removal impact"),
    );
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Remove this direct Source declaration?"));
    expect(previews).toBe(2);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER duplicate confirm while removal is pending is inert until one refresh settles", async () => {
  let removes = 0;
  let gets = 0;
  let settleRemove: (() => void) | undefined;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          remove: async () =>
            new Promise<{
              readonly value: undefined;
              readonly diagnostics: [];
            }>((resolve) => {
              removes++;
              settleRemove = () => resolve({ value: undefined, diagnostics: [] });
            }),
          get: async () => ({
            value:
              ++gets === 1 ? workspaceProjection() : workspaceProjection({ includeDirect: false }),
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Remove this direct Source declaration?"));
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => removes === 1);
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    expect(removes).toBe(1);
    settleRemove!();
    await setup.waitForFrame(
      (frame) =>
        frame.includes("team-config/lark") &&
        !frame.includes("Remove this direct Source declaration?"),
    );
    expect(gets).toBe(2);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER late cancelled preview cannot close a newly opened Palette", async () => {
  let resolvePreview: (() => void) | undefined;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          preview: async () =>
            new Promise((resolve) => {
              resolvePreview = () =>
                resolve({
                  value: {
                    kind: "source-removal",
                    source: "team-main",
                    owner: directOwner,
                    installed: [],
                    repairs: [],
                    blockers: [],
                    allowed: true,
                  },
                  diagnostics: [],
                });
            }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Reviewing Source removal impact"));
    await awaitParsedEscape(setup);
    await setup.renderOnce();
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitForFrame((frame) => frame.includes("Palette"));
    resolvePreview!();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Palette");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-menu");
  } finally {
    setup.renderer.destroy();
  }
});
