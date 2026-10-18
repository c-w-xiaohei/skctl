import { expect, test } from "bun:test";
import { compareRoots } from "../../src/installed/update";
import type { InstalledMaterialization } from "../../src/storage/schema";

const tree = (digit: string) => ({ objectFormat: "sha1" as const, objectId: digit.repeat(40) });
const installed = (path: string): InstalledMaterialization => ({
  source: "remote",
  path,
  kind: "remote",
  name: path,
  description: "Installed description",
  digest: "a".repeat(64),
  bindingDigest: "b".repeat(64),
  adoptedRevision: "c".repeat(40),
});

test("comparison classifies complete metadata without acquiring or parsing content", () => {
  const items = [
    installed("same"),
    installed("changed"),
    installed("removed"),
    installed("shadowed"),
  ];
  const result = compareRoots(
    items,
    [
      { path: "same", status: "present", tree: tree("a") },
      { path: "changed", status: "present", tree: tree("b") },
      { path: "removed", status: "missing" },
      { path: "shadowed", status: "not-skill-root", tree: tree("a") },
    ],
    new Map(items.map((item) => [item.path, tree("a")])),
  );
  expect(result.unchanged.map((item) => item.path)).toEqual(["same"]);
  expect(result.changed).toEqual([items[1]!]);
  expect(result.removed.map((item) => item.path)).toEqual(["removed", "shadowed"]);
});

test("incomplete facts and missing comparison evidence fail instead of becoming removal or change", () => {
  expect(() => compareRoots([installed("root")], [], new Map())).toThrow(
    "inspection is incomplete",
  );
  expect(() =>
    compareRoots([installed("root")], [{ path: "root", status: "present" }], new Map()),
  ).toThrow("no tree identity");
  expect(() =>
    compareRoots(
      [installed("root")],
      [{ path: "root", status: "present", tree: tree("a") }],
      new Map(),
    ),
  ).toThrow("no exact comparison evidence");
});
