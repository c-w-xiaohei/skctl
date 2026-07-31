import { expect, test } from "bun:test";
import { createConfigState } from "../../src/tui/config/state";
import { createRoute } from "../../src/tui/route";
import { createWorkspaceState } from "../../src/tui/workspace/state";

test("route landing delegates selection to page owners", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });
  route.source({ destination: "project", section: "sources", selection: "origin" });
  expect(config.section("project")).toBe("sources");
  expect(config.selection("project")).toBe("origin");
});
