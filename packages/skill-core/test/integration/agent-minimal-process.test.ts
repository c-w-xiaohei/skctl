import * as api from "../../src/index";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("Agent preserves multi-line metadata and raw content, forwards exit status and keeps persistent output", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-minimal-agent-"));
  const previousState = process.env.SKILL_CLI_STATE_DIR;
  const state = join(root, "state"),
    config = join(root, "config");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    const skill = join(root, "skills", "review");
    await mkdir(join(skill, "references"), { recursive: true });
    await mkdir(join(config, "skill-cli"), { recursive: true });
    await writeFile(join(config, "skill-cli", "config.jsonc"), "{}\n");
    const text =
      '---\nname: "review"\ndescription: >-\n  Use for code\n  review.\n---\n# Review\nRead references/check.md';
    await writeFile(join(skill, "SKILL.md"), text);
    await writeFile(join(skill, "references/check.md"), "Check only requested changes");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: { local: { kind: "local", path: "./skills", root: "" } },
        collections: {
          engineering: {
            description: 'Review <code> & "tests"',
            members: { review: { source: "local", path: "review" } },
          },
        },
        use: ["engineering"],
        agents: { opencode: "managed" },
      }),
    );
    const core = {
      cwd: root,
      userConfigPath: join(config, "skill-cli/config.jsonc"),
    };
    expect(
      (await api.discoverSkills(core, { source: "local" })).value.candidates[0]!.description,
    ).toBe("Use for code review.");
    await api.installSkills(core, { source: "local", paths: ["review"] });
    expect(await api.loadSkill(core, { selector: "engineering:review" })).toMatchObject({
      name: "review",
      description: "Use for code review.",
      text,
    });
    const invoke = async (argv: string[]) => {
      const child = Bun.spawn(
        [
          process.execPath,
          join(import.meta.dir, "../../../skill-cli/src/main.ts"),
          "agent",
          ...argv,
        ],
        {
          cwd: root,
          env: { ...process.env, HOME: root, XDG_CONFIG_HOME: config, SKILL_CLI_STATE_DIR: state },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { code, stdout, stderr };
    };
    expect((await invoke(["load", "engineering:review"])).stdout).toBe(text);
    expect((await invoke(["read", "engineering:review", "references/check.md"])).stdout).toBe(
      "Check only requested changes",
    );
    expect((await invoke(["browse"])).stdout).toContain('<managed_skill_catalog scope="root">');
    expect((await invoke(["browse"])).stdout).toContain("<id>engineering</id>");
    expect((await invoke(["browse"])).stdout).toContain(
      "<description>Review &lt;code&gt; &amp; &quot;tests&quot;</description>",
    );
    const download = await invoke([
      "download",
      "engineering:review",
      "references/check.md",
      "--output",
      "copied.md",
    ]);
    expect(JSON.parse(download.stdout)).toEqual({ output: join(root, "copied.md") });
    expect(await readFile(join(root, "copied.md"), "utf8")).toBe("Check only requested changes");
    const script = `await Bun.write(${JSON.stringify(join(root, "result.txt"))}, process.cwd()); console.log("CHILD_OUTPUT"); console.error("CHILD_ERROR"); process.exit(7);`;
    const run = await invoke(["run", "engineering:review", "--", process.execPath, "-e", script]);
    expect(run).toEqual({ code: 7, stdout: "CHILD_OUTPUT\n", stderr: "CHILD_ERROR\n" });
    expect(await readFile(join(root, "result.txt"), "utf8")).toContain(join(state, "runs"));
    expect(await readdir(join(state, "runs"))).toEqual([]);
    if (process.platform !== "win32") {
      const terminated = await invoke([
        "run",
        "engineering:review",
        "--",
        process.execPath,
        "-e",
        'process.kill(process.pid, "SIGTERM")',
      ]);
      expect(terminated.code).toBe(143);
      expect(terminated.stdout).toBe("");
      expect(await readdir(join(state, "runs"))).toEqual([]);
    }
  } finally {
    if (previousState === undefined) delete process.env.SKILL_CLI_STATE_DIR;
    else process.env.SKILL_CLI_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
