import { expect, test } from "bun:test";
import { createWorkspaceState } from "../src/workspace/state";

test("clearing facet filters leaves text search and Source browsing context intact", () => {
  const state = createWorkspaceState();
  state.showInstalledSkillsFromSource("team-main");
  state.setQuery("seo");
  state.setFilter("Collection", "marketing");
  state.setFilter("Config", "global");
  state.setFilter("Collection", undefined);
  expect(state.query()).toBe("seo");
  expect(state.filters()).toEqual({ Config: "global" });
  state.clearFilters();
  expect(state.filters()).toEqual({});
  expect(state.query()).toBe("seo");
  expect(state.sourceFilter()).toBe("team-main");
});
