import { expect, test } from "bun:test";
import type { WorkspaceView } from "@skill-cli/core";
import { deriveAgentAccessTree, exposureTreePathKey } from "../src/collections/agent-access-tree";
import { readerProjection } from "./installed-reader.fixture";

const owner = { level: "project" as const, file: "/project.jsonc", pointer: "/collections" };

function projection(): WorkspaceView {
  const base = readerProjection();
  return {
    ...base,
    effective: {
      ...base.effective,
      status: "complete",
      managed: true,
      use: ["root"],
      agent: { ...base.effective.agent, status: "available" },
      collectionsView: [
        {
          id: "root",
          description: "Root description",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [
            { name: "z-skill", address: { source: "team-main", path: "guide" }, paths: [] },
            { name: "a-skill", address: { source: "team-main", path: "reference" }, paths: [] },
          ],
          references: [
            { name: "child", collection: "child", description: "Reference explanation", owner },
            {
              name: "missing",
              collection: "absent",
              description: "Missing target explanation",
              owner,
            },
          ],
          links: [],
        },
        {
          id: "child",
          description: "Child description",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [
            { name: "z-skill", address: { source: "team-main", path: "guide" }, paths: [] },
          ],
          references: [
            { name: "back", collection: "root", description: "Cycle explanation", owner },
          ],
          links: [],
        },
      ],
    },
  };
}

test("Agent access starts with collapsed Use roots and derives one expanded layer", () => {
  const initial = deriveAgentAccessTree(projection());
  expect(initial.status).toBe("available");
  if (initial.status !== "available") return;
  expect(initial.rows.map(({ kind, name, description }) => [kind, name, description])).toEqual([
    ["collection", "root", "Root description"],
  ]);

  const root = initial.rows[0]!;
  const expanded = deriveAgentAccessTree(projection(), { [root.key]: true });
  if (expanded.status !== "available") throw new Error("expected available tree");
  expect(expanded.rows.map((row) => [row.kind, row.name])).toEqual([
    ["collection", "root"],
    ["reference", "child"],
    ["reference", "missing"],
    ["skill", "a-skill"],
    ["skill", "z-skill"],
  ]);
  expect(expanded.rows[1]).toMatchObject({ description: "Reference explanation", target: "child" });
  expect(expanded.rows[2]).toMatchObject({
    missingReason: "Referenced Collection 'absent' is unavailable",
  });
});

test("Agent access preserves repeated target paths and displays only ancestor cycles as sentinels", () => {
  const source = projection();
  if (source.effective.status !== "complete") throw new Error("expected complete projection");
  const complete = source.effective;
  const tree = {
    ...source,
    effective: {
      ...complete,
      use: ["root", "child"],
      collectionsView: complete.collectionsView.map((collection) =>
        collection.id === "root"
          ? {
              ...collection,
              references: [
                ...collection.references,
                { name: "again", collection: "child", description: "Second route", owner },
              ],
            }
          : collection,
      ),
    },
  } satisfies WorkspaceView;
  const roots = deriveAgentAccessTree(tree);
  if (roots.status !== "available") throw new Error("expected available tree");
  expect(roots.rows.map((row) => row.key)).toEqual([
    exposureTreePathKey({ segments: [{ collection: "child" }] }),
    exposureTreePathKey({ segments: [{ collection: "root" }] }),
  ]);
  const root = roots.rows.find((row) => row.name === "root")!;
  const layer = deriveAgentAccessTree(tree, { [root.key]: true });
  if (layer.status !== "available") throw new Error("expected available tree");
  const childRoutes = layer.rows.filter(
    (row) => row.kind === "reference" && row.target === "child",
  );
  expect(childRoutes).toHaveLength(2);
  for (const child of childRoutes) {
    const descendants = deriveAgentAccessTree(tree, { [root.key]: true, [child.key]: true });
    if (descendants.status !== "available") throw new Error("expected available tree");
    const cycle = descendants.rows.find((row) => row.kind === "reference" && row.name === "back");
    expect(cycle).toMatchObject({ cycle: true, description: "Cycle explanation" });
  }
});

test("Link-merged effective members stay as local Skill leaves without traversing the Link target", () => {
  const source = projection();
  if (source.effective.status !== "complete") throw new Error("expected complete projection");
  const effective = source.effective;
  const linked = {
    ...source,
    effective: {
      ...effective,
      collectionsView: effective.collectionsView.map((collection) =>
        collection.id === "root"
          ? {
              ...collection,
              links: [{ collection: "child", owner }],
              members: [
                ...collection.members,
                {
                  name: "linked-entry",
                  address: { source: "team-main", path: "guide" },
                  paths: [],
                },
              ],
            }
          : collection,
      ),
    },
  } satisfies WorkspaceView;
  const root = deriveAgentAccessTree(linked);
  if (root.status !== "available") throw new Error("expected available tree");
  const expanded = deriveAgentAccessTree(linked, { [root.rows[0]!.key]: true });
  if (expanded.status !== "available") throw new Error("expected available tree");
  expect(expanded.rows.map((row) => [row.kind, row.name])).toContainEqual([
    "skill",
    "linked-entry",
  ]);
  expect(expanded.rows.some((row) => row.kind === "collection" && row.name === "child")).toBe(
    false,
  );
  expect(
    expanded.rows.filter((row) => row.kind === "reference" && row.target === "child"),
  ).toHaveLength(1);
});

test("Agent Skill leaves retain metadata but explicitly mark unhealthy installed records unavailable", () => {
  const source = projection();
  const healthValues = ["missing", "drifted", "unresolved-config"] as const;
  const unhealthyProjection: WorkspaceView = {
    ...source,
    installedSkills: source.installedSkills.map((skill) =>
      skill.address.path === "guide"
        ? {
            ...skill,
            description: "Useful description, not proof of Agent availability",
            owner: { ...skill.owner, health: "missing" as const },
          }
        : skill,
    ),
  };
  const complete = unhealthyProjection.effective;
  if (complete.status !== "complete") throw new Error("expected complete projection");
  const rows = deriveAgentAccessTree(unhealthyProjection, {
    [exposureTreePathKey({ segments: [{ collection: "root" }] })]: true,
  });
  if (rows.status !== "available") throw new Error("expected available catalog with an issue row");
  expect(
    rows.rows.find((row) => row.kind === "skill" && row.address.path === "reference"),
  ).toMatchObject({ availability: { status: "available" } });
  const leaf = rows.rows.find((row) => row.kind === "skill" && row.address.path === "guide");
  expect(leaf).toMatchObject({
    availability: { status: "unavailable", health: "missing" },
    description: "Useful description, not proof of Agent availability",
    missingReason: "Installed Skill is unhealthy (missing) and unavailable to Agent access",
  });

  for (const health of healthValues) {
    const changed: WorkspaceView = {
      ...unhealthyProjection,
      installedSkills: unhealthyProjection.installedSkills.map((skill) =>
        skill.address.path === "guide" ? { ...skill, owner: { ...skill.owner, health } } : skill,
      ),
    };
    const tree = deriveAgentAccessTree(changed, {
      [exposureTreePathKey({ segments: [{ collection: "root" }] })]: true,
    });
    if (tree.status !== "available")
      throw new Error("one unhealthy Skill must not invalidate the catalog");
    expect(
      tree.rows.find((row) => row.kind === "skill" && row.address.path === "guide"),
    ).toMatchObject({
      availability: { status: "unavailable", health },
      missingReason: `Installed Skill is unhealthy (${health}) and unavailable to Agent access`,
    });
  }
});

test("Agent access fails closed when managed integration or complete projection is unavailable", () => {
  const source = projection();
  if (source.effective.status !== "complete") throw new Error("expected complete projection");
  expect(deriveAgentAccessTree(undefined)).toMatchObject({ status: "unavailable" });
  expect(
    deriveAgentAccessTree({ ...source, effective: { ...source.effective, managed: false } }),
  ).toMatchObject({ status: "unavailable" });
  expect(
    deriveAgentAccessTree({
      ...source,
      effective: {
        ...source.effective,
        agent: { ...source.effective.agent, status: "unavailable" },
      },
    }),
  ).toMatchObject({ status: "unavailable" });
  expect(
    deriveAgentAccessTree({
      ...source,
      effective: {
        status: "unavailable",
        reasons: [],
        sources: [],
        collections: [],
        agent: source.effective.agent,
      },
    }),
  ).toMatchObject({ status: "unavailable" });
});
