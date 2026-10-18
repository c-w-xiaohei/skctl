import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";

async function parsedEscape(setup: Awaited<ReturnType<typeof testRender>>) {
  await new Promise<void>((resolve) => {
    const listener = (event: { readonly name: string }) => {
      if (event.name.toLowerCase() === "escape") {
        setup.renderer.keyInput.off("keypress", listener);
        resolve();
      }
    };
    setup.renderer.keyInput.prependListener("keypress", listener);
    setup.mockInput.pressKey("ESCAPE");
  });
  await setup.renderOnce();
}

async function focusSkillsView(
  setup: Awaited<ReturnType<typeof testRender>>,
  value: "current-exposure" | "all-installed-skills" | "unassigned" | "problems",
) {
  const tab = await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById(`skills-view-tab-${value}`),
  );
  void tab;
  setup.renderer.root.findDescendantById(`skills-view-tab-${value}`)!.focus();
  await setup.renderOnce();
}

const noUseProjection = (
  options: {
    readonly direct?: boolean;
    readonly contributed?: boolean;
    readonly globalOnly?: boolean;
    readonly manyDirect?: boolean;
  } = {},
) => {
  const base = workspaceProjection();
  const projectOwner = {
    level: "project" as const,
    file: "/workspace/skill-cli/skill-cli.jsonc",
    pointer: "/collections/project-owned",
  };
  const globalOwner = {
    level: "global" as const,
    file: "/home/user/.config/skill-cli.jsonc",
    pointer: "/collections/global-owned",
  };
  const localOwner = {
    level: "local" as const,
    file: "/workspace/skill-cli/.skill-cli.jsonc",
    pointer: "/collections/local-owned",
  };
  const owned = (
    id: string,
    owner: typeof projectOwner | typeof globalOwner | typeof localOwner,
  ) => [
    { id, owner },
    ...(options.manyDirect
      ? Array.from({ length: 3 }, (_, index) => ({ id: `${id}-${index + 1}`, owner }))
      : []),
  ];
  const direct = options.direct === false ? [] : owned("project-owned", projectOwner);
  return {
    ...base,
    configs: [
      ...base.configs.map((config) =>
        config.level === "global" || config.level === "project"
          ? {
              ...config,
              direct: {
                ...config.direct,
                collections:
                  options.direct === false
                    ? []
                    : config.level === "global"
                      ? owned("global-owned", globalOwner)
                      : direct,
                collectionUse: [],
              },
              contributed:
                config.level === "project" && options.contributed !== false
                  ? { ...config.contributed, collections: ["contributed-only"] }
                  : config.contributed,
            }
          : config,
      ),
      ...(options.direct === false
        ? []
        : [
            {
              ...base.configs.find((config) => config.level === "project")!,
              level: "local" as const,
              file: { status: "valid" as const, file: localOwner.file },
              direct: {
                ...base.configs.find((config) => config.level === "project")!.direct,
                collections: owned("local-owned", localOwner),
                collectionUse: [],
              },
              contributed: { sources: [], collections: [] },
            },
          ]),
    ].filter((config) => !options.globalOnly || config.level === "global"),
    effective: {
      ...base.effective,
      managed: true,
      use: [],
      collections: options.direct === false ? [] : ["global-owned", "project-owned"],
      collectionsView: [],
    },
  };
};

test("RENDER complete managed empty Use exposes deterministic direct-owner repairs only", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(noUseProjection())} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await focusSkillsView(setup, "current-exposure");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("current-exposure-no-use"));
    const repair = setup.renderer.root.findDescendantById(
      "current-exposure-repair",
    ) as SelectRenderable;
    expect(repair.options).toHaveLength(3);
    expect(repair.options.map((option) => option.name)).toEqual([
      `Set Collection Use for global-owned in Global Config  /home/user/.config/skill-cli.jsonc /collections/global-owned`,
      `Set Collection Use for project-owned in Project Config  /workspace/skill-cli/skill-cli.jsonc /collections/project-owned`,
      `Set Collection Use for local-owned in Local Config  /workspace/skill-cli/.skill-cli.jsonc /collections/local-owned`,
    ]);
    expect(setup.captureCharFrame()).not.toContain("Contributed Collection");
    expect(
      setup.renderer.root.findDescendantById("current-exposure-repair-global"),
    ).toBeUndefined();
    expect(
      setup.renderer.root.findDescendantById("current-exposure-repair-project"),
    ).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("installed-skill-browser")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("reader-views")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test.each([120, 80, 43])(
  "RENDER empty Use owner repairs keep every owner row mouse-visible and preserve keyboard identity at %i columns",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(noUseProjection())} exit={() => {}} />,
      { width, height: 30 },
    );
    try {
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("current-exposure-repair"),
      );
      await setup.renderOnce();
      const repair = setup.renderer.root.findDescendantById(
        "current-exposure-repair",
      ) as SelectRenderable;
      expect(repair.height).toBe(3);
      expect(repair.screenY + repair.height).toBeLessThanOrEqual(30);
      expect(setup.captureCharFrame()).toContain("Set Collection Use for project-owned");
      expect(setup.captureCharFrame()).toContain("Set Collection Use for local-owned");
      if (width === 43) {
        expect(setup.captureCharFrame()).toContain("Current Exposure · Collection Use context");
        expect(setup.captureCharFrame()).toContain("Collection Use context");
      }

      for (const [index] of [
        [0, "global"],
        [1, "project"],
        [2, "local"],
      ] as const) {
        const currentRepair = setup.renderer.root.findDescendantById(
          "current-exposure-repair",
        ) as SelectRenderable;
        await setup.mockMouse.click(currentRepair.screenX + 1, currentRepair.screenY + index);
        await setup.waitFor(
          () => !!setup.renderer.root.findDescendantById("config-collection-browser"),
        );
        await parsedEscape(setup);
        await setup.waitFor(
          () => !!setup.renderer.root.findDescendantById("current-exposure-repair"),
        );
        const returned = setup.renderer.root.findDescendantById(
          "current-exposure-repair",
        ) as SelectRenderable;
        expect(returned.getSelectedOption()?.value).toBe(
          `${["global", "project", "local"][index]}:${["global-owned", "project-owned", "local-owned"][index]}`,
        );
      }

      const restored = setup.renderer.root.findDescendantById(
        "current-exposure-repair",
      ) as SelectRenderable;
      restored.focus();
      setup.mockInput.pressKey("ARROW_DOWN");
      setup.mockInput.pressKey("ARROW_DOWN");
      await setup.renderOnce();
      expect(restored.getSelectedOption()?.value).toBe("local:local-owned");
      setup.resize(width === 43 ? 80 : 43, 30);
      await setup.renderOnce();
      const resized = setup.renderer.root.findDescendantById(
        "current-exposure-repair",
      ) as SelectRenderable;
      expect(resized.getSelectedOption()?.value).toBe("local:local-owned");
      setup.mockInput.pressKey("RETURN");
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("config-collection-browser"),
      );
      await parsedEscape(setup);
      const afterKeyboard = setup.renderer.root.findDescendantById(
        "current-exposure-repair",
      ) as SelectRenderable;
      expect(afterKeyboard.getSelectedOption()?.value).toBe("local:local-owned");
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("RENDER long empty Use owner repairs keep native scrolling bounded and expose the selected row", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(noUseProjection({ manyDirect: true }))} exit={() => {}} />,
    { width: 43, height: 30 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("current-exposure-repair"));
    await setup.renderOnce();
    const repair = setup.renderer.root.findDescendantById(
      "current-exposure-repair",
    ) as SelectRenderable;
    expect(repair.options).toHaveLength(12);
    expect(repair.height).toBe(8);
    repair.focus();
    for (let index = 0; index < repair.options.length - 1; index++) {
      setup.mockInput.pressKey("ARROW_DOWN");
      await setup.renderOnce();
    }
    expect(repair.getSelectedOption()?.value).toBe("local:local-owned-3");
    expect((repair as unknown as { readonly scrollOffset: number }).scrollOffset).toBeGreaterThan(
      0,
    );
    expect(setup.captureCharFrame()).toContain("local-owned-3");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER empty Use repair activates by keyboard, focuses the owning Config, and Esc returns", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(noUseProjection())} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await focusSkillsView(setup, "current-exposure");
    await setup.waitForFrame((frame) => frame.includes("Set Collection Use for global-owned"));
    const repair = setup.renderer.root.findDescendantById("current-exposure-repair")!;
    repair.focus();
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("current-exposure-repair");
    setup.mockInput.pressKey("RETURN");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Back -> Workspace / Skills");
    expect(setup.renderer.root.findDescendantById("config-collection-browser")).toBeDefined();
    await parsedEscape(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("current-exposure-repair");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER empty Use pointer repair records its mounted control before routing and Esc returns to it", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(noUseProjection())} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("current-exposure-repair"));
    const repair = setup.renderer.root.findDescendantById(
      "current-exposure-repair",
    ) as SelectRenderable;
    await setup.mockMouse.click(repair.screenX + 1, repair.screenY);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("config-collection-browser"),
    );
    await parsedEscape(setup);
    expect(setup.renderer.root.findDescendantById("current-exposure-repair")).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("current-exposure-repair");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER narrow empty Use keeps one focused repair control and returns without opening Skills or Reader", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(noUseProjection())} exit={() => {}} />,
    { width: 43, height: 30 },
  );
  try {
    await focusSkillsView(setup, "current-exposure");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("current-exposure-no-use"));
    const repair = setup.renderer.root.findDescendantById("current-exposure-repair")!;
    repair.focus();
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("current-exposure-repair");
    expect(setup.renderer.root.findDescendantById("current-exposure-repair")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("installed-skill-browser")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("reader-views")).toBeUndefined();
    await parsedEscape(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("current-exposure-repair");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER empty Use with no direct Collections offers one navigation-only creation route", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(noUseProjection({ direct: false, contributed: false }))}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("current-exposure-no-use"));
    const repair = setup.renderer.root.findDescendantById("current-exposure-repair")!;
    expect(setup.captureCharFrame()).toContain("Open Project Collections to create a Collection");
    await setup.mockMouse.click(repair.screenX + 1, repair.screenY);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("config-command-new-collection"),
    );
    expect(setup.renderer.root.findDescendantById("config-command-new-collection")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER global-only empty Use still targets the Project Collections creation route", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(
          noUseProjection({ direct: false, contributed: false, globalOnly: true }),
        )}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("current-exposure-repair"));
    const repair = setup.renderer.root.findDescendantById("current-exposure-repair")!;
    expect(setup.captureCharFrame()).toContain("Open Project Collections to create a Collection");
    await setup.mockMouse.click(repair.screenX + 1, repair.screenY);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("config-command-new-collection"),
    );
    expect(setup.renderer.root.findDescendantById("config-command-new-collection")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER unmanaged Current Exposure visibly exposes Managed OpenCode recovery at 120 and 80 columns", async () => {
  for (const width of [120, 80] as const) {
    const setup = await testRender(
      () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
      { width, height: 30 },
    );
    try {
      await focusSkillsView(setup, "current-exposure");
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("current-exposure-enable-managed-opencode"),
      );
      const frame = setup.captureCharFrame();
      expect(frame).toContain("Current Exposure is unavailable.");
      expect(frame).toContain("Enable Managed OpenCode in Project Config");
    } finally {
      setup.renderer.destroy();
    }
  }
});

test("RENDER 43-column unmanaged Current Exposure visibly exposes Managed OpenCode recovery", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    { width: 43, height: 30 },
  );
  try {
    await focusSkillsView(setup, "current-exposure");
    await setup.waitForFrame((frame) => frame.includes("Enable Managed OpenCode"));
    expect(setup.captureCharFrame()).toContain("Enable Managed OpenCode");
    expect(
      setup.renderer.root.findDescendantById("current-exposure-enable-managed-opencode"),
    ).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER focused unmanaged recovery opens the existing Managed OpenCode review with Enter", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await focusSkillsView(setup, "current-exposure");
    setup.renderer.root.findDescendantById("current-exposure-enable-managed-opencode")!.focus();
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === "current-exposure-enable-managed-opencode",
    );
    setup.mockInput.pressEnter();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-operation-review"));
    expect(setup.renderer.root.findDescendantById("config-operation-review")).toBeDefined();
    await parsedEscape(setup);
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === "current-exposure-enable-managed-opencode",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER App context controls traverse Config review from Cancel to Confirm and execute once", async () => {
  let changes = 0;
  const core = directSourceCore(workspaceProjection(), {
    setManagedOpenCode: async () => {
      changes++;
      return {
        value: { level: "project" as const, file: "skill-cli.jsonc", changed: true },
        diagnostics: [],
      };
    },
  });
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 30,
  });
  try {
    await focusSkillsView(setup, "current-exposure");
    const action = await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("current-exposure-enable-managed-opencode"),
    );
    void action;
    setup.renderer.root.findDescendantById("current-exposure-enable-managed-opencode")!.focus();
    setup.mockInput.pressEnter();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-operation-review"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-operation-review");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-operation-confirm",
    );
    setup.mockInput.pressEnter();
    await setup.waitFor(() => changes === 1);
    await setup.renderOnce();
    expect(changes).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER successful Managed OpenCode recovery refreshes into the empty Collection Use repair", async () => {
  let current = workspaceProjection();
  const core = directSourceCore(current, {
    setManagedOpenCode: async () => {
      current = noUseProjection();
      return {
        value: { level: "project" as const, file: "skill-cli.jsonc", changed: true },
        diagnostics: [],
      };
    },
    workspace: { get: async () => ({ value: current, diagnostics: [] }) },
  });
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 30,
  });
  try {
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("current-exposure-enable-managed-opencode"),
    );
    const action = setup.renderer.root.findDescendantById(
      "current-exposure-enable-managed-opencode",
    )!;
    action.focus();
    setup.mockInput.pressEnter();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-operation-review"));

    expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-operation-review");
    await parsedEscape(setup);
    await setup.waitFor(
      () =>
        !!setup.renderer.root.findDescendantById("current-exposure-enable-managed-opencode") &&
        !setup.renderer.root.findDescendantById("config-operation-review"),
    );

    (setup.renderer.root.findDescendantById(
      "current-exposure-enable-managed-opencode",
    ) as SelectRenderable)!.focus();
    setup.mockInput.pressEnter();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-operation-review"));

    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-operation-confirm",
    );
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () =>
        !!setup.renderer.root.findDescendantById("current-exposure-no-use") &&
        !!setup.renderer.root.findDescendantById("current-exposure-repair") &&
        !setup.renderer.root.findDescendantById("config-operation-review"),
    );
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Current Exposure has no Collection Use roots.") &&
        frame.includes("Set Collection Use"),
    );
    expect(setup.captureCharFrame()).toContain("Current Exposure has no Collection Use roots.");
    expect(setup.captureCharFrame()).toContain("Set Collection Use");
    expect(
      setup.renderer.root.findDescendantById("current-exposure-enable-managed-opencode"),
    ).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test.each([120, 80, 43])(
  "Current Exposure uses readable count labels and preserves Reference identity at width %i",
  async (width) => {
    const base = readerProjection();
    if (base.effective.status !== "complete") throw new Error("expected complete projection");
    const owner = {
      level: "project" as const,
      file: "/project.jsonc",
      pointer: "/collections/root",
    };
    const installedSkills = ["guide", "reference"].map((name) => ({
      address: { source: "team-main", path: name },
      name,
      description: "",
      owner: { source: "team-main", health: "healthy" as const },
      collections: [],
      selectors: [`root:${name}`],
      selectorViews: {
        status: "complete" as const,
        values: [
          {
            collection: "root",
            selector: `root:${name}`,
            entry: name,
            paths: [],
            useOwners: [owner],
          },
        ],
      },
      aliases: [],
      problems: [],
    }));
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore({
            ...base,
            installedSkills,
            effective:
              base.effective.status === "complete"
                ? {
                    ...base.effective,
                    managed: true,
                    use: ["root"],
                    collectionsView: [
                      {
                        id: "root",
                        declared: [owner],
                        repository: { derived: false, producers: [] },
                        members: [],
                        references: [{ name: "Docs", collection: "docs", description: "", owner }],
                        links: [],
                      },
                      {
                        id: "docs",
                        declared: [owner],
                        repository: { derived: false, producers: [] },
                        members: [],
                        references: [],
                        links: [],
                      },
                    ],
                  }
                : base.effective,
          })}
          exit={() => {}}
        />
      ),
      { width, height: 40 },
    );
    try {
      await focusSkillsView(setup, "current-exposure");
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("current-exposure-browser"),
      );
      const browser = setup.renderer.root.findDescendantById(
        "current-exposure-browser",
      ) as SelectRenderable;
      const root = browser.options[0]!;
      const reference = browser.options[1]!;
      expect(browser.options).toHaveLength(2);
      expect(root.value).toBe("root");
      expect(reference.value).toBe("root/Docs");
      expect(root.name).toBe(
        width >= 100
          ? "[-] Use root -> Collection details · 2 selectors · 2 installed skills"
          : "[-] Use root -> Collection details",
      );
      expect(reference.name).toBe(
        width >= 100
          ? "  [+] Reference Docs · docs -> Collection details · 0 selectors · 0 installed skills"
          : "  [+] Reference Docs · docs -> Collection details",
      );
      expect(browser.showDescription).toBe(width < 100);
      expect(root.description).toBe(width >= 100 ? "" : "2 selectors · 2 installed skills");
      expect(reference.description).toBe(width >= 100 ? "" : "0 selectors · 0 installed skills");
      expect(root.name).not.toMatch(/·\d+[sk]\b/);
      expect(reference.name).not.toMatch(/·\d+[sk]\b/);
      expect(
        browser.options.every(
          (option) => !`${option.name} ${option.description}`.match(/\b\d+[sk]\b/),
        ),
      ).toBe(true);
      await setup.waitForFrame((frame) =>
        frame.includes(width >= 100 ? "PATH (counts inline)" : "PATH (counts below)"),
      );
      if (width < 100)
        expect(setup.captureCharFrame()).toContain("2 selectors · 2 installed skills");
      expect(browser.screenY + browser.height).toBeLessThanOrEqual(40);

      browser.focus();
      setup.mockInput.pressKey("ARROW_LEFT");
      await setup.renderOnce();
      expect(browser.options).toHaveLength(1);
      expect(browser.getSelectedOption()?.value).toBe("root");
      setup.mockInput.pressKey("ARROW_RIGHT");
      await setup.waitFor(
        () =>
          (setup.renderer.root.findDescendantById("current-exposure-browser") as SelectRenderable)
            .options.length === 2,
      );
      const expanded = setup.renderer.root.findDescendantById(
        "current-exposure-browser",
      ) as SelectRenderable;
      expanded.setSelectedIndex(1);
      setup.mockInput.pressEnter();
      await setup.waitForFrame((frame) => frame.includes("docs") && frame.includes("Entries"));
      expect(setup.renderer.root.findDescendantById("collection-tabs-tab-entries")).toBeDefined();
    } finally {
      setup.renderer.destroy();
    }
  },
);
