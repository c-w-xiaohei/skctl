import { expect, test } from "bun:test";
import { parseTuiArgs } from "../../packages/skill-tui/src/main";

test("standalone UI parser owns only project/help and never consumes unknown arguments", () => {
  expect(parseTuiArgs([])).toEqual({ project: undefined, help: false });
  expect(parseTuiArgs(["--project", "agent", "--help"])).toEqual({ project: "agent", help: true });
  expect(parseTuiArgs(["--project=P"])).toEqual({ project: "P", help: false });
  expect(() => parseTuiArgs(["--project"])).toThrow("requires a value");
  expect(() => parseTuiArgs(["--project", "--help"])).toThrow("requires a value");
  expect(() => parseTuiArgs(["--project=P", "--project=Q"])).toThrow("Duplicate");
  expect(() => parseTuiArgs(["--unknown"])).toThrow("Unknown");
});
