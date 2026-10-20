import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMain } from "../src/main";
import type * as api from "@skctl/core";
function core(calls: unknown[]): Partial<typeof api> {
  const unsupported = async (): Promise<never> => {
    throw new Error("Unsupported Core method in human CLI test fake");
  };
  const write = async (request: { level: "global" | "project" | "local" }) => ({
    value: { changed: true, level: request.level, file: `/tmp/${request.level}.jsonc` },
    diagnostics: [],
  });
  return {
    getWorkspace: unsupported,
    inspectCollection: unsupported,
    createCollection: async (_environment, request) => {
      calls.push({ method: "create", request });
      return write(request);
    },
    removeCollection: async (_environment, request) => {
      calls.push({ method: "remove", request });
      return write(request);
    },
    addMember: async (_environment, request) => {
      calls.push({ method: "addMember", request });
      return write(request);
    },
    removeMember: async (_environment, request) => {
      calls.push({ method: "removeMember", request });
      return write(request);
    },
    editMembers: async (_environment, request) => {
      calls.push({ method: "editMembers", request });
      return write(request);
    },
    importMembers: async (_environment, request) => {
      calls.push({ method: "importMembers", request });
      return write(request);
    },
    addReference: async (_environment, request) => {
      calls.push({ method: "addReference", request });
      return write(request);
    },
    removeReference: async (_environment, request) => {
      calls.push({ method: "removeReference", request });
      return write(request);
    },
    setLink: async (_environment, request) => {
      calls.push({ method: "setLink", request });
      return write(request);
    },
    previewAddToCollection: unsupported,
    previewMembershipRemoval: unsupported,
    previewMembershipBatch: unsupported,
    previewImport: unsupported,
    previewAddReference: unsupported,
    previewRemoveReference: unsupported,
    previewLinkChange: unsupported,
    previewCollectionRemoval: unsupported,
    setUse: async (_environment, request) => {
      calls.push({ method: "use.set", request });
      return {
        value: {
          ...(await write(request)).value,
          use: { before: [], after: [...request.collections] },
        },
        diagnostics: [],
      };
    },
    addUse: async (_environment, request) => {
      calls.push({ method: "use.add", request });
      return {
        value: {
          ...(await write(request)).value,
          use: { before: [], after: [request.collection] },
        },
        diagnostics: [],
      };
    },
    removeUse: async (_environment, request) => {
      calls.push({ method: "use.remove", request });
      return {
        value: {
          ...(await write(request)).value,
          use: { before: [request.collection], after: [] },
        },
        diagnostics: [],
      };
    },
    previewCollectionUse: unsupported,
    setManagedOpenCode: async (_environment, request) => {
      calls.push({ method: "managed", request });
      return write(request);
    },
    registerSource: async (_environment, request) => {
      calls.push(["source.register", request]);
      return write(request);
    },
    discoverSkills: async (_environment, request) => {
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
    previewSourceRemoval: unsupported,
    removeSource: async (_environment, request) => {
      calls.push(["removeSource", request]);
      return { value: undefined, diagnostics: [] };
    },
    registerConfigSource: async (_environment, request) => {
      calls.push(["configSources.register", request]);
      return write(request);
    },
    observeConfigSource: async (_environment, request) => ({
      value: {
        id: request.id,
        kind: "git",
        exactRevision: "a".repeat(40),
        contributions: { sources: [], collections: [] },
      },
      diagnostics: [],
    }),
    adoptConfigSource: async (_environment, request) => {
      calls.push(["adoptConfig", request]);
      return { value: undefined, diagnostics: [] };
    },
    previewConfigAdoption: unsupported,
    forgetConfig: async (_environment, request) => {
      calls.push(["forgetConfig", request]);
      return { value: undefined, diagnostics: [] };
    },
    previewConfigForget: unsupported,
    removeConfig: async (_environment, request) => {
      calls.push(["removeConfig", request]);
      return { value: undefined, diagnostics: [] };
    },
    previewConfigRemoval: unsupported,
    installSkills: async (_environment, request) => {
      calls.push(["install", request]);
      return {
        value: [{ path: "review", name: "review", description: "Review" }],
        diagnostics: [],
      };
    },
    uninstallSkills: async (_environment, request) => {
      calls.push(["uninstall", request]);
      return { value: undefined, diagnostics: [] };
    },
    previewUninstall: unsupported,
    rebindSkill: async (_environment, request) => {
      calls.push(["rebind", request]);
      return { value: undefined, diagnostics: [] };
    },
    previewRebind: unsupported,
    checkUpdate: async (_environment, request) => {
      calls.push(["check", request]);
      return {
        value: {
          source: request.source,
          kind: "git",
          baseline: "fixture-baseline",
          exactRevision: "a".repeat(40),
          changed: [{ path: "changed", name: "changed", description: "Changed" }],
          added: [{ path: "added", name: "added", description: "Added" }],
          removed: [{ path: "removed", name: "removed", description: "Removed" }],
          unchanged: [{ path: "unchanged", name: "unchanged", description: "Unchanged" }],
        },
        diagnostics: [],
      };
    },
    previewUpdate: unsupported,
    getUpdateBaseline: async (_environment) => ({
      value: "fixture-baseline" as never,
      diagnostics: [],
    }),
    updateSkills: async (_environment, request) => {
      calls.push(["update", request]);
      return { value: undefined, diagnostics: [] };
    },
    loadInstalledSkill: async (_environment) => ({}) as never,
    listInstalledResources: async (_environment) => [],
    readInstalledResource: async (_environment) => ({}) as never,
    gc: async () => {
      calls.push(["gc"]);
      return { value: undefined, diagnostics: [] };
    },
    browseCatalog: async (_environment) => ({ value: {} as never, diagnostics: [] }),
    searchSkills: async (_environment) => ({
      value: { results: [], truncated: false },
      diagnostics: [],
    }),
    loadSkill: async (_environment, request) => {
      calls.push(["load", request]);
      return {
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
      };
    },
    readResource: async (_environment) => ({}) as never,
    downloadResource: async (_environment) => ({}) as never,
    runSkill: async (_environment, request) => {
      calls.push(["run", request]);
      return { selector: request.selector, exitCode: 1, signal: null, cancelled: false };
    },
  };
}
test("CLI-001/PROJ-023 maps finalized source and management commands through Core", async () => {
  const calls: unknown[] = [];
  const options = {
    cwd: "/tmp",
    api: {
      ...core(calls),
      registerSource: async (environment: api.CoreOptions, request: api.RegisterSourceRequest) => {
        expect(environment).toEqual({ cwd: "/tmp", project: "/workspace" });
        calls.push(["source.register", request]);
        return {
          value: { level: request.level, file: `/tmp/${request.level}.jsonc`, changed: true },
          diagnostics: [],
        };
      },
    },
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
    expect(await runMain(["--project", "/workspace", ...argv], options)).toBe(0);
  expect(calls).toEqual([
    [
      "source.register",
      { level: "project", id: "local", binding: { kind: "local", path: "./skills", root: "" } },
    ],
    [
      "source.register",
      {
        level: "project",
        id: "git",
        binding: { kind: "git", origin: "https://example.test/a.git", root: "", ref: "main" },
      },
    ],
    [
      "source.register",
      {
        level: "project",
        id: "github",
        binding: { kind: "github", origin: "https://github.com/a/b", root: "", ref: "main" },
      },
    ],
    ["discover", { source: "local" }],
    ["install", { source: "local", paths: ["review"], exactRevision: undefined }],
    ["check", { source: "local" }],
    ["update", { source: "local", paths: ["review"], remove: ["old"], exactRevision: undefined }],
    ["rebind", { source: "old", path: "review", owner: "new", ownerPath: "renamed" }],
    ["uninstall", { source: "local", paths: ["review"] }],
  ]);
});
test("CLI-001 maps collection, use, managed, and content commands through named APIs", async () => {
  const calls: unknown[] = [];
  const options = {
    cwd: "/tmp",
    api: {
      ...core(calls),
      registerSource: async (environment: api.CoreOptions, request: api.RegisterSourceRequest) => {
        expect(environment).toEqual({ cwd: "/tmp", project: "/workspace" });
        calls.push(["source.register", request]);
        return {
          value: { level: request.level, file: `/tmp/${request.level}.jsonc`, changed: true },
          diagnostics: [],
        };
      },
    },
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
    ["collection", "link", "remove", "engineering", "other"],
    ["use", "set", "engineering"],
    ["managed", "set"],
    ["content", "load", "engineering:review"],
    ["content", "run", "engineering:review", "--", "true"],
  ]) {
    expect(await runMain([argv[0]!, "--project", "/workspace", ...argv.slice(1)], options)).toBe(0);
  }
  expect(calls).toContainEqual({
    method: "addMember",
    request: {
      level: "project",
      collection: "engineering",
      name: "review",
      address: { source: "local", path: "review" },
    },
  });
  expect(calls).toContainEqual({
    method: "importMembers",
    request: {
      level: "project",
      from: "source",
      into: "target",
    },
  });
  expect(calls).toContainEqual({
    method: "removeMember",
    request: { level: "project", collection: "engineering", name: "review" },
  });
  expect(calls).toContainEqual({
    method: "removeReference",
    request: { level: "project", collection: "engineering", name: "docs" },
  });
  expect(calls).toContainEqual({
    method: "create",
    request: { level: "local", collection: "new" },
  });
  expect(calls).toContainEqual({
    method: "remove",
    request: { level: "local", collection: "new" },
  });
  expect(calls).toContainEqual({
    method: "addReference",
    request: {
      level: "project",
      collection: "engineering",
      name: "docs",
      target: "other",
      description: "Documentation",
    },
  });
  expect(calls).toContainEqual({
    method: "setLink",
    request: { level: "project", collection: "engineering", target: "other", linked: true },
  });
  expect(calls).toContainEqual({
    method: "setLink",
    request: { level: "project", collection: "engineering", target: "other", linked: false },
  });
  expect(calls).toContainEqual({
    method: "use.set",
    request: { level: "project", collections: ["engineering"] },
  });
  expect(calls).toContainEqual({ method: "managed", request: { level: "project", managed: true } });
  expect(calls).toContainEqual(["load", { selector: "engineering:review" }]);
  expect(calls).toContainEqual(["run", { selector: "engineering:review", argv: ["true"] }]);
  expect(await runMain(["profile", "set", "x"], options)).toBe(2);
});
test("MGMT-031 maps scoped Config Source removal through configSources", async () => {
  const calls: unknown[] = [];
  const options = {
    cwd: "/tmp",
    api: core(calls),
    stdout: { write() {} },
    stderr: { write() {} },
  };
  expect(await runMain(["config-source", "remove", "module", "-g"], options)).toBe(0);
  expect(calls).toEqual([["removeConfig", { id: "module", level: "global" }]]);
});
test("MGMT-001 and MGMT-027 reject unknown Config levels before any Core call", async () => {
  const calls: unknown[] = [];
  const options = {
    cwd: "/tmp",
    api: core(calls),
    stdout: { write() {} },
    stderr: { write() {} },
  };
  for (const argv of [
    ["source", "register", "local", "local", "./skills", "--level", "user"],
    ["managed", "unset", "--level", "user"],
  ])
    expect(await runMain(argv, options)).toBe(2);
  expect(calls).toEqual([]);
});
test("MGMT-001 real human Source registration writes only exact Global Project and Local targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-human-source-levels-"));
  const xdg = join(root, "xdg");
  const previousXdg = process.env.XDG_CONFIG_HOME;
  try {
    process.env.SKCTL_STATE_DIR = join(root, "state");
    process.env.XDG_CONFIG_HOME = xdg;
    await mkdir(xdg);
    await writeFile(join(root, "skctl.jsonc"), "{}\n");
    for (const [level, id] of [
      ["global", "global"],
      ["project", "project"],
      ["local", "local"],
    ] as const)
      expect(
        await runMain(["source", "register", "local", id, `./${id}`, "--level", level], {
          cwd: root,
          stdout: { write() {} },
          stderr: { write() {} },
        }),
      ).toBe(0);
    expect(JSON.parse(await readFile(join(xdg, "skctl", "config.jsonc"), "utf8")).sources).toEqual({
      global: { kind: "local", path: "./global", root: "" },
    });
    expect(JSON.parse(await readFile(join(root, "skctl.jsonc"), "utf8")).sources).toEqual({
      project: { kind: "local", path: "./project", root: "" },
    });
    expect(JSON.parse(await readFile(join(root, "skctl.local.jsonc"), "utf8")).sources).toEqual({
      local: { kind: "local", path: "./local", root: "" },
    });
  } finally {
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("MGMT-006/007/023 human observations emit deterministic exact-revision lines and equivalent JSON", async () => {
  const calls: unknown[] = [];
  const run = async (argv: string[]) => {
    const output: string[] = [];
    expect(
      await runMain(argv, {
        cwd: "/tmp",
        api: core(calls),
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
  expect(JSON.parse(await run(["update", "check", "remote", "--json"]))).toHaveProperty(
    "baseline",
    "fixture-baseline",
  );
  await run([
    "update",
    "apply",
    "remote",
    "changed",
    "--revision",
    "a".repeat(40),
    "--baseline",
    "fixture-baseline",
  ]);
  expect(calls).toContainEqual([
    "update",
    expect.objectContaining({ expectedBaseline: "fixture-baseline" }),
  ]);
  expect(await run(["config-source", "observe", "remote"])).toStartWith(
    `revision ${"a".repeat(40)}\nconfig-source remote\n`,
  );
});
test("MGMT-034 rejects malformed exact revisions before any apply Core call", async () => {
  const calls: unknown[] = [];
  const options = {
    cwd: "/tmp",
    api: core(calls),
    stdout: { write() {} },
    stderr: { write() {} },
  };
  for (const argv of [
    ["install", "remote", "review", "--revision", "main"],
    ["update", "apply", "remote", "review", "--revision", "abc"],
    ["config-source", "adopt", "remote", "--revision", "f".repeat(39)],
    ["config-source", "adopt", "remote"],
  ])
    expect(await runMain(argv, options)).toBe(2);
  expect(calls).toEqual([]);
});
test("human help is written to stdout and succeeds without an error", async () => {
  for (const argv of [["--help"], ["help"], ["help", "source"], ["source", "register", "--help"]]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    expect(
      await runMain(argv, {
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
      await runMain(argv, {
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
    await runMain(["use", "add", "catalog", "--scope", "global"], {
      cwd: "/tmp",
      api: core([]),
      stdout: { write: (value) => stdout.push(String(value)) },
      stderr: { write: (value) => stderr.push(String(value)) },
    }),
  ).toBe(0);
  expect(
    await runMain(["use", "add", "--help"], {
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
    api: core(calls),
    stdout: { write() {} },
    stderr: { write() {} },
  };
  for (const argv of [
    ["collection", "create", "global", "-g"],
    ["collection", "create", "project", "-p"],
    ["collection", "create", "local", "-l"],
    ["collection", "create", "level", "--level", "global"],
  ])
    expect(await runMain(argv, options)).toBe(0);
  expect(calls).toEqual([
    { method: "create", request: { level: "global", collection: "global" } },
    { method: "create", request: { level: "project", collection: "project" } },
    { method: "create", request: { level: "local", collection: "local" } },
    { method: "create", request: { level: "global", collection: "level" } },
  ]);
  expect(
    await runMain(["collection", "create", "ambiguous", "-g", "--level", "local"], options),
  ).toBe(2);
});
test("human mutations describe their completed action, level, target file, and installed skills", async () => {
  const calls: unknown[] = [];
  const output: string[] = [];
  const options = {
    cwd: "/tmp",
    api: core(calls),
    stdout: { write: (value: string) => output.push(value) },
    stderr: { write() {} },
  };
  expect(
    await runMain(
      ["source", "register", "local", "workspace", "./skills", "--level", "local"],
      options,
    ),
  ).toBe(0);
  expect(
    await runMain(
      ["collection", "member", "add", "engineering", "review", "workspace", "review"],
      options,
    ),
  ).toBe(0);
  expect(await runMain(["use", "set", "engineering"], options)).toBe(0);
  expect(await runMain(["managed", "set"], options)).toBe(0);
  expect(
    await runMain(["install", "workspace", "review", "--revision", "a".repeat(40)], options),
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
  expect(calls).toContainEqual([
    "install",
    { source: "workspace", paths: ["review"], exactRevision: "a".repeat(40) },
  ]);
});
test("collection inspect labels configuration preview separately from disclosure", async () => {
  const output: string[] = [];
  const calls: unknown[] = [];
  const fake = core(calls);
  fake.inspectCollection = async (_environment, request) => {
    calls.push({ method: "inspect", request });
    return {
      value: {
        id: "child",
        declared: [],
        members: [],
        references: [],
        links: [],
        catalogPreview: { skills: 0, linkedSkills: 0, collections: 0 },
        disclosure: { available: true, useRoot: false, referenceReachable: true },
      },
      diagnostics: [],
    };
  };
  expect(
    await runMain(["collection", "inspect", "child", "--json"], {
      cwd: "/tmp",
      api: fake,
      stdout: { write: (value) => output.push(String(value)) },
      stderr: { write() {} },
    }),
  ).toBe(0);
  const result = JSON.parse(output.join(""));
  expect(calls).toContainEqual({ method: "inspect", request: { collection: "child" } });
  expect(result.catalogPreview).toEqual({ skills: 0, linkedSkills: 0, collections: 0 });
  expect(result.disclosure).toEqual({ available: true, useRoot: false, referenceReachable: true });
  expect(result).not.toHaveProperty("agentProjection");
  output.length = 0;
  expect(
    await runMain(["collection", "inspect", "child", "--scope", "global", "--json"], {
      cwd: "/tmp",
      api: fake,
      stdout: { write: (value) => output.push(String(value)) },
      stderr: { write() {} },
    }),
  ).toBe(0);
  expect(calls).toContainEqual({
    method: "inspect",
    request: { collection: "child", level: "global" },
  });
});
test("human mutations report no-op configuration writes and affected update paths", async () => {
  const calls: unknown[] = [];
  const output: string[] = [];
  const fake = core(calls);
  fake.setManagedOpenCode = async (_environment, request) => ({
    value: { changed: false, level: request.level, file: "/tmp/project.jsonc" },
    diagnostics: [],
  });
  const options = {
    cwd: "/tmp",
    api: fake,
    stdout: { write: (value: string) => output.push(value) },
    stderr: { write() {} },
  };
  expect(await runMain(["managed", "set"], options)).toBe(0);
  expect(
    await runMain(
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
  const root = await mkdtemp(join(tmpdir(), "skctl-human-output-"));
  const calls: unknown[] = [];
  const output: string[] = [];
  const fake: Partial<typeof api> = {
    ...core(calls),
    getWorkspace: async (_environment) => ({
      value: {
        project: { root, resolution: "explicit" },
        configs: [],
        effective: {
          status: "complete",
          sources: [],
          collections: [],
          use: [],
          managed: false,
          collectionsView: [],
          agent: { status: "unavailable", integration: [], use: [], reasons: [], catalog: [] },
        },
        installedSkills: [],
        diagnostics: [],
      },
      diagnostics: [],
    }),
  };
  const options = {
    cwd: root,
    api: fake,
    stdout: { write: (value: string) => output.push(value) },
    stderr: { write() {} },
  };
  try {
    expect(await runMain(["init", "nested", "--host", "local"], options)).toBe(0);
    expect(await runMain(["repair"], options)).toBe(0);
    expect(await runMain(["content", "load", "engineering:review"], options)).toBe(0);
    expect(await runMain(["content", "run", "engineering:review", "--", "false"], options)).toBe(0);
    expect(output.join("")).toContain(
      `Initialized configuration at ${join(root, "nested", "skctl.local.jsonc")}.`,
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
  const root = await mkdtemp(join(tmpdir(), "skctl-human-init-existing-"));
  const file = join(root, "skctl.jsonc");
  const contents = "this is not valid JSONC\n";
  const output: string[] = [];
  try {
    await writeFile(file, contents);
    expect(
      await runMain(["init", "--host", "project"], {
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
  const root = await mkdtemp(join(tmpdir(), "skctl-human-init-non-file-"));
  const file = join(root, "skctl.jsonc");
  const target = join(root, "target.jsonc");
  try {
    await mkdir(file);
    const directoryOutput: string[] = [];
    const directoryErrors: string[] = [];
    expect(
      await runMain(["init", "--host", "project"], {
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
      await runMain(["init", "--host", "project"], {
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
    fake.setManagedOpenCode = async () => {
      throw error;
    };
    expect(
      await runMain(["managed", "set"], {
        cwd: "/tmp",
        api: fake,
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
  fake.loadSkill = async (_environment, request) => ({
    selector: request.selector,
    name: "review",
    description: "Review a change",
    path: "SKILL.md",
    text,
    provenance: { source: "workspace", origin: "local", stability: "mutable-local" },
  });
  expect(
    await runMain(["content", "load", "engineering:review"], {
      cwd: "/tmp",
      api: fake,
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
  fake.runSkill = async () => results.shift()!;
  const options = {
    cwd: "/tmp",
    api: fake,
    stdout: { write: (value: string) => output.push(value) },
    stderr: { write() {} },
  };
  expect(await runMain(["content", "run", "engineering:review", "--", "true"], options)).toBe(0);
  expect(await runMain(["content", "run", "engineering:review", "--", "true"], options)).toBe(0);
  expect(output.join("")).toContain('Skill "engineering:review" was terminated by signal SIGTERM.');
  expect(output.join("")).toContain('Skill "engineering:review" was cancelled.');
});
