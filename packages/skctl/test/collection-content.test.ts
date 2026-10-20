import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMain } from "../src/main";

test("Collection content can be configured, inspected and disclosed through the CLI", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-collection-content-"));
  const previousState = process.env.SKCTL_STATE_DIR;
  process.env.SKCTL_STATE_DIR = join(root, "state");
  const config = join(root, "skctl.jsonc");
  const global = join(root, "user", "skctl.jsonc");
  const command = async (...argv: string[]) => {
    let stdout = "",
      stderr = "";
    const code = await runMain(argv, {
      cwd: root,
      environment: { userConfigPath: global },
      stdout: { write: (text) => (stdout += text) },
      stderr: { write: (text) => (stderr += text) },
    });
    return { code, stdout, stderr };
  };
  try {
    await mkdir(join(root, "user"));
    await writeFile(global, "{}");
    await writeFile(
      config,
      '{\n// Keep this comment\n"collections":{"team":{"references":{"child":{"collection":"child","description":"Child entry"}}},"child":{}},"use":["team"],"agents":{"opencode":"managed"}\n}',
    );
    const instructions = "# Workflow\nCheck evidence before choosing a member.\n";
    await writeFile(join(root, "guide.md"), instructions);
    expect(
      (
        await command(
          "collection",
          "set",
          "team",
          "--description",
          "Team entry",
          "--instructions-file",
          "guide.md",
        )
      ).code,
    ).toBe(0);
    const inspected = await command("collection", "inspect", "team", "--json");
    expect(inspected.code).toBe(0);
    expect(JSON.parse(inspected.stdout)).toMatchObject({ description: "Team entry", instructions });
    expect(await readFile(config, "utf8")).toContain("// Keep this comment");
    expect(JSON.parse(inspected.stdout).references).toHaveLength(1);
    const roots = await command("agent", "browse");
    expect(roots.stdout).toContain("Team entry");
    expect(roots.stdout).not.toContain("Check evidence before choosing a member");
    const body = await command("agent", "browse", "team");
    expect(body.stdout).toContain(instructions);
    expect(body.stdout).not.toContain("Team entry");
    expect(body.stdout).toContain("Child entry");

    expect(
      (await command("collection", "set", "team", "--instructions", "Updated guidance")).code,
    ).toBe(0);
    expect(
      JSON.parse((await command("collection", "inspect", "team", "--json")).stdout),
    ).toMatchObject({
      description: "Team entry",
      instructions: "Updated guidance",
    });
    const before = await readFile(config, "utf8");
    for (const flags of [
      [],
      ["--description", "", "--instructions", "Must not be written"],
      ["--instructions", "x", "--instructions-file", "guide.md"],
      ["--instructions-file", "guide.md", "--clear-instructions"],
      ["--description", "x", "--clear-description"],
      ["--instructions-file", "missing.md"],
      ["--scope", "global", "--instructions", "Wrong scope"],
    ]) {
      expect((await command("collection", "set", "team", ...flags)).code).toBe(2);
      expect(await readFile(config, "utf8")).toBe(before);
    }
    expect(
      JSON.parse(
        (await command("collection", "inspect", "team", "--scope", "global", "--json")).stdout,
      ),
    ).not.toHaveProperty("instructions");
    expect(
      (await command("collection", "set", "team", "--clear-description", "--clear-instructions"))
        .code,
    ).toBe(0);
    const cleared = JSON.parse((await command("collection", "inspect", "team", "--json")).stdout);
    expect(cleared).not.toHaveProperty("description");
    expect(cleared).not.toHaveProperty("instructions");
    expect(cleared.references).toHaveLength(1);
    const created = await command("collection", "create", "global-team", "-g");
    expect(created.code, created.stderr).toBe(0);
    expect(
      (await command("collection", "set", "global-team", "-g", "--instructions", "Global guidance"))
        .code,
    ).toBe(0);
    expect(JSON.parse(await readFile(global, "utf8")).collections["global-team"].instructions).toBe(
      "Global guidance",
    );
  } finally {
    if (previousState === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
