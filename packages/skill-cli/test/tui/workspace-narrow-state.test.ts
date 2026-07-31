import { expect, test } from "bun:test";
import { createWorkspaceState } from "../../src/tui/workspace/state";

test("workspace narrow view opens detail and returns to the list", () => {
  const workspace = createWorkspaceState();
  workspace.openDetail();
  expect(workspace.narrowLevel()).toBe("detail");
  workspace.showList();
  expect(workspace.narrowLevel()).toBe("list");
});
