import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directOwner, directSourceCore, workspaceProjection } from "./direct-source.fixture";

const address = { source: "team-main", path: "guide" };
const globalCollectionOwner = {
  level: "global" as const,
  file: "/home/user/.config/skill-cli.jsonc",
  pointer: "/collections/personal",
};

function detailsProjection() {
  const base = workspaceProjection();
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "global"
        ? {
            ...config,
            direct: {
              ...config.direct,
              collections: [{ id: "personal", owner: globalCollectionOwner }],
            },
          }
        : config.level === "project"
          ? {
              ...config,
              direct: {
                ...config.direct,
                collections: [{ id: "engineering", owner: directOwner }],
              },
            }
          : config,
    ),
    effective: {
      ...base.effective,
      collectionsView: [
        {
          id: "engineering",
          declared: [directOwner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
        {
          id: "personal",
          declared: [globalCollectionOwner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
        {
          id: "derived-only",
          declared: [],
          repository: { derived: true, producers: [address] },
          members: [],
          references: [],
          links: [],
        },
      ],
      sources: [
        ...base.effective.sources,
        {
          id: "replacement",
          kind: "git" as const,
          origin: "https://example.test/replacement",
          root: "skills",
          ref: "main",
          provenance: { level: "project" as const },
          selectors: [],
        },
      ],
    },
    installedSkills: [
      {
        address,
        name: "guide",
        description: "A detailed Installed Skill",
        owner: {
          source: "team-main",
          health: "healthy" as const,
          relevantRemoteRevision: "abc123",
        },
        source: base.effective.sources[0]!,
        collections: [
          {
            id: "engineering",
            entry: "guide",
            paths: [
              {
                kind: "direct" as const,
                collection: "engineering",
                entryName: "guide",
                owner: directOwner,
              },
              {
                kind: "via-link" as const,
                links: [
                  {
                    collection: "docs",
                    linkedCollection: "engineering",
                    owner: directOwner,
                  },
                ],
              },
              {
                kind: "repository-derived" as const,
                repository: "acme/main",
                source: "team-main",
                path: "guide",
              },
            ],
          },
        ],
        selectors: ["engineering:guide"],
        selectorViews: {
          status: "complete" as const,
          values: [
            {
              selector: "engineering:guide",
              collection: "engineering",
              entry: "guide",
              paths: [
                {
                  kind: "direct" as const,
                  collection: "engineering",
                  entryName: "guide",
                  owner: directOwner,
                },
                {
                  kind: "via-link" as const,
                  links: [
                    {
                      collection: "docs",
                      linkedCollection: "engineering",
                      owner: directOwner,
                    },
                  ],
                },
                {
                  kind: "repository-derived" as const,
                  repository: "acme/main",
                  source: "team-main",
                  path: "guide",
                },
              ],
              useOwners: [directOwner],
            },
          ],
        },
        primary: "engineering:guide",
        aliases: ["docs:guide"],
        problems: [
          { code: "SOURCE_DRIFT", severity: "warning" as const, message: "Observed binding drift" },
        ],
      },
    ],
  };
}

test("Details renders Core-backed provenance and opens exact agent path choices through native input", async () => {
  const projection = detailsProjection();
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, {
          loadInstalled: async () => ({
            value: {
              address,
              name: "guide",
              description: "A detailed Installed Skill",
              rawText: "# Guide",
              markdownText: "# Guide",
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
    await setup.renderOnce();
    await Promise.resolve();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-tabs"));
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.renderOnce();
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    setup.mockInput.pressKey("ARROW_RIGHT");
    setup.mockInput.pressKey("ARROW_RIGHT");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Source Root"));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("team-main/guide");
    expect(frame).toContain("Config  project (/sources/team-main)");
    expect(frame).toContain("engineering:guide");
    expect(frame).toContain("Membership  engineering:guide");
    expect(frame).toContain("Repository-derived  acme/main");
    expect(frame).toContain("Collection Use  project");
    expect(frame).toContain("Observed binding drift");
    expect(frame).not.toContain("Materialization");
    expect(frame).not.toContain("Snapshot");
    expect(frame).not.toContain("Registry");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-details-actions",
    );
    setup.mockInput.pressEnter();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-action-menu");
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await Promise.resolve();
    await setup.renderOnce();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "agent-path-choice");
    expect(setup.captureCharFrame()).toContain("Membership engineering:guide");
    expect(setup.captureCharFrame()).toContain("Link docs->engineering");
    expect(setup.captureCharFrame()).toContain("Collection Use project");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-collection-browser",
    );
    expect(setup.captureCharFrame()).toContain("engineering (project)");
  } finally {
    setup.renderer.destroy();
  }
});
