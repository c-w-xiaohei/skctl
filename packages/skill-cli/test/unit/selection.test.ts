import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readWorkspace } from "../../src/core/internal/config";
import { resolveCollectionUse, resolveCollections } from "../../src/core/collections";

test("rejects legacy declarations rather than importing or shadowing them", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-selection-"));
  await writeFile(join(root, "skill-cli.jsonc"), '{ "profiles": { "old": [] } }');
  await expect(readWorkspace({ cwd: root })).rejects.toMatchObject({ code: "CONFIG_INVALID" });
});

test("requires a nonempty, fully installed explicit Collection Use", () => {
  const resolved = resolveCollections(
    { engineering: { members: { review: { source: "local", path: "review" } } } },
    new Set(["local/review"]),
  );
  expect(resolveCollectionUse(resolved, [])).toMatchObject({ complete: false });
  expect(resolveCollectionUse(resolved, ["missing"])).toMatchObject({ complete: false });
  expect(resolveCollectionUse(resolved, ["engineering"])).toMatchObject({ complete: true });
});
