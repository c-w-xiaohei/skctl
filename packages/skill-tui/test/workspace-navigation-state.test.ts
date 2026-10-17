import { expect, test } from "bun:test";
import { createComputed, createRoot } from "solid-js";
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

test("Source Updates restores active identity without rewinding session preferences", () => {
  const state = createWorkspaceState();
  state.showSourceUpdates("alpha");
  const alphaFrame = structuredClone(state.snapshot());
  state.setSourceUpdatesQuery("alpha-latest");
  state.setSourceUpdatesFilter("all");
  state.showSourceUpdates("beta");
  expect(state.sourceUpdatesView()).toEqual({ source: "beta", query: "", filter: "updates" });
  state.setSourceUpdatesQuery("beta-latest");
  const betaFrame = structuredClone(state.snapshot());
  state.restore(alphaFrame);
  expect(state.sourceUpdatesView()).toEqual({
    source: "alpha",
    query: "alpha-latest",
    filter: "all",
  });
  state.restore(betaFrame);
  expect(state.sourceUpdatesView()).toEqual({
    source: "beta",
    query: "beta-latest",
    filter: "updates",
  });
  state.clearSourceUpdatesView();
  state.setSourceUpdatesQuery("ignored");
  state.setSourceUpdatesFilter("all");
  expect(state.sourceUpdatesView()).toBeUndefined();
  state.showSourceUpdates("alpha");
  expect(state.sourceUpdatesView()).toEqual({
    source: "alpha",
    query: "alpha-latest",
    filter: "all",
  });
});

test("Source Updates preferences react without rewriting navigation or invalidating on browser updates", () => {
  createRoot((dispose) => {
    try {
      const state = createWorkspaceState();
      state.showSourceUpdates("alpha");
      let viewReads = 0;
      let view = state.sourceUpdatesView();
      createComputed(() => {
        view = state.sourceUpdatesView();
        viewReads++;
      });
      const initialView = view;
      state.setQuery("workspace-browser-query");
      state.setScroll("updates", 7);
      expect(view).toBe(initialView);
      expect(viewReads).toBe(1);
      const frame = state.snapshot();
      state.setSourceUpdatesFilter("all");
      state.setSourceUpdatesQuery("alpha-query");
      expect(state.snapshot()).toBe(frame);
      expect(view).toEqual({ source: "alpha", query: "alpha-query", filter: "all" });
      expect(viewReads).toBe(3);
      state.setSourceUpdatesQuery("alpha-query");
      state.setSourceUpdatesFilter("all");
      state.restore(frame);
      expect(viewReads).toBe(3);
      expect(state.sourceUpdatesView()).toBe(view);
    } finally {
      dispose();
    }
  });
});
