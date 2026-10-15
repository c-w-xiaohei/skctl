import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHumanCommand } from "../src/human";
import type { SkillCliCore } from "@skill-cli/core";

function core(calls: unknown[]): SkillCliCore {
  return {
    workspace: { get: async () => ({ value: {} as never, diagnostics: [] }) },
    configuration: {
      change: async (change) => {
        calls.push(change);
        return {
          value: {
            changed: true,
            level: change.level,
            file: `/tmp/${change.level}.jsonc`,
            ...(change.type === "use.set" ||
            change.type === "use.add" ||
            change.type === "use.remove"
              ? {
                  use: {
                    before: [],
                    after:
                      change.type === "use.set"
                        ? change.collections
                        : change.type === "use.add"
                          ? [change.collection]
                          : [],
                  },
                }
              : {}),
          },
          diagnostics: [],
        };
      },
      previewAddToCollection: async () => ({ value: {} as never, diagnostics: [] }),
      previewMembershipBatch: async () => ({ value: {} as never, diagnostics: [] }),
      previewMembershipRemoval: async () => ({ value: {} as never, diagnostics: [] }),
      previewImport: async () => ({ value: {} as never, diagnostics: [] }),
      previewReference: async () => ({ value: {} as never, diagnostics: [] }),
      previewLinkChange: async () => ({ value: {} as never, diagnostics: [] }),
      previewCollectionUse: async () => ({ value: {} as never, diagnostics: [] }),
      previewCollectionRemoval: async () => ({ value: {} as never, diagnostics: [] }),
    },
    management: {
      getUpdateBaseline: async () => ({ value: "fixture-baseline", diagnostics: [] }),
      previewSourceRemoval: async () => ({ value: {} as never, diagnostics: [] }),
      removeSource: async () => ({ value: undefined, diagnostics: [] }),
      previewUninstall: async () => ({ value: {} as never, diagnostics: [] }),
      previewRebind: async () => ({ value: {} as never, diagnostics: [] }),
      previewAdoptConfig: async () => ({ value: {} as never, diagnostics: [] }),
      previewForgetConfig: async () => ({ value: {} as never, diagnostics: [] }),
      previewRemoveConfig: async () => ({ value: {} as never, diagnostics: [] }),
      adoptConfig: async () => ({ value: undefined, diagnostics: [] }),
      observeConfig: async (request) => ({
        value: {
          id: request.id,
          kind: "git",
          exactRevision: "a".repeat(40),
          contributions: { sources: [], collections: [] },
        },
        diagnostics: [],
      }),
      removeConfig: async (request) => {
        calls.push(["removeConfig", request]);
        return { value: undefined, diagnostics: [] };
      },
      forgetConfig: async (request) => {
        calls.push(["forgetConfig", request]);
        return { value: undefined, diagnostics: [] };
      },
      gc: async () => {
        calls.push(["gc"]);
        return { value: undefined, diagnostics: [] };
      },
      discover: async (request) => {
        calls.push(["discover", request]);
        return {
          value: {
            source: request.source,
            kind: "git",
            exactRevision: "a".repeat(40),
            candidates: [{ path: "review", name: "review", description: "Review" }],
          },
          diagnostics: [],
        };
      },
      install: async (request) => {
        calls.push(["install", request]);
        return {
          value: [{ path: "review", name: "review", description: "Review" }],
          diagnostics: [],
        };
      },
      uninstall: async (request) => {
        calls.push(["uninstall", request]);
        return { value: undefined, diagnostics: [] };
      },
      rebind: async (request) => {
        calls.push(["rebind", request]);
        return { value: undefined, diagnostics: [] };
      },
      checkUpdate: async (request) => {
        calls.push(["check", request]);
        return {
          value: {
            source: request.source,
            kind: "git",
            exactRevision: "a".repeat(40),
            changed: [{ path: "changed", name: "changed", description: "Changed" }],
            added: [{ path: "added", name: "added", description: "Added" }],
            removed: [{ path: "removed", name: "removed", description: "Removed" }],
            unchanged: [{ path: "unchanged", name: "unchanged", description: "Unchanged" }],
          },
          diagnostics: [],
        };
      },
      update: async (request) => {
        calls.push(["update", request]);
        return { value: undefined, diagnostics: [] };
      },
    },
    catalog: {
      browse: async () => ({ value: {} as never, diagnostics: [] }),
      search: async () => ({ value: {} as never, diagnostics: [] }),
    },
    content: {
      loadInstalled: async () => ({ value: {} as never, diagnostics: [] }),
      listInstalledResources: async () => ({ value: [], diagnostics: [] }),
      readInstalled: async () => ({ value: {} as never, diagnostics: [] }),
      load: async (request) => {
        calls.push(["load", request]);
        return {
          value: {
            selector: request.selector,
            name: "review",
            description: "Review a change",
            path: "SKILL.md",
            text: "# Review\n",
            provenance: {
              source: "workspace",
              origin: "local",
              stability: "mutable-local",
            },
          },
          diagnostics: [],
        };
      },
      listResources: async () => ({ value: [], diagnostics: [] }),
      read: async () => ({ value: {} as never, diagnostics: [] }),
      download: async () => ({ value: {} as never, diagnostics: [] }),
      run: async (request) => {
        calls.push(["run", request]);
        return {
          value: { selector: request.selector, exitCode: 1, signal: null, cancelled: false },
          diagnostics: [],
        };
      },
    },
  };
}

test("CLI-001/PROJ-023 maps finalized source and management commands through Core", async () => {
  const calls: unknown[] = [];
  const options = {
    cwd: "/tmp",
    createCore: () => core(calls),
    stdout: { write() {} },
    stderr: { write() {} },
  };
  for (const argv of [
    ["source", "register", "local", "local", "./skills"],
    ["source", "register", "git", "git", "https://example.test/a.git", "--ref", "main"],
    ["source", "register", "github", "github", "https://github.com/a/b", "--ref", "main"],
    ["source", "discover", "local"],
    ["install", "local", "review"],
    ["update", "check", "local"],
    ["update", "apply", "local", "review", "--remove", "old"],
    ["rebind", "old", "review", "new", "--path", "renamed"],
    ["uninstall", "local", "review"],
  ])
    expect(await runHumanCommand(argv, options)).toBe(0);
  expect(calls).toEqual([
    {
      type: "source.register",
      level: "project",
      id: "local",
      binding: { kind: "local", path: "./skills", root: "" },
    },
    {
      type: "source.register",
      level: "project",
      id: "git",
      binding: { kind: "git", origin: "https://example.test/a.git", root: "", ref: "main" },
    },
    {
      type: "source.register",
      level: "project",
      id: "github",
      binding: { kind: "github", origin: "https://github.com/a/b", root: "", ref: "main" },
    },
    ["discover", { source: "local" }],
    ["install", { source: "local", paths: ["review"], exactRevision: undefined }],
    ["check", { source: "local" }],
    ["update", { source: "local", paths: ["review"], remove: ["old"], exactRevision: undefined }],
    ["rebind", { source: "old", path: "review", owner: "new", ownerPath: "renamed" }],
    ["uninstall", { source: "local", paths: ["review"] }],
  ]);
});

test("CLI-001 maps collection, use, managed, and content commands without legacy aliases", async () => {
  const calls: unknown[] = [];
  const options = {
    cwd: "/tmp",
    createCore: () => core(calls),
    stdout: { write() {} },
    stderr: { write() {} },
  };
  for (const argv of [
    ["collection", "member", "add", "engineering", "review", "local", "review"],
    ["collection", "member", "remove", "engineering", "review"],
    ["collection", "import", "source", "target"],
    ["collection", "reference", "add", "engineering", "docs", "other", "Documentation"],
    ["collection", "reference", "remove", "engineering", "docs"],
    ["collection", "create", "new", "--level", "local"],
    ["collection", "remove", "new", "--level", "local"],
    ["collection", "link", "add", "engineering", "other"],
    ["use", "set", "engineering"],
    ["managed", "set"],
    ["content", "load", "engineering:review"],
    ["content", "run", "engineering:review", "--", "true"],
  ])
    expect(await runHumanCommand(argv, options)).toBe(0);
  expect(calls).toContainEqual({
    type: "collection.member.remove",
    level: "project",
    collection: "engineering",
    name: "review",
  });
  expect(calls).toContainEqual({
    type: "collection.reference.remove",
    level: "project",
    collection: "engineering",
    name: "docs",
  });
  expect(calls).toContainEqual({ type: "collection.create", level: "local", collection: "new" });
  expect(calls).toContainEqual({ type: "collection.remove", level: "local", collection: "new" });
  expect(calls).toContainEqual({
    type: "collection.reference.set",
    level: "project",
    collection: "engineering",
    name: "docs",
    target: "other",
    description: "Documentation",
  });
  expect(calls).toContainEqual({
    type: "collection.link.set",
    level: "project",
    collection: "engineering",
    target: "other",
    linked: true,
  });
  expect(calls).toContainEqual({ type: "use.set", level: "project", collections: ["engineering"] });
  expect(calls).toContainEqual({ type: "agent.managed.set", level: "project", managed: true });
  expect(calls).toContainEqual(["load", { selector: "engineering:review" }]);
  expect(calls).toContainEqual(["run", { selector: "engineering:review", argv: ["true"] }]);
  expect(await runHumanCommand(["profile", "set", "x"], options)).toBe(2);
});

test("MGMT-031 maps scoped Config Source removal only through management", async () => {
  const calls: unknown[] = [];
  const options = {
    cwd: "/tmp",
    createCore: () => core(calls),
    stdout: { write() {} },
    stderr: { write() {} },
  };
  expect(await runHumanCommand(["config-source", "remove", "module", "-g"], options)).toBe(0);
  expect(calls).toEqual([["removeConfig", { id: "module", level: "global" }]]);
  expect(calls).not.toContainEqual(expect.objectContaining({ type: "config-source.remove" }));
});

test("MGMT-001 and MGMT-027 reject unknown Config levels before any Core call", async () => {
  let created = 0;
  const options = {
    cwd: "/tmp",
    createCore: () => {
      created += 1;
      return core([]);
    },
    stdout: { write() {} },
    stderr: { write() {} },
  };
  for (const argv of [
    ["source", "register", "local", "local", "./skills", "--level", "user"],
    ["managed", "unset", "--level", "user"],
  ])
    expect(await runHumanCommand(argv, options)).toBe(2);
  expect(created).toBe(0);
});

test("MGMT-001 real human Source registration writes only exact Global Project and Local targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-human-source-levels-"));
  const xdg = join(root, "xdg");
  const previousXdg = process.env.XDG_CONFIG_HOME;
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    process.env.XDG_CONFIG_HOME = xdg;
    await mkdir(xdg);
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    for (const [level, id] of [
      ["global", "global"],
      ["project", "project"],
      ["local", "local"],
    ] as const)
      expect(
        await runHumanCommand(["source", "register", "local", id, `./${id}`, "--level", level], {
          cwd: root,
          stdout: { write() {} },
          stderr: { write() {} },
        }),
      ).toBe(0);
    expect(
      JSON.parse(await readFile(join(xdg, "skill-cli", "config.jsonc"), "utf8")).sources,
    ).toEqual({ global: { kind: "local", path: "./global", root: "" } });
    expect(JSON.parse(await readFile(join(root, "skill-cli.jsonc"), "utf8")).sources).toEqual({
      project: { kind: "local", path: "./project", root: "" },
    });
    expect(JSON.parse(await readFile(join(root, "skill-cli.local.jsonc"), "utf8")).sources).toEqual(
      {
        local: { kind: "local", path: "./local", root: "" },
      },
    );
  } finally {
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-006/007/023 human observations emit deterministic exact-revision lines and equivalent JSON", async () => {
  const calls: unknown[] = [];
  const run = async (argv: string[]) => {
    const output: string[] = [];
    expect(
      await runHumanCommand(argv, {
        cwd: "/tmp",
        createCore: () => core(calls),
        stdout: { write: (value) => output.push(String(value)) },
        stderr: { write() {} },
      }),
    ).toBe(0);
    return output.join("");
  };
  expect(await run(["source", "discover", "remote"])).toBe(
    `${[
      `revision ${"a".repeat(40)}`,
      "source remote",
      "kind git",
      "candidate review\treview\tReview",
    ].join("\n")}\n`,
  );
  expect(JSON.parse(await run(["source", "discover", "remote", "--json"]))).toMatchObject({
    source: "remote",
    exactRevision: "a".repeat(40),
    candidates: [{ path: "review" }],
  });
  expect(await run(["update", "check", "remote"])).toContain(
    "changed changed\tchanged\tChanged\nadded added\tadded\tAdded",
  );
  expect(await run(["config-source", "observe", "remote"])).toStartWith(
    `revision ${"a".repeat(40)}\nconfig-source remote\n`,
  );
});

test("MGMT-034 rejects malformed exact revisions before any apply Core call", async () => {
  const calls: unknown[] = [];
  const options = {
    cwd: "/tmp",
    createCore: () => core(calls),
    stdout: { write() {} },
    stderr: { write() {} },
  };
  for (const argv of [
    ["install", "remote", "review", "--revision", "main"],
    ["update", "apply", "remote", "review", "--revision", "abc"],
    ["config-source", "adopt", "remote", "--revision", "f".repeat(39)],
  ])
    expect(await runHumanCommand(argv, options)).toBe(2);
  expect(calls).toEqual([]);
});

test("human help is written to stdout and succeeds without an error", async () => {
  for (const argv of [["--help"], ["help"], ["help", "source"], ["source", "register", "--help"]]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    expect(
      await runHumanCommand(argv, {
        cwd: "/tmp",
        stdout: { write: (value) => stdout.push(String(value)) },
        stderr: { write: (value) => stderr.push(String(value)) },
      }),
    ).toBe(0);
    expect(stdout.join("")).toContain("Usage:");
    if (argv.join(" ") === "source register --help") {
      expect(stdout.join("")).toContain("global writes the user config");
      expect(stdout.join("")).toMatch(/defaults to the\s+origin root/u);
    }
    expect(stderr.join("")).toBe("");
  }
});

test("source, config-source, install, and global use help explain the remote workflow", async () => {
  const help = async (argv: string[]) => {
    const stdout: string[] = [];
    expect(
      await runHumanCommand(argv, {
        cwd: "/tmp",
        stdout: { write: (value) => stdout.push(String(value)) },
        stderr: { write() {} },
      }),
    ).toBe(0);
    return stdout.join("");
  };
  expect(await help(["source", "register", "--help"])).toContain("Remote Sources require --ref");
  expect(await help(["source", "register", "--help"])).toContain("Git protocol");
  expect(await help(["config-source", "register", "--help"])).toContain(
    "Remote Config Sources require --ref",
  );
  expect(await help(["config-source", "register", "--help"])).toContain("Git protocol");
  expect(await help(["install", "--help"])).toContain("machine-local content");
  expect(await help(["install", "--help"])).toContain("exact 40-hex commit");
  expect(await help(["use", "add", "--help"])).toContain("use add <owner/repository> -g");
});

test("use Help names declaration scope and accepts --scope as the primary option", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  expect(
    await runHumanCommand(["use", "add", "catalog", "--scope", "global"], {
      cwd: "/tmp",
      createCore: () => core([]),
      stdout: { write: (value) => stdout.push(String(value)) },
      stderr: { write: (value) => stderr.push(String(value)) },
    }),
  ).toBe(0);
  expect(
    await runHumanCommand(["use", "add", "--help"], {
      cwd: "/tmp",
      stdout: { write: (value) => stdout.push(String(value)) },
      stderr: { write: (value) => stderr.push(String(value)) },
    }),
  ).toBe(0);
  expect(stdout.join("")).toContain("--scope <scope>");
  expect(stdout.join("")).toContain("direct catalog root");
  expect(stderr.join("")).toBe("");
});

test("declaration commands accept --level and -g/-p/-l as equivalent scope selectors", async () => {
  const calls: unknown[] = [];
  const options = {
    cwd: "/tmp",
    createCore: () => core(calls),
    stdout: { write() {} },
    stderr: { write() {} },
  };
  for (const argv of [
    ["collection", "create", "global", "-g"],
    ["collection", "create", "project", "-p"],
    ["collection", "create", "local", "-l"],
    ["collection", "create", "level", "--level", "global"],
  ])
    expect(await runHumanCommand(argv, options)).toBe(0);
  expect(calls).toEqual([
    { type: "collection.create", level: "global", collection: "global" },
    { type: "collection.create", level: "project", collection: "project" },
    { type: "collection.create", level: "local", collection: "local" },
    { type: "collection.create", level: "global", collection: "level" },
  ]);
  expect(
    await runHumanCommand(["collection", "create", "ambiguous", "-g", "--level", "local"], options),
  ).toBe(2);
});

test("human mutations describe their completed action, level, target file, and installed skills", async () => {
  const calls: unknown[] = [];
  const output: string[] = [];
  const options = {
    cwd: "/tmp",
    createCore: () => core(calls),
    stdout: { write: (value: string) => output.push(value) },
    stderr: { write() {} },
  };

  expect(
    await runHumanCommand(
      ["source", "register", "local", "workspace", "./skills", "--level", "local"],
      options,
    ),
  ).toBe(0);
  expect(
    await runHumanCommand(
      ["collection", "member", "add", "engineering", "review", "workspace", "review"],
      options,
    ),
  ).toBe(0);
  expect(await runHumanCommand(["use", "set", "engineering"], options)).toBe(0);
  expect(await runHumanCommand(["managed", "set"], options)).toBe(0);
  expect(
    await runHumanCommand(
      ["install", "workspace", "review", "--revision", "a".repeat(40)],
      options,
    ),
  ).toBe(0);

  expect(output.join("")).toContain(
    'Registered source "workspace" at local level in /tmp/local.jsonc.',
  );
  expect(output.join("")).toContain(
    'Added member "review" to collection "engineering" at project level in /tmp/project.jsonc.',
  );
  expect(output.join("")).toContain("Scope: project.");
  expect(output.join("")).toContain("Added: engineering. Retained: none. Removed: none.");
  expect(output.join("")).not.toContain("Set collection use");
  expect(output.join("")).toContain(
    "Enabled managed OpenCode at project level in /tmp/project.jsonc.",
  );
  expect(output.join("")).toContain(
    `Installed 1 skills from source "workspace" at revision ${"a".repeat(40)}: review.`,
  );
  expect(output.join("")).not.toContain("source.register\n");
  expect(output.join("")).not.toContain("management.install\n");
});

test("collection inspect labels configuration preview separately from disclosure", async () => {
  const output: string[] = [];
  const fake = core([]);
  fake.workspace.get = async () => ({
    value: {
      effective: {
        status: "complete",
        use: ["root"],
        agent: { status: "available" },
        collectionsView: [
          {
            id: "root",
            declared: [],
            repository: { derived: false, producers: [] },
            members: [],
            references: [
              {
                name: "child",
                collection: "child",
                description: "Child",
                owner: {
                  level: "project",
                  file: "/tmp/project.jsonc",
                  pointer: "/collections/root/references/child",
                },
              },
            ],
            links: [],
          },
          {
            id: "child",
            declared: [],
            repository: { derived: false, producers: [] },
            members: [],
            references: [],
            links: [],
          },
        ],
      },
      installedSkills: [],
    } as never,
    diagnostics: [],
  });
  expect(
    await runHumanCommand(["collection", "inspect", "child", "--json"], {
      cwd: "/tmp",
      createCore: () => fake,
      stdout: { write: (value) => output.push(String(value)) },
      stderr: { write() {} },
    }),
  ).toBe(0);
  const result = JSON.parse(output.join(""));
  expect(result.catalogPreview).toEqual({ skills: 0, linkedSkills: 0, collections: 0 });
  expect(result.disclosure).toEqual({ available: true, useRoot: false, referenceReachable: true });
  expect(result).not.toHaveProperty("agentProjection");
});

test("human mutations report no-op configuration changes and affected update paths", async () => {
  const calls: unknown[] = [];
  const output: string[] = [];
  const fake = core(calls);
  fake.configuration.change = async (change) => ({
    value: { changed: false, level: change.level, file: "/tmp/project.jsonc" },
    diagnostics: [],
  });
  const options = {
    cwd: "/tmp",
    createCore: () => fake,
    stdout: { write: (value: string) => output.push(value) },
    stderr: { write() {} },
  };

  expect(await runHumanCommand(["managed", "set"], options)).toBe(0);
  expect(
    await runHumanCommand(
      ["update", "apply", "workspace", "review", "docs", "--remove", "old", "legacy"],
      options,
    ),
  ).toBe(0);

  expect(output.join("")).toContain(
    "No configuration changes were needed at project level in /tmp/project.jsonc.",
  );
  expect(output.join("")).toContain(
    'Updated skills from source "workspace": review, docs; removed: old, legacy.',
  );
});

test("human init, repair, and content commands report actual results", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-human-output-"));
  const calls: unknown[] = [];
  const output: string[] = [];
  const options = {
    cwd: root,
    createCore: () => core(calls),
    stdout: { write: (value: string) => output.push(value) },
    stderr: { write() {} },
  };
  try {
    expect(await runHumanCommand(["init", "nested", "--host", "local"], options)).toBe(0);
    expect(await runHumanCommand(["repair"], options)).toBe(0);
    expect(await runHumanCommand(["content", "load", "engineering:review"], options)).toBe(0);
    expect(
      await runHumanCommand(["content", "run", "engineering:review", "--", "false"], options),
    ).toBe(0);

    expect(output.join("")).toContain(
      `Initialized configuration at ${join(root, "nested", "skill-cli.local.jsonc")}.`,
    );
    expect(output.join("")).toContain("Checked workspace state.");
    expect(output.join("")).not.toContain("Repaired workspace state.");
    expect(output.join("")).toContain(
      "selector engineering:review\nname review\ndescription Review a change\npath SKILL.md\nsource workspace\n---\n# Review\n",
    );
    expect(output.join("")).toContain('Skill "engineering:review" exited with code 1.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init reports an existing configuration without claiming to validate or change it", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-human-init-existing-"));
  const file = join(root, "skill-cli.jsonc");
  const contents = "this is not valid JSONC\n";
  const output: string[] = [];
  try {
    await writeFile(file, contents);
    expect(
      await runHumanCommand(["init", "--host", "project"], {
        cwd: root,
        stdout: { write: (value) => output.push(String(value)) },
        stderr: { write() {} },
      }),
    ).toBe(0);
    expect(output.join("")).toBe(
      `Configuration file already exists at ${file}; contents were not changed or validated.\n`,
    );
    expect(await readFile(file, "utf8")).toBe(contents);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init rejects directories and symlinks without changing their targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-human-init-non-file-"));
  const file = join(root, "skill-cli.jsonc");
  const target = join(root, "target.jsonc");
  try {
    await mkdir(file);
    const directoryOutput: string[] = [];
    const directoryErrors: string[] = [];
    expect(
      await runHumanCommand(["init", "--host", "project"], {
        cwd: root,
        stdout: { write: (value) => directoryOutput.push(String(value)) },
        stderr: { write: (value) => directoryErrors.push(String(value)) },
      }),
    ).toBe(2);
    expect(directoryOutput.join("")).toBe("");
    expect(directoryErrors.join("")).toBe(
      `INVALID_ARGUMENT: Configuration path is not an ordinary file: ${file}\n`,
    );

    await rm(file, { recursive: true });
    await writeFile(target, "unvalidated\n");
    await symlink(target, file);
    const symlinkOutput: string[] = [];
    const symlinkErrors: string[] = [];
    expect(
      await runHumanCommand(["init", "--host", "project"], {
        cwd: root,
        stdout: { write: (value) => symlinkOutput.push(String(value)) },
        stderr: { write: (value) => symlinkErrors.push(String(value)) },
      }),
    ).toBe(2);
    expect(symlinkOutput.join("")).toBe("");
    expect(symlinkErrors.join("")).toBe(
      `CONFIG_SYMLINK: Configuration file is a symlink: ${file}\n`,
    );
    expect(await readFile(target, "utf8")).toBe("unvalidated\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("human errors do not treat application errors as Commander help", async () => {
  for (const error of [
    { code: "commander.help", exitCode: 0, message: "application failure" },
    { code: "commander.helpDisplayed", exitCode: 0, message: "application failure" },
  ]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const fake = core([]);
    fake.configuration.change = async () => {
      throw error;
    };
    expect(
      await runHumanCommand(["managed", "set"], {
        cwd: "/tmp",
        createCore: () => fake,
        stdout: { write: (value) => stdout.push(String(value)) },
        stderr: { write: (value) => stderr.push(String(value)) },
      }),
    ).toBe(2);
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toStartWith("INVALID_ARGUMENT:");
  }
});

test("content load preserves its body exactly after a metadata separator", async () => {
  const output: string[] = [];
  const fake = core([]);
  const text = "line one  \nline two\n\n  ";
  fake.content.load = async (request) => ({
    value: {
      selector: request.selector,
      name: "review",
      description: "Review a change",
      path: "SKILL.md",
      text,
      provenance: { source: "workspace", origin: "local", stability: "mutable-local" },
    },
    diagnostics: [],
  });
  expect(
    await runHumanCommand(["content", "load", "engineering:review"], {
      cwd: "/tmp",
      createCore: () => fake,
      stdout: { write: (value) => output.push(String(value)) },
      stderr: { write() {} },
    }),
  ).toBe(0);
  expect(output.join("")).toContain("source workspace\n---\n");
  expect(output.join("")).toEndWith(text);
});

test("content run reports signal and cancellation results", async () => {
  const output: string[] = [];
  const fake = core([]);
  const results = [
    { selector: "engineering:review", exitCode: null, signal: "SIGTERM", cancelled: false },
    { selector: "engineering:review", exitCode: null, signal: null, cancelled: true },
  ];
  fake.content.run = async () => ({ value: results.shift()!, diagnostics: [] });
  const options = {
    cwd: "/tmp",
    createCore: () => fake,
    stdout: { write: (value: string) => output.push(value) },
    stderr: { write() {} },
  };
  expect(
    await runHumanCommand(["content", "run", "engineering:review", "--", "true"], options),
  ).toBe(0);
  expect(
    await runHumanCommand(["content", "run", "engineering:review", "--", "true"], options),
  ).toBe(0);
  expect(output.join("")).toContain('Skill "engineering:review" was terminated by signal SIGTERM.');
  expect(output.join("")).toContain('Skill "engineering:review" was cancelled.');
});
