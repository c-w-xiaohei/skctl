import type { ManagementProjection, ResourceDescriptor } from "@skill-cli/core";
import { directOwner, workspaceProjection } from "./direct-source.fixture";

export const readerAddress = { source: "team-main", path: "guide" };
export const readerSecondAddress = { source: "team-main", path: "reference" };
export const sourceFilteredAddress = { source: "team-main", path: "review" };
export const otherSourceFilteredAddress = { source: "other", path: "review" };

export const readerProjection = (): ManagementProjection => ({
  ...workspaceProjection(),
  installedSkills: [
    {
      address: readerAddress,
      name: "guide",
      description: "A rich Installed Skill",
      owner: {
        source: "team-main",
        health: "healthy",
        relevantRemoteRevision: "abc123",
      },
      source: {
        id: "team-main",
        kind: "github",
        origin: "https://github.com/acme/main",
        root: "skills",
        ref: "main",
        provenance: { level: "project" },
        selectors: [],
      },
      collections: [],
      selectors: [],
      selectorViews: { status: "unavailable" },
      aliases: [],
      problems: [],
    },
    {
      address: readerSecondAddress,
      name: "reference",
      description: "A distinct Installed Skill",
      owner: {
        source: "team-main",
        health: "healthy",
        relevantRemoteRevision: "abc123",
      },
      source: {
        id: "team-main",
        kind: "github",
        origin: "https://github.com/acme/main",
        root: "skills",
        ref: "main",
        provenance: { level: "project" },
        selectors: [],
      },
      collections: [],
      selectors: [],
      selectorViews: { status: "unavailable" },
      aliases: [],
      problems: [],
    },
  ],
  configs: workspaceProjection().configs.map((config) =>
    config.level === "project"
      ? {
          ...config,
          direct: {
            ...config.direct,
            sources: [
              {
                id: "team-main",
                kind: "github",
                origin: "https://github.com/acme/main",
                root: "skills",
                provenance: { level: "project" },
                selectors: [],
                ref: { id: "team-main", owner: directOwner },
              },
            ],
          },
        }
      : config,
  ),
});

export const sourceFilteredReaderProjection = (): ManagementProjection => {
  const projection = readerProjection();
  return {
    ...projection,
    installedSkills: [
      ...projection.installedSkills,
      {
        address: sourceFilteredAddress,
        name: "review",
        description: "Team review",
        owner: { source: "team-main", health: "healthy" },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" },
        aliases: [],
        problems: [],
      },
      {
        address: otherSourceFilteredAddress,
        name: "other review",
        description: "Other review",
        owner: { source: "other", health: "healthy" },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" },
        aliases: [],
        problems: [],
      },
    ],
  };
};

export const readerContent = {
  address: readerAddress,
  name: "guide",
  description: "A rich Installed Skill",
  rawText: `---\ntitle: Guide\n---\n# Guide\n\nneedle in prose\n\n- first\n- second\n\n| Name | Value |\n| --- | --- |\n| link | [docs](https://example.com) |\n\n\`\`\`ts\nconst needle = true;\n\`\`\`\n\nneedle again\n`,
  markdownText: `# Guide\n\nneedle in prose\n\n- first\n- second\n\n| Name | Value |\n| --- | --- |\n| link | [docs](https://example.com) |\n\n\`\`\`ts\nconst needle = true;\n\`\`\`\n\nneedle again\n`,
};

export const readerSecondContent = {
  address: readerSecondAddress,
  name: "reference",
  description: "A distinct Installed Skill",
  rawText: `---\ntitle: Reference\n---\n# Reference\n\nother needle\n\nreference needle\n`,
  markdownText: `# Reference\n\nother needle\n\nreference needle\n`,
};

export const readerResources: readonly ResourceDescriptor[] = [
  { path: "docs", kind: "directory" },
  { path: "docs/guide.md", kind: "file", size: 12 },
  { path: "bin/run", kind: "file", size: 4, executable: true },
  { path: "blob.bin", kind: "file", size: 8 },
  { path: "link", kind: "symlink" },
  { path: "submodule", kind: "gitlink", gitlinkCommit: "deadbeef" },
];
