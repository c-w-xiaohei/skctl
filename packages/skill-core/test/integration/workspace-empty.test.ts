import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getWorkspace, registerSource } from "../../src/index";

test("missing configuration is writable while previous namespace data is detected without importing or overwriting it", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-first-use-"));
  const keys = ["HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "SKCTL_STATE_DIR"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.HOME = root;
    process.env.XDG_CONFIG_HOME = join(root, "config");
    process.env.XDG_STATE_HOME = join(root, "state");
    delete process.env.SKCTL_STATE_DIR;
    const options = { cwd: root, project: root };
    const empty = (await getWorkspace(options)).value;
    expect(empty.installedSkills).toEqual([]);
    expect(empty.diagnostics).toEqual([]);
    await mkdir(join(root, "state", "skill-cli"), { recursive: true });
    const path = join(root, "state", "skill-cli", "state.json");
    await writeFile(path, "saved original bytes");
    const found = (await getWorkspace(options)).value;
    expect(found.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "PREVIOUS_DATA_FOUND",
        message: expect.stringContaining(path),
      }),
    );
    expect(await readFile(path, "utf8")).toBe("saved original bytes");
    expect(await Bun.file(join(root, "state", "skctl", "state.json")).exists()).toBe(false);
    await registerSource(options, {
      level: "project",
      id: "mine",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    expect((await getWorkspace(options)).value.effective.sources).toHaveLength(1);
    expect(await readFile(path, "utf8")).toBe("saved original bytes");
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(root, { recursive: true, force: true });
  }
});
