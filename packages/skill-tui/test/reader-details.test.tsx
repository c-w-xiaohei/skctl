import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import {
  directOwner,
  directSourceCore,
  openReaderFromInspector,
  workspaceProjection,
} from "./direct-source.fixture";
import { openAllInstalledSkills, openReaderTab } from "./reader-test-controls";

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

test("Details renders provenance and routes Collection Use to its owning Config Collection", async () => {
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
    await openAllInstalledSkills(setup);
    await openReaderFromInspector(setup);
    await openReaderTab(setup, 2);
    await setup.waitForFrame((frame) => frame.includes("Summary"));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("team-main/guide");
    expect(frame).toContain("Summary");
    expect(frame).toContain("Health  healthy");
    expect(frame).toContain("Problems  SOURCE_DRIFT: Observed");
    expect(frame).toContain("binding drift");
    expect(frame).toContain("Source, Config & agent metadata");
    expect(frame).not.toContain("For agents");
    expect(frame).not.toContain("Source Root");
    expect(frame).not.toContain("Config  project (/sources/team-main)");
    expect(frame.indexOf("Summary")).toBeLessThan(frame.indexOf("Source, Config & agent metadata"));
    expect(frame).not.toContain("Materialization");
    expect(frame).not.toContain("Snapshot");
    expect(frame).not.toContain("Registry");
    expect(
      setup.renderer.root.findDescendantById("reader-details-action-skill-add-to-collection"),
    ).toBeDefined();
    expect(
      setup.renderer.root.findDescendantById("reader-details-relationship-source"),
    ).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
