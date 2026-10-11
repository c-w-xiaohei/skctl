import { expect, test } from "bun:test";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverLocalSkills } from "../../src/internal/domain";

test("discovers deterministic skill roots and stops below a valid root", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-discovery-"));
  await mkdir(join(root, "z"), { recursive: true });
  await mkdir(join(root, "a", "nested"), { recursive: true });
  await writeFile(join(root, "z", "SKILL.md"), "---\nname: z\ndescription: Z\n---\n");
  await writeFile(join(root, "a", "SKILL.md"), "---\nname: a\ndescription: A\n---\n");
  await writeFile(
    join(root, "a", "nested", "SKILL.md"),
    "---\nname: hidden\ndescription: hidden\n---\n",
  );
  expect((await discoverLocalSkills(root)).skills.map((skill) => skill.name)).toEqual(["a", "z"]);
});

test("diagnoses malformed frontmatter and does not follow directory symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-discovery-"));
  await mkdir(join(root, "bad"));
  await mkdir(join(root, "outside"));
  await writeFile(join(root, "bad", "SKILL.md"), "---\nname: [not scalar]\n---\n");
  await writeFile(join(root, "outside", "SKILL.md"), "---\nname: outside\ndescription: no\n---\n");
  await symlink(join(root, "outside"), join(root, "linked"));
  const result = await discoverLocalSkills(root);
  expect(result.skills.map((skill) => skill.name)).toEqual(["outside"]);
  expect(result.diagnostics).toHaveLength(1);
});
