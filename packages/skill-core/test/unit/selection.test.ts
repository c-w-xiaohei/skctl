import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readWorkspace } from "../../src/workspace/capture";
import { resolveCollectionUse, resolveCollections } from "../../src/collection/graph";

test("rejects legacy declarations rather than importing or shadowing them", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-selection-"));
  const config = join(root, "skill-cli.jsonc");
  try {
    await writeFile(config, '{ "profiles": { "old": [] } }');
    const workspace = (await readWorkspace({ cwd: root })).value;
    expect(workspace.configs.find((view) => view.level === "project")?.file).toMatchObject({
      status: "invalid",
    });
    expect(workspace.configs.find((view) => view.level === "project")?.file.problem).toMatchObject({
      code: "CONFIG_INVALID",
      message: "Configuration must NOT have additional properties",
      location: { file: config },
    });
    expect(workspace.effective).toMatchObject({ status: "unavailable" });
    expect(await readFile(config, "utf8")).toBe('{ "profiles": { "old": [] } }');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires a nonempty, fully installed explicit Collection Use", () => {
  const resolved = resolveCollections(
    [
      {
        id: "engineering",
        declaration: { members: { review: { source: "local", path: "review" } } },
      },
    ],
    [{ source: "local", path: "review", name: "review" }],
  );
  expect(resolveCollectionUse(resolved, [])).toMatchObject({ complete: false });
  expect(resolveCollectionUse(resolved, ["missing"])).toMatchObject({ complete: false });
  expect(resolveCollectionUse(resolved, ["engineering"])).toMatchObject({ complete: true });
});
