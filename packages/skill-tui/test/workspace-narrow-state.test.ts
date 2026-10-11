import { expect, test } from "bun:test";
import { createWorkspaceState, problemRowKey, problemRows } from "../src/workspace/state";
import { exposurePathKey, visibleExposureRows, type ExposurePath } from "../src/collections/state";
import { readerProjection } from "./installed-reader.fixture";

test("workspace narrow Source flow distinguishes Skills, Sources, and inspector", () => {
  const workspace = createWorkspaceState();
  expect(workspace.scope()).toBe("current-exposure");
  expect(workspace.section()).toBe("skills");
  workspace.selectSection("sources");
  expect(workspace.section()).toBe("sources");
  workspace.openWorkArea();
  expect(workspace.narrowLevel()).toBe("work-area");
  workspace.openDetail();
  expect(workspace.narrowLevel()).toBe("detail");
  workspace.showWorkArea();
  expect(workspace.narrowLevel()).toBe("work-area");
  workspace.showList();
  expect(workspace.narrowLevel()).toBe("list");
});

test("workspace keeps exposure selection separate from structurally keyed expansion state", () => {
  const workspace = createWorkspaceState();
  const first: ExposurePath = {
    segments: [
      { collection: "root" },
      { collection: "docs", reference: { name: "shared", target: "docs" } },
    ],
  };
  const collidingDisplayPath: ExposurePath = {
    segments: [
      { collection: "root" },
      { collection: "shared", reference: { name: "shared", target: "shared" } },
    ],
  };

  workspace.selectExposurePath(exposurePathKey(first));
  workspace.toggleExposurePath(first);
  workspace.toggleExposurePath(collidingDisplayPath);

  expect(workspace.selectedExposurePath()).toBe(exposurePathKey(first));
  expect(workspace.expandedExposurePaths()).toEqual({
    [exposurePathKey(first)]: true,
    [exposurePathKey(collidingDisplayPath)]: true,
  });
  workspace.toggleExposurePath(first);
  expect(workspace.isExposurePathExpanded(first)).toBe(false);
  expect(workspace.isExposurePathExpanded(collidingDisplayPath)).toBe(true);
});

test("RED exposure visibility requires every structural ancestor to remain expanded", () => {
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete projection");
  const owner = { level: "project" as const, file: "/project.jsonc", pointer: "/collections/root" };
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      managed: true,
      use: ["root"],
      collectionsView: ["root", "child", "grandchild"].map((id, index) => ({
        id,
        declared: [owner],
        repository: { derived: false, producers: [] },
        members: [],
        references:
          index < 2
            ? [
                {
                  name: id === "root" ? "child" : "grand",
                  collection: index === 0 ? "child" : "grandchild",
                  description: "",
                  owner,
                },
              ]
            : [],
        links: [],
      })),
    },
  };
  const rows = visibleExposureRows(projection, {
    [exposurePathKey({ segments: [{ collection: "root" }] })]: false,
    [exposurePathKey({
      segments: [
        { collection: "root" },
        { collection: "child", reference: { name: "child", target: "child" } },
      ],
    })]: true,
  });
  expect(rows.map((row) => row.collection)).toEqual(["root"]);
});

test("RED exposure selection uses distinct structural keys when display paths collide", () => {
  const workspace = createWorkspaceState();
  const first: ExposurePath = {
    segments: [{ collection: "root/a", reference: { name: "child", target: "root/a" } }],
  };
  const second: ExposurePath = {
    segments: [{ collection: "root", reference: { name: "a/child", target: "root" } }],
  };
  expect(
    first.segments.map((segment) => `${segment.collection}/${segment.reference?.name}`).join("/"),
  ).toBe(
    second.segments.map((segment) => `${segment.collection}/${segment.reference?.name}`).join("/"),
  );
  workspace.selectExposurePath(exposurePathKey(first));
  expect(workspace.selectedExposurePath()).toBe(exposurePathKey(first));
  workspace.selectExposurePath(exposurePathKey(second));
  expect(workspace.selectedExposurePath()).toBe(exposurePathKey(second));
});

test("workspace reconciliation drops expansion paths that disappeared", () => {
  const workspace = createWorkspaceState();
  const path: ExposurePath = { segments: [{ collection: "root" }] };
  workspace.toggleExposurePath(path);
  workspace.reconcile(undefined, {
    ...readerProjection(),
    effective: {
      ...readerProjection().effective,
      status: "complete",
      managed: true,
      use: [],
      collectionsView: [],
    },
  });
  expect(workspace.expandedExposurePaths()).toEqual({});
});

test("workspace scope selection keeps its work area section coherent", () => {
  const workspace = createWorkspaceState();
  workspace.selectScope("sources");
  expect(workspace.scope()).toBe("sources");
  expect(workspace.section()).toBe("sources");
});

test("ordinary workspace section changes select their matching browser scope", () => {
  const workspace = createWorkspaceState();
  workspace.selectSection("skills");
  expect(workspace.scope()).toBe("current-exposure");
  expect(workspace.section()).toBe("skills");

  workspace.selectSection("collections");
  expect(workspace.scope()).toBe("collections");
  expect(workspace.section()).toBe("collections");

  workspace.selectSection("sources");
  expect(workspace.scope()).toBe("sources");
  expect(workspace.section()).toBe("sources");

  workspace.selectSection("skills");
  expect(workspace.scope()).toBe("all-installed-skills");
  expect(workspace.section()).toBe("skills");
});

test("explicit Current Exposure selection remains an intentional handoff", () => {
  const workspace = createWorkspaceState();
  workspace.selectScope("current-exposure");
  expect(workspace.scope()).toBe("current-exposure");
  expect(workspace.section()).toBe("skills");
});

test("workspace compatibility navigation synchronizes Scope and section", () => {
  const workspace = createWorkspaceState();
  workspace.selectScope("unassigned");
  workspace.selectSection("skills");
  expect(workspace.scope()).toBe("unassigned");
  expect(workspace.section()).toBe("skills");

  workspace.selectSection("collections");
  expect(workspace.scope()).toBe("collections");
  expect(workspace.section()).toBe("collections");

  workspace.land("skills", "team-main/reference");
  expect(workspace.snapshot()).toMatchObject({
    scope: "all-installed-skills",
    section: "skills",
  });
});

test("workspace source compatibility commands land their Work Area context", () => {
  const workspace = createWorkspaceState();
  workspace.setQuery("reference");
  workspace.showInstalledSkillsFromSource("team-main");
  expect(workspace.snapshot()).toMatchObject({
    scope: "all-installed-skills",
    section: "skills",
    sourceFilter: "team-main",
    query: "reference",
  });

  workspace.clearSourceFilter();
  expect(workspace.snapshot()).toMatchObject({
    scope: "sources",
    section: "sources",
    sourceFilter: undefined,
    query: "reference",
  });
});

test("workspace land closes Reader when leaving skills and retains it for skill handoffs", () => {
  const workspace = createWorkspaceState();
  workspace.openReader();
  workspace.land("collections", "engineering");
  expect(workspace.readerOpen()).toBe(false);

  workspace.openReader();
  workspace.land("skills", "team-main/reference");
  expect(workspace.readerOpen()).toBe(true);
});

test("workspace Scope changes leave Reader and source-filter context behind", () => {
  const workspace = createWorkspaceState();
  workspace.showInstalledSkillsFromSource("team-main");
  workspace.openReader();
  workspace.selectScope("collections");
  expect(workspace.snapshot()).toMatchObject({
    scope: "collections",
    section: "collections",
    sourceFilter: undefined,
    readerOpen: false,
  });
});

test("workspace structural Skill selection survives reconciliation and drops removed Skills", () => {
  const workspace = createWorkspaceState();
  const base = readerProjection();
  const retained = base.installedSkills[0]!.address;
  const removed = base.installedSkills[1]!.address;
  workspace.toggleSkill(retained);
  workspace.toggleSkill(removed);
  expect(workspace.selectedSkills()).toEqual([retained, removed]);
  const projection = {
    ...base,
    installedSkills: [base.installedSkills[0]!],
  };
  workspace.reconcile(undefined, projection);
  expect(workspace.selectedSkills()).toEqual([retained]);
});

test("workspace multi-selection retains slash-containing Source IDs structurally", () => {
  const workspace = createWorkspaceState();
  const address = { source: "team/main", path: "review" };
  workspace.toggleSkill(address);
  expect(workspace.selectedSkills()).toEqual([address]);
});

test("workspace Problems selection reconciles by prior visible position", () => {
  const workspace = createWorkspaceState();
  const base = readerProjection();
  const diagnostic = (code: string) => ({
    code,
    severity: "warning" as const,
    message: code.toLocaleLowerCase(),
    subject: { kind: "installed-skill" as const, address: base.installedSkills[0]!.address },
  });
  const first = diagnostic("FIRST");
  const selected = diagnostic("SELECTED");
  const third = diagnostic("THIRD");
  const previous = {
    ...base,
    diagnostics: [first, selected, third],
    installedSkills: [{ ...base.installedSkills[0]!, problems: [first, selected, third] }],
  };
  workspace.selectProblem(problemRowKey(problemRows(previous)[1]!));
  const current = {
    ...previous,
    diagnostics: [third, first],
    installedSkills: [{ ...previous.installedSkills[0]!, problems: [third, first] }],
  };
  workspace.reconcile(previous, current);
  expect(workspace.selectedProblem()).toBe(problemRowKey(problemRows(current)[1]!));

  const empty = { ...current, diagnostics: [], installedSkills: [] };
  workspace.reconcile(current, empty);
  expect(workspace.selectedProblem()).toBeUndefined();
});

test("workspace Problems preserves the first semantic row and synchronizes detail on refresh", () => {
  const reconciled: ({ readonly source: string; readonly path: string } | undefined)[] = [];
  const workspace = createWorkspaceState((address) => reconciled.push(address));
  const base = readerProjection();
  const first = {
    code: "FIRST",
    severity: "warning" as const,
    message: "first",
    subject: { kind: "installed-skill" as const, address: base.installedSkills[0]!.address },
  };
  const second = {
    code: "SECOND",
    severity: "warning" as const,
    message: "second",
    subject: { kind: "installed-skill" as const, address: base.installedSkills[1]!.address },
  };
  const initial = {
    ...base,
    diagnostics: [first, second],
    installedSkills: [
      { ...base.installedSkills[0]!, problems: [first] },
      { ...base.installedSkills[1]!, problems: [second] },
    ],
  };
  workspace.selectScope("problems");
  workspace.reconcile(undefined, initial);
  workspace.openReader();
  expect(workspace.selectedProblem()).toBe(problemRowKey(problemRows(initial)[0]!));
  expect(workspace.selectedSkill()).toEqual(base.installedSkills[0]!.address);

  const reordered = {
    ...initial,
    diagnostics: [second, first],
    installedSkills: [
      { ...initial.installedSkills[1]!, problems: [second] },
      { ...initial.installedSkills[0]!, problems: [first] },
    ],
  };
  workspace.reconcile(initial, reordered);
  expect(workspace.selectedProblem()).toBe(problemRowKey(problemRows(reordered)[1]!));
  expect(workspace.selectedSkill()).toEqual(base.installedSkills[0]!.address);
  expect(workspace.readerOpen()).toBe(true);

  const fallback = {
    ...reordered,
    diagnostics: [second],
    installedSkills: [{ ...reordered.installedSkills[1]!, problems: [second] }],
  };
  workspace.reconcile(reordered, fallback);
  expect(workspace.selectedProblem()).toBe(problemRowKey(problemRows(fallback)[0]!));
  expect(workspace.selectedSkill()).toEqual(base.installedSkills[1]!.address);
  expect(workspace.readerOpen()).toBe(true);

  const empty = { ...fallback, diagnostics: [], installedSkills: [] };
  workspace.reconcile(fallback, empty);
  expect(workspace.selectedProblem()).toBeUndefined();
  expect(workspace.selectedSkill()).toBeUndefined();
  expect(workspace.readerOpen()).toBe(false);
  expect(reconciled.at(-1)).toBeUndefined();
});

test("workspace Problem keys distinguish diagnostics with ambiguous display context", () => {
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
  const rows = problemRows(projection);
  expect(rows).toHaveLength(2);
  expect(problemRowKey(rows[0]!)).not.toBe(problemRowKey(rows[1]!));
});
