import { expect, test } from "bun:test";
import { createWorkspaceState } from "../src/workspace/state";

test("pages retain their independent Skills view instead of becoming a view", () => {
  const state = createWorkspaceState();
  state.selectSkillsView("unassigned");
  state.selectSection("collections");
  expect(state.section()).toBe("collections");
  expect(state.skillsView()).toBe("unassigned");
  state.selectSection("sources");
  state.selectSection("updates");
  state.selectSection("skills");
  expect(state.skillsView()).toBe("unassigned");
});

test("selecting a Skills view is an explicit page landing, not a filter-owned page override", () => {
  const state = createWorkspaceState();
  state.showInstalledSkillsFromSource("team-main");
  expect(state.section()).toBe("skills");
  expect(state.skillsView()).toBe("all-installed-skills");
  state.selectSection("sources");
  expect(state.sourceFilter()).toBeUndefined();
  expect(state.skillsView()).toBe("all-installed-skills");
  state.selectSkillsView("problems");
  expect(state.section()).toBe("skills");
  expect(state.skillsView()).toBe("problems");
  const snapshot = state.snapshot();
  state.selectSection("collections");
  state.restore(snapshot);
  expect(state.section()).toBe("skills");
  expect(state.skillsView()).toBe("problems");
});
