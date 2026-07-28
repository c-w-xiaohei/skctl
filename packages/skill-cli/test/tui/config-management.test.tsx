import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { ManagementProjection } from "../../src/core/api";
import { App } from "../../src/tui/app";
import { ConfigPage } from "../../src/tui/config-page";
import { createTuiState } from "../../src/tui/model";
import { SourceRegistrationOverlay } from "../../src/tui/operations";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";

async function pressEscape(setup: Awaited<ReturnType<typeof testRender>>) {
  await new Promise<void>((resolve) => {
    const listener = (event: { readonly name: string }) => {
      if (event.name === "escape" || event.name === "esc") {
        setup.renderer.keyInput.off("keypress", listener);
        resolve();
      }
    };
    setup.renderer.keyInput.prependListener("keypress", listener);
    setup.mockInput.pressKey("ESCAPE");
  });
}

function configProjection(): ManagementProjection {
  const base = workspaceProjection();
  const global = base.configs[0]!;
  const project = base.configs[1]!;
  const owner = {
    level: "project" as const,
    file: "/workspace/skill-cli/skill-cli.jsonc",
    pointer: "/collections/team",
  };
  const configOwner = {
    level: "project" as const,
    file: "/workspace/skill-cli/skill-cli.jsonc",
    pointer: "/configSources/team",
  };
  const contributedSource = {
    id: "team/lark",
    kind: "github" as const,
    origin: "https://github.com/acme/skills",
    root: "skills",
    ref: "main",
    provenance: { level: "project" as const, pointer: "/sources/lark", namespace: "team@commit" },
    contribution: {
      configSource: configOwner,
      declaration: {
        level: "project" as const,
        pointer: "/sources/lark",
        namespace: "team@commit",
      },
    },
    selectors: [],
  };
  return {
    ...base,
    configs: [
      {
        ...global,
        direct: {
          ...global.direct,
          collections: [
            { id: "global-team", owner: { ...owner, level: "global", file: global.file.file } },
          ],
        },
      },
      {
        ...project,
        direct: {
          ...project.direct,
          configSources: [
            {
              id: "team",
              owner: configOwner,
              binding: {
                kind: "github" as const,
                origin: "https://github.com/acme/config",
                root: "",
                ref: "main",
              },
              adoption: { status: "adopted" as const, commit: "a".repeat(40) },
              contributed: {
                sources: [contributedSource],
                collections: [
                  {
                    id: "team/docs",
                    owner: {
                      level: "project" as const,
                      file: configOwner.file,
                      pointer: "/configSources/team/collections/docs",
                      contribution: {
                        configSource: configOwner,
                        declaration: {
                          level: "project" as const,
                          pointer: "/collections/docs",
                          namespace: "team@commit",
                        },
                      },
                    },
                  },
                ],
              },
            },
          ],
          collections: [{ id: "team", owner }],
          collectionUse: [{ collection: "team", owner: { ...owner, pointer: "/use/0" } }],
          integrations: [{ kind: "opencode", owner: { ...owner, pointer: "/agents/opencode" } }],
        },
        contributed: {
          ...project.contributed,
          sources: [contributedSource],
          collections: ["contributed-team", "team/docs"],
        },
      },
      {
        level: "project",
        file: { status: "missing", file: "/workspace/skill-cli/.skill-cli.jsonc" },
        direct: {
          sources: [],
          configSources: [],
          collections: [],
          collectionUse: [],
          integrations: [],
        },
        contributed: { sources: [], collections: [] },
      },
    ],
  };
}

async function openDestination(
  setup: Awaited<ReturnType<typeof testRender>>,
  destination: "global" | "project" | "local",
) {
  setup.mockInput.pressKey("P", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
  const index = ["global", "project", "local"].indexOf(destination) + 1;
  for (let value = 0; value < index; value++) setup.mockInput.pressArrow("down");
  setup.mockInput.pressEnter();
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "config-source-browser",
  );
  await setup.renderOnce();
}

test("RENDER Workspace Collections reaches Global, Project, and Local Config through the physical palette", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
    for (const destination of ["global", "project", "local"] as const) {
      await openDestination(setup, destination);
      expect(setup.captureCharFrame()).toContain("Direct sources");
      setup.mockInput.pressKey("P", { ctrl: true });
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
      setup.mockInput.pressEnter();
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-browser",
      );
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER selected Config Source contribution controls expose exact projection relationships", async () => {
  const routes: unknown[] = [];
  const state = {
    ...createTuiState(),
    workspace: configProjection(),
    destination: "project" as const,
    focus: "config-source-contributions" as const,
    memory: {
      ...createTuiState().memory,
      project: {
        ...createTuiState().memory.project,
        section: "config-sources" as const,
        selection: {
          ...createTuiState().memory.project.selection,
          "config-sources": "/configSources/team",
        },
      },
    },
  };
  const setup = await testRender(
    () => (
      <ConfigPage
        state={state}
        destination="project"
        actions={[]}
        onSelect={() => {}}
        onActions={() => {}}
        onSection={() => {}}
        onContribution={(value) => routes.push(value)}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-source-contributions",
    );
    expect(setup.captureCharFrame()).toContain("Source  team/lark");
    expect(setup.captureCharFrame()).toContain("Collection  team/docs");
    setup.mockInput.pressEnter();
    expect(routes).toEqual([
      {
        kind: "source",
        source: expect.objectContaining({ id: "team/lark" }),
        owner: expect.objectContaining({ pointer: "/configSources/team" }),
      },
    ]);
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    expect(routes[1]).toEqual({
      kind: "collection",
      collection: "team/docs",
      owner: expect.objectContaining({ pointer: "/configSources/team/collections/docs" }),
    });
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Config section selector physically navigates sources, collections, agents, and integrations", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser",
    );
    await openDestination(setup, "project");
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-section-browser",
    );
    const sections = setup.renderer.root.findDescendantById(
      "config-section-browser",
    ) as SelectRenderable;
    expect(sections.options.map((option) => option.value)).toEqual([
      "sources",
      "config-sources",
      "collections",
      "for-agents",
      "integrations",
    ]);
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-collection-browser",
    );
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("team (project)");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Source registration validates and submits a fixed-level local binding through physical keyboard input", async () => {
  const submitted: unknown[] = [];
  let cancelled = 0;
  const setup = await testRender(
    () => (
      <SourceRegistrationOverlay
        kind="source"
        level="local"
        pending={false}
        onSubmit={(value) => submitted.push(value)}
        onCancel={() => {
          cancelled++;
        }}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-kind",
    );
    expect(setup.captureCharFrame()).toContain(
      "Enter an ID, configured local path, and source root.",
    );
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["t", "e", "a", "m"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["/", "s", "h", "a", "r", "e", "d"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["s", "k", "i", "l", "l", "s"]);
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-register-choice");
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    expect(submitted).toEqual([
      { level: "local", id: "team", binding: { kind: "local", path: "/shared", root: "skills" } },
    ]);
    await pressEscape(setup);
    expect(cancelled).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER workspace Config Source registration selects its owner and submits a credential-free remote binding", async () => {
  const submitted: unknown[] = [];
  const setup = await testRender(
    () => (
      <SourceRegistrationOverlay
        kind="config-source"
        pending={false}
        onSubmit={(value) => submitted.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-level",
    );
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["t", "e", "a", "m"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys([
      "h",
      "t",
      "t",
      "p",
      "s",
      ":",
      "/",
      "/",
      "g",
      "i",
      "t",
      "h",
      "u",
      "b",
      ".",
      "c",
      "o",
      "m",
      "/",
      "a",
      "c",
      "m",
      "e",
      "/",
      "c",
      "o",
      "n",
      "f",
      "i",
      "g",
    ]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["x"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["s", "k", "i", "l", "l", "s"]);
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    expect(submitted).toEqual([
      {
        level: "project",
        id: "team",
        binding: {
          kind: "git",
          origin: "https://github.com/acme/config",
          ref: "mainx",
          root: "skills",
        },
      },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER GitHub registration traverses owner and repository in both directions and submits structured fields", async () => {
  const submitted: unknown[] = [];
  const setup = await testRender(
    () => (
      <SourceRegistrationOverlay
        kind="source"
        level="project"
        pending={false}
        onSubmit={(value) => submitted.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-kind",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["t", "e", "a", "m"]);
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-github-owner",
    );
    await setup.mockInput.pressKeys(["a", "c", "m", "e"]);
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-github-repository",
    );
    await setup.mockInput.pressKeys(["s", "k", "i", "l", "l", "s"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["v", "1"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["a", "g", "e", "n", "t", "s"]);
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-ref",
    );
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    expect(submitted).toEqual([
      {
        level: "project",
        id: "team",
        binding: {
          kind: "github",
          owner: "acme",
          repository: "skills",
          origin: "https://github.com/acme/skills",
          ref: "mainv1",
          root: "agents",
        },
      },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Source registration repeatedly replaces dynamic controls without retaining destroyed inputs", async () => {
  const submitted: unknown[] = [];
  const setup = await testRender(
    () => (
      <SourceRegistrationOverlay
        kind="source"
        level="project"
        pending={false}
        onSubmit={(value) => submitted.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-kind",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["t", "e", "a", "m"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["a", "c", "m", "e"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["s", "k", "i", "l", "l", "s"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["v", "1"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["a", "g", "e", "n", "t", "s"]);

    for (let index = 0; index < 5; index++) setup.mockInput.pressKey("TAB", { shift: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-kind",
    );
    setup.mockInput.pressArrow("up");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
    await setup.mockInput.pressKeys(["h", "t", "t", "p", "s", ":", "/", "/", "g", "i", "t"]);

    setup.mockInput.pressKey("TAB", { shift: true });
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-kind",
    );
    setup.mockInput.pressArrow("up");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
    await setup.mockInput.pressKeys(["/", "l", "o", "c", "a", "l"]);

    setup.mockInput.pressKey("TAB", { shift: true });
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-kind",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-github-owner",
    );
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-choice",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();

    expect(submitted).toEqual([
      {
        level: "project",
        id: "team",
        binding: {
          kind: "github",
          owner: "acme",
          repository: "skills",
          origin: "https://github.com/acme/skills",
          ref: "mainv1",
          root: "agents",
        },
      },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});
