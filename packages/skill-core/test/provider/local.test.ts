import { expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSource, withPreparedSkills } from "../../src/source/service";
import { runProcess } from "../../src/runtime/process";

const context = (root: string) => ({
  binding: {
    id: "local",
    kind: "local" as const,
    origin: root,
    root: "",
    selectors: [],
    provenance: { level: "project" as const },
  },
});

test("Local discovery and preparation retain live bytes, safe internal links and executable modes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-local-"));
  try {
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "SKILL.md"), "---\nname: local\ndescription: Local\n---\n");
    await writeFile(join(root, "nested", "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
    await symlink("nested/run.sh", join(root, "link"));
    expect((await discoverSource(context(root))).candidates).toEqual([
      { path: "", name: "local", description: "Local" },
    ]);
    await withPreparedSkills(context(root), [""], undefined, async ([skill]) => {
      expect(skill!.kind).toBe("local");
      expect(await readFile(join(skill!.directory, "link"), "utf8")).toBe("#!/bin/sh\n");
    });
    await chmod(join(root, "nested", "run.sh"), 0o600);
    await withPreparedSkills(context(root), [""], undefined, async ([skill]) => {
      expect(Number((await lstat(join(skill!.directory, "nested/run.sh"))).mode) & 0o111).toBe(0);
      expect(skill).not.toHaveProperty("digest");
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Local discovery sees initialized submodule files but never initializes or follows directory links", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-submodule-"));
  const nested = join(root, "nested-repository"),
    parent = join(root, "parent-repository");
  const initialized = join(root, "initialized-parent"),
    uninitialized = join(root, "uninitialized-parent");
  const git = async (cwd: string, ...args: string[]) => {
    const result = await runProcess({ cmd: ["/usr/bin/git", ...args], cwd });
    if (result.status) throw new Error(result.stderr.toString());
  };
  try {
    for (const path of [nested, parent]) {
      await mkdir(path);
      await git(path, "init");
      await git(path, "config", "user.email", "test@skctl.invalid");
      await git(path, "config", "user.name", "Fixture");
    }
    await writeFile(join(nested, "SKILL.md"), "---\nname: nested\ndescription: Nested\n---\n");
    await writeFile(join(nested, "helper.txt"), "present on host\n");
    await git(nested, "add", ".");
    await git(nested, "commit", "-m", "nested skill");
    await git(
      parent,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      nested,
      "source/nested",
    );
    await git(parent, "commit", "-am", "parent submodule");
    await git(root, "clone", parent, initialized);
    await git(initialized, "-c", "protocol.file.allow=always", "submodule", "update", "--init");
    await git(root, "clone", parent, uninitialized);
    await symlink("nested", join(initialized, "source", "linked-nested"));
    await symlink("missing.txt", join(initialized, "source", "dangling.txt"));
    expect((await lstat(join(uninitialized, "source", "nested"))).isDirectory()).toBe(true);
    const saved = process.env.PATH;
    process.env.PATH = "";
    try {
      expect(
        (await discoverSource(context(join(initialized, "source")))).candidates.map(
          (item) => item.path,
        ),
      ).toEqual(["nested"]);
      expect(await readFile(join(initialized, "source", "nested", "helper.txt"), "utf8")).toBe(
        "present on host\n",
      );
      expect((await discoverSource(context(join(uninitialized, "source")))).candidates).toEqual([]);
      await expect(
        withPreparedSkills(
          context(join(initialized, "source")),
          ["nested"],
          undefined,
          async () => {},
        ),
      ).rejects.toHaveProperty("code", "PROVIDER_INTEGRITY_FAILED");
      await expect(
        withPreparedSkills(
          context(join(uninitialized, "source")),
          ["nested"],
          undefined,
          async () => {},
        ),
      ).rejects.toHaveProperty("code", "SKILL_NOT_FOUND");
    } finally {
      process.env.PATH = saved;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
