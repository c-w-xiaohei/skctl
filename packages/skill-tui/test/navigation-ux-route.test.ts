import { expect, test } from "bun:test";
import { createConfigState } from "../src/config/state";
import { createRoute } from "../src/route";
import { createWorkspaceState } from "../src/workspace/state";

test("context switching clears drilldown while preserving browser state and destination section", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });
  const selected = { source: "team-main", path: "guide" };

  workspace.setQuery("needle");
  workspace.land("skills", selected);
  workspace.setScroll("skills:all-installed-skills", 8);
  route.switchSection("sources");
  config.land("project", "integrations", "agent-owner");
  route.switchContext("project");
  expect(route.snapshot().current).toMatchObject({
    context: "project",
    section: "integrations",
  });

  route.push({ destination: "project", section: "sources", selection: "origin" });
  route.switchContext("workspace");

  expect(route.snapshot().current).toMatchObject({ context: "workspace", section: "sources" });
  expect(route.snapshot().stack).toEqual([]);
  expect(workspace.snapshot()).toMatchObject({
    query: "needle",
    selectedSkill: selected,
    scrolls: { "skills:all-installed-skills": 8 },
  });

  route.switchContext("project");
  expect(route.snapshot().current).toMatchObject({
    context: "project",
    section: "sources",
    object: "origin",
  });
  expect(config.selection("project", "sources")).toBe("origin");
  expect(route.snapshot().stack).toEqual([]);
});

test("same-section root navigation exits an inspector and clears its return stack", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });
  const selected = { source: "team-main", path: "guide" };
  workspace.land("skills", selected);
  workspace.openDetail();
  route.push({
    destination: "workspace",
    section: "skills",
    selection: selected,
    surface: "inspector",
    focus: "inspector",
  });

  route.switchSection("skills", "local-nav");

  expect(route.snapshot().current).toMatchObject({
    context: "workspace",
    section: "skills",
    surface: "browser",
    focus: "local-nav",
  });
  expect(route.snapshot().stack).toEqual([]);
  expect(workspace.readerOpen()).toBe(false);
  expect(workspace.narrowLevel()).toBe("list");
});

test("ordinary pushes still restore the complete previous frame on Back", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });
  const selected = { source: "team-main", path: "guide" };
  workspace.land("skills", selected);
  workspace.setQuery("guide");
  workspace.setScroll("skills:all-installed-skills", 5);
  route.syncCurrent({ focus: "browser" });

  route.push({ destination: "project", section: "sources", selection: "origin" });
  workspace.setQuery("changed");
  route.back();

  expect(route.snapshot().current).toMatchObject({
    context: "workspace",
    section: "skills",
    object: selected,
    focus: "browser",
  });
  expect(route.snapshot().stack).toEqual([]);
  expect(workspace.snapshot()).toMatchObject({
    query: "guide",
    scrolls: { "skills:all-installed-skills": 5 },
  });
});
