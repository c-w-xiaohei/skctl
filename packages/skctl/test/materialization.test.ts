import * as api from "@skctl/core";
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMain } from "../src/main";
import {} from "@skctl/core";
test("CLI-001 public setup discovers and installs a Local Skill into a managed catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-cli-"));
  const state = join(root, "state");
  const global = join(root, "global.jsonc");
  try {
    const source = join(root, "source");
    await mkdir(join(source, "review"), { recursive: true });
    await writeFile(
      join(source, "review", "SKILL.md"),
      "---\nname: review\ndescription: Review\n---\n",
    );
    process.env.SKCTL_STATE_DIR = state;
    await writeFile(global, JSON.stringify({ agents: { opencode: "managed" } }));
    expect(await runMain(["init", root, "--host", "project"], { cwd: root })).toBe(0);
    await writeFile(join(root, "skctl.jsonc"), '{ "collections": { "engineering": {} } }\n');
    for (const argv of [
      ["--project", root, "source", "register", "local", "local", "./source"],
      ["--project", root, "source", "discover", "local"],
      ["--project", root, "install", "local", "review"],
      [
        "--project",
        root,
        "collection",
        "member",
        "add",
        "engineering",
        "review",
        "local",
        "review",
      ],
      ["--project", root, "use", "set", "engineering"],
    ] as const)
      expect(await runMain(argv, { cwd: root })).toBe(0);
    const catalog = await api.browseCatalog(
      { cwd: root, userConfigPath: global },
      {
        collection: "engineering",
      },
    );
    expect(catalog.value).toMatchObject({
      status: "available",
      scope: { kind: "collection", id: "engineering" },
      items: [{ selector: "engineering:review" }],
    });
    for (const argv of [["browse"], ["load", "engineering:review"]] as const) {
      let output = "";
      expect(
        await runMain(["agent", ...argv], {
          cwd: root,
          environment: { userConfigPath: global },
          stdout: { write: (chunk) => (output += String(chunk)) },
          stderr: { write() {} },
        }),
      ).toBe(0);
      if (argv[0] === "browse") expect(output).toContain('<managed_skill_catalog scope="root">');
      else expect(output).toContain("---\nname: review\n");
    }
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
