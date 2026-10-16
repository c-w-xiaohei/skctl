import { expect, test } from "bun:test";
import type { ManagementProjection } from "@skill-cli/core";
import { configDeclarationOwnerKey, createConfigState } from "../src/config/state";
import { createRoute } from "../src/route";
import { validSections } from "../src/types";
import { createWorkspaceState } from "../src/workspace/state";
import { readerProjection } from "./installed-reader.fixture";

test("route landing delegates selection to page owners", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });
  route.source({ destination: "project", section: "sources", selection: "origin" });
  expect(config.section("project")).toBe("sources");
  expect(config.selection("project")).toBe("origin");
});

test("Config Use is not a user-facing Config section or valid route target", () => {
  expect(validSections("project")).not.toContain("for-agents");
  const config = createConfigState();
  config.land("project", "for-agents" as never);
  expect(config.section("project")).toBe("sources");
});

test("context activation creates a human navigation frame", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });

  route.activate({ destination: "project", section: "sources" });

  expect(route.snapshot().stack[0]).toMatchObject({
    context: "workspace",
    section: "skills",
    surface: "browser",
  });
});

test("Workspace Skills route landing carries View Installed Skills, Problems, and producer addresses structurally", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const landed: unknown[] = [];
  const route = createRoute(
    { workspace, config },
    () => {},
    () => {},
    () => undefined,
    () => {},
    (address) => landed.push(address),
  );
  const ordinary = { source: "team-main", path: "guide" };
  const first = { source: "team", path: "main/guide" };
  const second = { source: "team/main", path: "guide" };

  route.source({ destination: "workspace", section: "skills", selection: ordinary });
  route.source({
    destination: "workspace",
    section: "skills",
    selection: first,
    handoff: { kind: "agent-producer", address: first },
  });
  route.source({
    destination: "workspace",
    section: "skills",
    selection: second,
    handoff: { kind: "agent-producer", address: second },
  });

  expect(landed).toEqual([ordinary, first, second]);
});

test("relationship return rejects a different structural address with the same shorthand", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  workspace.land("skills", { source: "team/main", path: "guide" });
  const route = createRoute(
    { workspace, config },
    () => {},
    () => {},
    () => ({
      address: { source: "team", path: "main/guide" },
      tab: "details",
      raw: false,
      find: "",
      match: 0,
      scroll: 0,
      detailsScroll: 0,
      resources: [],
    }),
  );

  route.relationship({
    destination: "project",
    section: "sources",
    selection: "team",
    returnFocus: "details-relationships",
  });

  expect(route.snapshot().current.context).toBe("workspace");
  expect(route.snapshot().stack).toEqual([]);
});

test("relationship return restores the originating colliding Reader Details address", () => {
  const first = { source: "team", path: "main/guide" };
  const second = { source: "team/main", path: "guide" };
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const selected: unknown[] = [];
  workspace.land("skills", first);
  const route = createRoute(
    { workspace, config },
    () => {},
    () => {},
    () => ({
      address: first,
      tab: "details",
      raw: false,
      find: "",
      match: 0,
      scroll: 0,
      detailsScroll: 0,
      resources: [],
    }),
    (address, surface) => selected.push({ address, surface }),
  );

  route.relationship({
    destination: "workspace",
    section: "sources",
    selection: "team",
    returnFocus: "details-relationships",
  });
  workspace.selectSkill(second);
  route.back();

  expect(workspace.selectedSkill()).toEqual(first);
  expect(workspace.readerOpen()).toBe(true);
  expect(selected).toEqual([{ address: first, surface: "details" }]);
});

test("Source relationship destination uses the shared Inspector owner while Reader Details retains its owner", () => {
  const address = { source: "team-main", path: "guide" };
  const workspace = createWorkspaceState();
  const config = createConfigState();
  workspace.land("skills", address);
  const route = createRoute(
    { workspace, config },
    () => {},
    () => {},
    () => ({
      address,
      tab: "details",
      raw: false,
      find: "",
      match: 0,
      scroll: 0,
      detailsScroll: 0,
      resources: [],
    }),
  );

  route.relationship({
    destination: "workspace",
    section: "sources",
    selection: "team-main",
    returnFocus: "details-relationships",
  });

  expect(route.snapshot().current.focus).toBe("inspector");
  expect(route.snapshot().stack.at(-1)?.focus).toBe("details-relationships");
});

test("navigation frames restore Workspace state exactly after a context activation", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const selected = { source: "team/main", path: "guide" };
  workspace.land("skills", selected);
  workspace.setQuery("guide");
  workspace.setFilter("Source", "team/main");
  workspace.setScroll("skills:all-installed-skills", 7);
  const route = createRoute({ workspace, config });

  route.activate({ destination: "project", section: "sources", selection: "project-source" });
  workspace.setQuery("changed");
  route.back();

  expect(route.snapshot().current.context).toBe("workspace");
  expect(route.snapshot().stack).toHaveLength(0);
  expect(workspace.snapshot()).toMatchObject({
    section: "skills",
    selectedSkill: selected,
    query: "guide",
    filters: { Source: "team/main" },
    scrolls: { "skills:all-installed-skills": 7 },
  });
});

test("context peer switch changes the active frame without adding a return history entry", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });

  route.switchContext("project", "top-nav");
  expect(route.snapshot().current.context).toBe("project");
  expect(route.snapshot().current.section).toBe("sources");
  expect(route.snapshot().current.focus).toBe("top-nav");
  expect(route.snapshot().stack).toHaveLength(0);
});

test("section peer switch lands its page atomically without adding a return history entry", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });

  route.switchSection("sources", "local-nav");

  expect(workspace.section()).toBe("sources");
  expect(route.snapshot().current).toMatchObject({
    context: "workspace",
    section: "sources",
    focus: "local-nav",
  });
  expect(route.snapshot().stack).toHaveLength(0);
});

test("route frames are immutable and restore exact local focus", () => {
  const address = { source: "team/main", path: "guide" };
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const focus: string[] = [];
  workspace.land("skills", address);
  workspace.setFilter("Source", "team/main");
  const route = createRoute({ workspace, config }, (owner) => focus.push(owner));

  route.push({
    destination: "project",
    section: "sources",
    selection: "project-source",
    surface: "inspector",
    focus: "inspector",
  });
  workspace.setFilter("Source", "changed");
  route.back();

  expect(workspace.filters()).toEqual({ Source: "team/main" });
  expect(focus.at(-1)).toBe("browser");
});

test("Browser and Inspector frames neither capture nor restore Reader state", () => {
  const address = { source: "team-main", path: "guide" };
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const restored: unknown[] = [];
  const route = createRoute(
    { workspace, config },
    () => {},
    () => {},
    () => ({
      address,
      tab: "details",
      raw: true,
      find: "needle",
      match: 2,
      scroll: 15,
      detailsScroll: 7,
      resources: [],
    }),
    () => {},
    undefined,
    (state) => restored.push(state),
  );

  route.syncCurrent({ surface: "inspector", focus: "inspector" });
  route.push({ destination: "project", section: "sources", selection: "origin" });
  expect(route.snapshot().stack.at(-1)?.reader).toBeUndefined();

  route.back();

  expect(restored).toEqual([]);
});

test("source skills handoff captures the Source frame before its filter mutation", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  workspace.land("sources", "team-main");
  workspace.setScroll("sources", 4);
  const route = createRoute({ workspace, config });

  route.transition({ destination: "workspace", section: "skills", selection: undefined }, () => {
    workspace.showInstalledSkillsFromSource("team-main");
  });
  expect(route.snapshot().stack.at(-1)).toMatchObject({
    context: "workspace",
    section: "sources",
    object: "team-main",
    workspace: { selectedSource: "team-main", sourceFilter: undefined },
  });
  expect(route.snapshot().current.workspace).toMatchObject({
    section: "skills",
    sourceFilter: "team-main",
  });
  route.back();

  expect(workspace.snapshot()).toMatchObject({
    section: "sources",
    selectedSource: "team-main",
    sourceFilter: undefined,
    scrolls: { sources: 4 },
  });
});

test("source-filtered Skill Inspector returns through its immediate browser predecessor once", () => {
  const first = { source: "team-main", path: "guide" };
  const workspace = createWorkspaceState();
  const config = createConfigState();
  workspace.land("sources", "team-main");
  workspace.setScroll("sources", 4);
  const route = createRoute({ workspace, config });

  route.transition(
    { destination: "workspace", section: "skills", selection: first, focus: "browser" },
    () => {
      workspace.showInstalledSkillsFromSource("team-main");
      workspace.selectSkill(first);
      workspace.showWorkArea();
      workspace.setScroll("skills:all-installed-skills", 3);
    },
  );
  route.transition(
    {
      destination: "workspace",
      section: "skills",
      selection: first,
      surface: "inspector",
      focus: "command:skill.open-skill-md",
    },
    () => workspace.openDetail(),
  );

  const beforeEscape = route.snapshot();
  expect(beforeEscape.current).toMatchObject({
    context: "workspace",
    section: "skills",
    object: first,
    surface: "inspector",
  });
  expect(beforeEscape.stack).toHaveLength(2);
  expect(beforeEscape.stack.at(-1)).toMatchObject({
    context: "workspace",
    section: "skills",
    object: first,
    surface: "browser",
    focus: "browser",
    narrowLevel: "work-area",
    workspace: {
      sourceFilter: "team-main",
      selectedSkill: first,
      scrolls: { "skills:all-installed-skills": 3 },
    },
  });

  route.back();
  expect(route.snapshot().revision).toBe(beforeEscape.revision + 1);
  expect(route.snapshot().current).toMatchObject({
    context: "workspace",
    section: "skills",
    object: first,
    surface: "browser",
    focus: "browser",
  });
  expect(route.snapshot().stack).toHaveLength(1);
  expect(workspace.snapshot()).toMatchObject({
    sourceFilter: "team-main",
    selectedSkill: first,
    scrolls: { "skills:all-installed-skills": 3 },
  });

  const afterFirstEscape = route.snapshot();
  route.back();
  expect(route.snapshot().revision).toBe(afterFirstEscape.revision + 1);
  expect(route.snapshot().current).toMatchObject({
    context: "workspace",
    section: "sources",
    object: "team-main",
    surface: "browser",
  });
  expect(route.snapshot().stack).toEqual([]);
  expect(workspace.snapshot()).toMatchObject({
    section: "sources",
    selectedSource: "team-main",
    sourceFilter: undefined,
    scrolls: { sources: 4 },
  });
});

test("Source Installed Skills preserves its command predecessor across the exact two-frame return", () => {
  const first = { source: "team-main", path: "guide" };
  const workspace = createWorkspaceState();
  const config = createConfigState();
  workspace.land("sources", "team-main");
  const route = createRoute({ workspace, config });

  route.syncCurrent({
    section: "sources",
    object: "team-main",
    surface: "inspector",
    focus: "command:source.skills",
  });
  route.transition(
    {
      destination: "workspace",
      section: "skills",
      selection: first,
      surface: "browser",
      focus: "browser",
    },
    () => {
      workspace.showInstalledSkillsFromSource("team-main");
      workspace.selectSkill(first);
      workspace.showWorkArea();
    },
  );
  const entered = route.snapshot();
  expect(entered.stack.at(-1)).toMatchObject({
    context: "workspace",
    section: "sources",
    object: "team-main",
    surface: "inspector",
    focus: "command:source.skills",
    workspace: { selectedSource: "team-main", sourceFilter: undefined },
  });

  route.transition(
    {
      destination: "workspace",
      section: "skills",
      selection: first,
      surface: "inspector",
      focus: "inspector",
    },
    () => workspace.openDetail(),
  );
  route.back();
  expect(route.snapshot().current).toMatchObject({
    section: "skills",
    object: first,
    surface: "browser",
    focus: "browser",
    workspace: { sourceFilter: "team-main", selectedSkill: first },
  });
  const afterFirstEscape = route.snapshot();
  route.back();
  expect(route.snapshot().revision).toBe(afterFirstEscape.revision + 1);
  expect(route.snapshot().current).toMatchObject({
    section: "sources",
    object: "team-main",
    surface: "inspector",
    focus: "command:source.skills",
    workspace: { selectedSource: "team-main", sourceFilter: undefined },
  });
  expect(route.snapshot().stack).toEqual([]);
});

test("contributed Source skills handoff restores the Config Source inspector frame", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });

  route.activate({ destination: "project", section: "sources", selection: "team-config/lark" });
  route.syncCurrent({ focus: "inspector" });
  route.transition({ destination: "workspace", section: "skills" }, () => {
    workspace.showInstalledSkillsFromSource("team-config/lark");
  });

  expect(route.snapshot().stack.at(-1)).toMatchObject({
    context: "project",
    section: "sources",
    object: "team-config/lark",
    focus: "inspector",
  });
  expect(route.snapshot().current.workspace.sourceFilter).toBe("team-config/lark");
  route.back();
  expect(config.section("project")).toBe("sources");
  expect(config.selection("project", "sources")).toBe("team-config/lark");
});

test("Workspace selection and reconciliation retain colliding structural Skill addresses", () => {
  const first = { source: "team", path: "main/guide" };
  const second = { source: "team/main", path: "guide" };
  const current = readerProjection();
  const colliding = {
    ...current,
    installedSkills: [
      { ...current.installedSkills[0]!, address: first, name: "first" },
      { ...current.installedSkills[1]!, address: second, name: "second" },
    ],
  };
  const workspace = createWorkspaceState();
  workspace.selectSkill(second);
  workspace.selectSkillsView("all-installed-skills");
  workspace.reconcile(colliding, colliding);
  expect(workspace.selectedSkill()).toEqual(second);
});

test("projection revalidation recovers a removed frame object without restoring its Reader", () => {
  const address = { source: "team", path: "guide" };
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute(
    { workspace, config },
    () => {},
    () => {},
    () => ({
      address,
      tab: "details",
      raw: false,
      find: "",
      match: 0,
      scroll: 0,
      detailsScroll: 0,
      resources: [],
    }),
  );
  workspace.land("skills", address);
  route.syncCurrent({
    section: "skills",
    object: address,
    surface: "reader",
    focus: "details-relationships",
  });
  route.push({ destination: "project", section: "sources", selection: "origin" });

  route.revalidate({ ...readerProjection(), installedSkills: [] });
  route.back();

  expect(route.snapshot().current).toMatchObject({
    context: "workspace",
    section: "skills",
    surface: "browser",
  });
  expect(route.snapshot().current.object).toBeUndefined();
  expect(workspace.readerOpen()).toBe(false);
});

test("projection revalidation retains and recovers exact integration owners with colliding pointers", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const global = {
    level: "global" as const,
    file: "/home/user/.config/skill-cli.jsonc",
    pointer: "/agents/opencode",
  };
  const selected = {
    level: "project" as const,
    file: "/workspace/skill-cli/skill-cli.jsonc",
    pointer: global.pointer,
    namespace: "team@commit",
    contribution: {
      configSource: global,
      declaration: {
        level: "project" as const,
        pointer: "/agents/opencode",
        namespace: "team@commit",
      },
    },
  };
  const projection = readerProjection();
  const current: ManagementProjection = {
    ...projection,
    configs: projection.configs.map((item) =>
      item.level === "project"
        ? {
            ...item,
            direct: {
              ...item.direct,
              integrations: [{ kind: "opencode", owner: selected }],
            },
          }
        : item,
    ),
    effective: {
      ...projection.effective,
      agent: {
        ...projection.effective.agent,
        integration: [global, selected],
      },
    },
  };
  const route = createRoute({ workspace, config });
  const selection = configDeclarationOwnerKey(selected);
  route.activate({ destination: "project", section: "integrations", selection });
  const frame = route.snapshot().current;

  route.revalidate(current);

  expect(route.snapshot().current).toBe(frame);
  expect(route.snapshot().current.object).toBe(selection);

  route.revalidate({
    ...current,
    configs: current.configs.map((item) =>
      item.level === "project" ? { ...item, direct: { ...item.direct, integrations: [] } } : item,
    ),
    effective: {
      ...current.effective,
      agent: { ...current.effective.agent, integration: [global] },
    },
  });

  expect(route.snapshot().current).toMatchObject({
    context: "project",
    section: "integrations",
    object: undefined,
    recovery: "unavailable",
  });
});

test("a route transition publishes its target only after the landing callback", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });
  const observed: string[] = [];

  route.transition({ destination: "project", section: "sources" }, () => {
    observed.push(route.snapshot().current.context);
  });

  expect(observed).toEqual(["workspace"]);
  expect(route.snapshot().current.context).toBe("project");
});

test("a transition requests its explicit target focus after the revision-scoped landing", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const focus: string[] = [];
  const route = createRoute({ workspace, config }, (owner) => focus.push(owner));

  route.transition(
    { destination: "workspace", section: "skills", surface: "inspector", focus: "inspector" },
    () => workspace.openDetail(),
  );

  expect(focus).toEqual(["inspector"]);
});

test("route revision advances for a committed navigation frame", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });
  const initial = route.snapshot().revision;

  route.switchContext("project");

  expect(route.snapshot().revision).toBeGreaterThan(initial);
});
