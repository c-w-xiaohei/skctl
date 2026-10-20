import { expect, test } from "bun:test";
import { skillsStatus } from "../src/workspace/skills-status";
import { workspaceProjection } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";

test("empty guidance distinguishes missing configuration, installed inventory and optional Agent setup", () => {
  const empty = workspaceProjection({ includeDirect: false, includeContribution: false });
  expect(skillsStatus(empty)?.action).toBe("add-source");
  expect(skillsStatus(workspaceProjection())?.action).toBe("browse-sources");
  const installed = readerProjection();
  expect(skillsStatus(installed)?.action).toBe("create-collection");
  expect(skillsStatus(installed, undefined, false)).toBeUndefined();
  expect(skillsStatus({ ...empty, installedSkills: installed.installedSkills })?.action).toBe(
    "configuration",
  );
  expect(
    skillsStatus({ ...empty, installedSkills: installed.installedSkills }, undefined, false),
  ).toBeUndefined();
  const previous = {
    ...empty,
    diagnostics: [
      {
        code: "PREVIOUS_DATA_FOUND",
        severity: "warning" as const,
        message: "Previous installation: /home/user/.local/state/skill-cli/state.json",
      },
    ],
  };
  expect(skillsStatus(previous)?.action).toBe("configuration");
  if (empty.effective.status !== "complete") throw new Error("Expected complete fixture");
  expect(
    skillsStatus({ ...empty, effective: { ...empty.effective, collections: ["empty"] } })?.action,
  ).toBe("add-source");
  expect(
    skillsStatus({
      ...empty,
      effective: {
        ...empty.effective,
        managed: true,
        use: ["empty"],
        collections: ["empty"],
        agent: { ...empty.effective.agent, status: "available" },
      },
    }),
  ).toBeUndefined();
  expect(skillsStatus(undefined)?.title).toContain("Loading");
  expect(
    skillsStatus(empty, {
      code: "CONFIG_INVALID",
      severity: "warning",
      message: "state.json cannot be read",
    })?.action,
  ).toBe("retry");
  expect(
    skillsStatus({
      ...empty,
      effective: {
        status: "unavailable",
        sources: [],
        collections: [],
        agent: empty.effective.agent,
        reasons: [
          { code: "CONFIG_PARSE_FAILED", severity: "warning", message: "Invalid JSONC at line 12" },
        ],
      },
    })?.title,
  ).toBe("Could not read your configuration");
});
