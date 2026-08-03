import { Command, CommanderError } from "commander";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SkillCliError, type ConfigChange, type SkillCliCore } from "../core/api";
import { createSkillCliCore } from "../core/create-core";

type Output = { write(value: string): unknown };
export interface HumanCommandOptions {
  readonly cwd: string;
  readonly stdout?: Output;
  readonly stderr?: Output;
  createCore?: (options: { cwd: string; project?: string }) => SkillCliCore;
}

export function createHumanCommand(options: HumanCommandOptions): Command {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const makeCore = options.createCore ?? createSkillCliCore;
  let project: string | undefined;
  const core = () => makeCore({ cwd: options.cwd, project });
  const change = async (value: ConfigChange) => {
    const result = await core().configuration.change(value);
    const target = result.value.file ?? "the configuration file";
    const at = `at ${result.value.level} level in ${target}`;
    if (!result.value.changed) {
      stdout.write(`No configuration changes were needed ${at}.\n`);
      return;
    }
    let message: string;
    switch (value.type) {
      case "source.register":
        message = `Registered source "${value.id}" ${at}.`;
        break;
      case "config-source.register":
        message = `Registered config source "${value.id}" ${at}.`;
        break;
      case "collection.member.set":
        message = `Added member "${value.name}" to collection "${value.collection}" ${at}.`;
        break;
      case "collection.member.remove":
        message = `Removed member "${value.name}" from collection "${value.collection}" ${at}.`;
        break;
      case "collection.import":
        message = `Imported collection "${value.from}" into "${value.into}" ${at}.`;
        break;
      case "collection.reference.set":
        message = `Added reference "${value.name}" to collection "${value.collection}" ${at}.`;
        break;
      case "collection.reference.remove":
        message = `Removed reference "${value.name}" from collection "${value.collection}" ${at}.`;
        break;
      case "collection.link.set":
        message = `${value.linked ? "Linked" : "Unlinked"} collection "${value.collection}" ${value.linked ? "to" : "from"} "${value.target}" ${at}.`;
        break;
      case "use.set":
        message = `Set collection use to ${value.collections.map((collection) => `"${collection}"`).join(", ")} ${at}.`;
        break;
      case "agent.managed.set":
        message = `${value.managed ? "Enabled" : "Disabled"} managed OpenCode ${at}.`;
        break;
      default:
        message = `Updated configuration ${at}.`;
    }
    stdout.write(`${message}\n`);
  };
  const management = async <T>(message: string, action: () => Promise<T>) => {
    await action();
    stdout.write(`${message}\n`);
  };
  const revision = (value: unknown) => {
    if (typeof value === "string" && /^[a-f0-9]{40}$/u.test(value)) return value;
    throw new SkillCliError("INVALID_ARGUMENT", "Revision must be an exact 40-hex commit");
  };
  const observation = async <T>(
    action: () => Promise<{ readonly value: T }>,
    json: boolean,
    lines: (value: T) => readonly string[],
  ) => {
    const result = await action();
    stdout.write(
      json ? `${JSON.stringify(result.value)}\n` : `${lines(result.value).join("\n")}\n`,
    );
  };
  const level = (value: string) => {
    if (value === "global" || value === "project" || value === "local") return value;
    throw new SkillCliError("INVALID_ARGUMENT", "Level must be global, project, or local");
  };
  const scopeDescription =
    "Declaration scope: global writes the user config, project writes skill-cli.jsonc, local writes skill-cli.local.jsonc";
  const flagsOf = (value: { opts?: () => Record<string, unknown> }): Record<string, unknown> =>
    value.opts?.() ?? Object.fromEntries(Object.entries(value));
  const scopeOptions = (target: Command, defaultProject = true) =>
    target
      .option(
        "--scope <scope>",
        `${scopeDescription}${defaultProject ? ". Writes default to project" : ""}`,
      )
      .option("--level <level>", "Alias for --scope")
      .option("-g", "Use global declaration scope")
      .option("-p", "Use project declaration scope")
      .option("-l", "Use local declaration scope");
  const scope = (
    flags: { opts?: () => Record<string, unknown> },
    defaultScope: "global" | "project" | "local" | undefined = "project",
  ) => {
    const options = flagsOf(flags);
    const selected = [
      ...(options.scope === undefined ? [] : [["--scope", options.scope] as const]),
      ...(options.level === undefined ? [] : [["--level", options.level] as const]),
      ...(options.g ? [["-g", "global"] as const] : []),
      ...(options.p ? [["-p", "project"] as const] : []),
      ...(options.l ? [["-l", "local"] as const] : []),
    ];
    if (selected.length > 1)
      throw new SkillCliError(
        "INVALID_ARGUMENT",
        `Use one scope option, received ${selected.map(([name]) => name).join(", ")}`,
      );
    return selected.length ? level(String(selected[0]![1])) : defaultScope;
  };
  const command = new Command("skill-cli")
    .exitOverride()
    .configureOutput({
      writeOut: (value) => void stdout.write(value),
      writeErr: (value) => void stderr.write(value),
    })
    .option("--project <path>", "Resolve project and local declarations from this path.")
    .addHelpText("after", "\nAgent access: skill-cli agent --help\n")
    .hook("preAction", (current) => {
      project = current.opts().project;
    });

  command
    .command("init [path]")
    .option("--host <host>", "project")
    .action(async (path, flags) => {
      if (flags.host !== "project" && flags.host !== "local")
        throw new SkillCliError("INVALID_ARGUMENT", "Host must be project or local");
      const root = resolve(options.cwd, path ?? ".");
      const file = join(root, flags.host === "local" ? "skill-cli.local.jsonc" : "skill-cli.jsonc");
      await mkdir(root, { recursive: true });
      const entry = await lstat(file).then(
        (stats) => stats,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        },
      );
      if (entry?.isSymbolicLink())
        throw new SkillCliError("CONFIG_SYMLINK", `Configuration file is a symlink: ${file}`);
      if (entry && !entry.isFile())
        throw new SkillCliError(
          "INVALID_ARGUMENT",
          `Configuration path is not an ordinary file: ${file}`,
        );
      if (!entry) await writeFile(file, "{}\n", { flag: "a" });
      stdout.write(
        entry
          ? `Configuration file already exists at ${file}; contents were not changed or validated.\n`
          : `Initialized configuration at ${file}.\n`,
      );
    });

  const source = command
    .command("source")
    .description("Register discovery boundaries and inspect their candidate Skill Roots.");
  const sourceRegister = source
    .command("register <kind> <id> <origin>")
    .description("Declare a Source. Run discover next to inspect its candidate Skill Roots.")
    .option(
      "--root <root>",
      "Origin root for local or remote sources; defaults to the origin root",
      "",
    )
    .option("--ref <ref>");
  scopeOptions(sourceRegister);
  sourceRegister.action((kind, id, origin, flags) => {
    const options = flagsOf(flags);
    if (kind !== "local" && kind !== "git" && kind !== "github")
      throw new SkillCliError("INVALID_ARGUMENT", "Source kind must be local, git, or github");
    if (kind !== "local" && options.ref === undefined)
      throw new SkillCliError("INVALID_ARGUMENT", "Remote Source requires --ref");
    return change({
      type: "source.register",
      level: scope(flags)!,
      id,
      binding:
        kind === "local"
          ? { kind, path: origin, root: typeof options.root === "string" ? options.root : "" }
          : {
              kind,
              origin,
              root: typeof options.root === "string" ? options.root : "",
              ref: typeof options.ref === "string" ? options.ref : "",
            },
    });
  });
  source
    .command("remove <id>")
    .description("Remove a directly declared Source at one scope when it owns no installed Skills.")
    .action((id, flags) => {
      const selectedScope = scope(flags, undefined);
      return management(
        `Removed source "${id}"${selectedScope ? ` from ${selectedScope} scope` : ""}.`,
        () => core().management.removeSource({ source: id, level: selectedScope }),
      );
    });
  scopeOptions(source.commands.at(-1)!, false);
  source
    .command("discover <id>")
    .description("Observe candidate Skill Roots at the tracked revision without installing them.")
    .option("--json")
    .action((id, flags) =>
      observation(
        () => core().management.discover({ source: id }),
        !!flagsOf(flags).json,
        (value) => [
          ...(value.exactRevision ? [`revision ${value.exactRevision}`] : []),
          `source ${value.source}`,
          `kind ${value.kind}`,
          ...value.candidates.map(
            (candidate) =>
              `candidate ${candidate.path}\t${candidate.name}\t${candidate.description}`,
          ),
        ],
      ),
    );

  command
    .command("install <source> <path...>")
    .description(
      "Install reviewed candidate Skill Roots from a Source at an exact remote revision.",
    )
    .option("--revision <revision>")
    .action(async (sourceId, paths, flags) => {
      const exactRevision =
        flagsOf(flags).revision === undefined ? undefined : revision(flagsOf(flags).revision);
      const result = await core().management.install({
        source: sourceId,
        paths,
        exactRevision,
      });
      const candidates = result.value.map((candidate) => candidate.path).join(", ");
      stdout.write(
        `Installed ${result.value.length} skills from source "${sourceId}"${exactRevision ? ` at revision ${exactRevision}` : ""}${candidates ? `: ${candidates}` : ""}.\n`,
      );
    });
  const update = command
    .command("update")
    .description("Review and apply Source updates for already installed Skills.");
  update
    .command("check <source>")
    .description("Compare installed Skills with the Source's current tracked revision.")
    .option("--json")
    .action((sourceId, flags) =>
      observation(
        () => core().management.checkUpdate({ source: sourceId }),
        !!flagsOf(flags).json,
        (value) => [
          ...(value.exactRevision ? [`revision ${value.exactRevision}`] : []),
          `source ${value.source}`,
          `kind ${value.kind}`,
          ...value.changed.map(
            (candidate) => `changed ${candidate.path}\t${candidate.name}\t${candidate.description}`,
          ),
          ...value.added.map(
            (candidate) => `added ${candidate.path}\t${candidate.name}\t${candidate.description}`,
          ),
          ...value.removed.map(
            (candidate) => `removed ${candidate.path}\t${candidate.name}\t${candidate.description}`,
          ),
          ...value.unchanged.map(
            (candidate) =>
              `unchanged ${candidate.path}\t${candidate.name}\t${candidate.description}`,
          ),
        ],
      ),
    );
  update
    .command("apply <source> <path...>")
    .description("Apply reviewed Source changes at an exact remote revision.")
    .option("--remove <path...>")
    .option("--revision <revision>")
    .action(async (sourceId, paths, flags) => {
      const remove = flags.remove ?? [];
      await core().management.update({
        source: sourceId,
        paths,
        remove,
        exactRevision: flags.revision === undefined ? undefined : revision(flags.revision),
      });
      stdout.write(
        `Updated skills from source "${sourceId}": ${paths.join(", ")}${remove.length ? `; removed: ${remove.join(", ")}` : ""}.\n`,
      );
    });
  command
    .command("rebind <source> <path> <owner>")
    .description("Move an installed Skill to a different Source owner after review.")
    .option("--path <path>")
    .action((sourceId, path, owner, flags) =>
      management(`Rebound skill "${path}" from source "${sourceId}" to "${owner}".`, () =>
        core().management.rebind({ source: sourceId, path, owner, ownerPath: flags.path }),
      ),
    );
  command
    .command("uninstall <source> <path...>")
    .description(
      "Remove installed Skill materializations while preserving their Source declarations.",
    )
    .action((sourceId, paths) =>
      management(`Uninstalled ${paths.length} skills from source "${sourceId}".`, () =>
        core().management.uninstall({ source: sourceId, paths }),
      ),
    );

  const configs = command
    .command("config-source")
    .description("Manage reusable Config origins and their adopted declarations.");
  configs
    .command("register <kind> <id> <origin>")
    .description("Declare a reusable Config origin; observe and adopt it separately.")
    .option(
      "--root <root>",
      "Origin root for local or remote config sources; defaults to the origin root",
      "",
    )
    .option("--ref <ref>")
    .action((kind, id, origin, flags) => {
      const options = flagsOf(flags);
      if (kind !== "local" && kind !== "git" && kind !== "github")
        throw new SkillCliError(
          "INVALID_ARGUMENT",
          "Config Source kind must be local, git, or github",
        );
      if (kind !== "local" && options.ref === undefined)
        throw new SkillCliError("INVALID_ARGUMENT", "Remote Config Source requires --ref");
      return change({
        type: "config-source.register",
        level: scope(flags)!,
        id,
        binding:
          kind === "local"
            ? { kind, path: origin, root: typeof options.root === "string" ? options.root : "" }
            : {
                kind,
                origin,
                root: typeof options.root === "string" ? options.root : "",
                ref: typeof options.ref === "string" ? options.ref : "",
              },
      });
    });
  scopeOptions(configs.commands.at(-1)!);
  configs
    .command("remove <id>")
    .description("Remove a directly declared Config Source at one scope.")
    .action((id, flags) => {
      const selectedScope = scope(flags, undefined);
      return management(
        `Removed config source "${id}"${selectedScope ? ` from ${selectedScope} scope` : ""}.`,
        () => core().management.removeConfig({ id, level: selectedScope }),
      );
    });
  scopeOptions(configs.commands.at(-1)!, false);
  configs
    .command("observe <id>")
    .option("--json")
    .action((id, flags) =>
      observation(
        () => core().management.observeConfig({ id }),
        !!flagsOf(flags).json,
        (value) => [
          ...(value.exactRevision ? [`revision ${value.exactRevision}`] : []),
          `config-source ${value.id}`,
          `kind ${value.kind}`,
          ...value.contributions.sources.map((source) => `source ${source.id}`),
          ...value.contributions.collections.map((collection) => `collection ${collection.id}`),
        ],
      ),
    );
  configs
    .command("adopt <id>")
    .option("--revision <revision>")
    .action((id, flags) =>
      management(`Adopted config source "${id}".`, () =>
        core().management.adoptConfig({
          id,
          exactRevision:
            flagsOf(flags).revision === undefined ? undefined : revision(flagsOf(flags).revision),
        }),
      ),
    );
  configs
    .command("forget <id>")
    .action((id) =>
      management(`Forgot adopted config source "${id}".`, () =>
        core().management.forgetConfig({ id }),
      ),
    );

  const collection = command
    .command("collection")
    .description(
      "Create Collections and compose installed Skills with memberships, References, and Links.",
    );
  collection
    .command("create <id>")
    .description("Create an empty Collection declaration at one configuration level.")
    .action((collectionId, flags) =>
      change({
        type: "collection.create",
        level: scope(flags)!,
        collection: collectionId,
      }),
    );
  scopeOptions(collection.commands.at(-1)!);
  collection
    .command("remove <id>")
    .description("Remove an unreferenced, directly declared Collection.")
    .action((collectionId, flags) =>
      change({
        type: "collection.remove",
        level: scope(flags)!,
        collection: collectionId,
      }),
    );
  scopeOptions(collection.commands.at(-1)!);
  collection
    .command("inspect <id>")
    .description("Inspect a Collection's declarations, composition, and catalog disclosure.")
    .option("--json")
    .action(async (collectionId, flags) => {
      const options = flagsOf(flags);
      const selectedLevel = scope(flags, undefined);
      const workspace = await core().workspace.get();
      const effective = workspace.value.effective;
      if (effective.status !== "complete")
        throw new SkillCliError("REFERENCE_NOT_FOUND", `Collection not found: ${collectionId}`);
      const view = effective.collectionsView.find((item) => item.id === collectionId);
      if (!view)
        throw new SkillCliError("REFERENCE_NOT_FOUND", `Collection not found: ${collectionId}`);
      const selected = effective.use.includes(collectionId);
      const reachable = new Set<string>();
      const pending = [...effective.use];
      while (pending.length) {
        const id = pending.pop()!;
        if (reachable.has(id)) continue;
        reachable.add(id);
        const current = effective.collectionsView.find((collection) => collection.id === id);
        for (const reference of current?.references ?? []) pending.push(reference.collection);
      }
      const installed = new Set(
        workspace.value.installedSkills
          .filter((skill) => skill.owner.health === "healthy")
          .map((skill) => `${skill.address.source}/${skill.address.path}`),
      );
      const healthy = view.members.filter((member) =>
        installed.has(`${member.address.source}/${member.address.path}`),
      );
      const linkedSkills = healthy.filter(
        (member) =>
          !member.paths.some((path) => path.kind === "direct") &&
          member.paths.some((path) => path.kind === "via-link"),
      ).length;
      const declared = selectedLevel
        ? view.declared.filter((owner) => owner.level === selectedLevel)
        : view.declared;
      const references = selectedLevel
        ? view.references.filter((reference) => reference.owner.level === selectedLevel)
        : view.references;
      const links = selectedLevel
        ? view.links.filter((link) => link.owner.level === selectedLevel)
        : view.links;
      const result = {
        id: view.id,
        declared,
        members: view.members,
        references,
        links,
        catalogPreview: {
          skills: healthy.length,
          linkedSkills,
          collections: references.length,
        },
        disclosure: {
          available: effective.agent.status === "available",
          useRoot: selected,
          referenceReachable: reachable.has(collectionId) && !selected,
        },
      };
      if (options.json) stdout.write(`${JSON.stringify(result)}\n`);
      else
        stdout.write(
          [
            `collection ${result.id}`,
            `declared ${result.declared.map((owner) => `${owner.level}:${owner.file}`).join(", ") || "none"}`,
            `members ${result.members.length}`,
            `references ${result.references.length}`,
            `links ${result.links.length}`,
            `catalog preview ${result.catalogPreview.skills} skills; ${result.catalogPreview.linkedSkills} via links; ${result.catalogPreview.collections} child collections`,
            `disclosure available=${result.disclosure.available} use-root=${result.disclosure.useRoot} reference-reachable=${result.disclosure.referenceReachable}`,
          ].join("\n") + "\n",
        );
    });
  scopeOptions(collection.commands.at(-1)!, false);
  const member = collection.command("member");
  member
    .command("add <collection> <name> <source> <path>")
    .description("Add an installed Skill address under a stable Collection entry name.")
    .action((collectionId, name, sourceId, path, flags) =>
      change({
        type: "collection.member.set",
        level: scope(flags)!,
        collection: collectionId,
        name,
        address: { source: sourceId, path },
      }),
    );
  scopeOptions(member.commands.at(-1)!);
  member
    .command("remove <collection> <name>")
    .description("Remove a direct Collection membership by its stable entry name.")
    .action((collectionId, name, flags) =>
      change({
        type: "collection.member.remove",
        level: scope(flags)!,
        collection: collectionId,
        name,
      }),
    );
  scopeOptions(member.commands.at(-1)!);
  collection
    .command("import <from> <into>")
    .description("Copy effective memberships once into an editable Collection declaration.")
    .action((from, into, flags) =>
      change({
        type: "collection.import",
        level: scope(flags)!,
        from,
        into,
      }),
    );
  scopeOptions(collection.commands.at(-1)!);
  const reference = collection.command("reference");
  reference
    .command("add <collection> <name> <target> <description>")
    .description("Expose a child Collection for progressive catalog navigation.")
    .action((collectionId, name, target, description, flags) =>
      change({
        type: "collection.reference.set",
        level: scope(flags)!,
        collection: collectionId,
        name,
        target,
        description,
      }),
    );
  scopeOptions(reference.commands.at(-1)!);
  reference
    .command("remove <collection> <name>")
    .description("Remove one named child Collection reference.")
    .action((collectionId, name, flags) =>
      change({
        type: "collection.reference.remove",
        level: scope(flags)!,
        collection: collectionId,
        name,
      }),
    );
  scopeOptions(reference.commands.at(-1)!);
  const link = collection.command("link");
  link
    .command("add <collection> <target>")
    .description("Live-merge a target Collection's effective members into this Collection.")
    .action((collectionId, target, flags) =>
      change({
        type: "collection.link.set",
        level: scope(flags)!,
        collection: collectionId,
        target,
        linked: true,
      }),
    );
  scopeOptions(link.commands.at(-1)!);
  link
    .command("remove <collection> <target>")
    .description("Remove one live Collection membership link.")
    .action((collectionId, target, flags) =>
      change({
        type: "collection.link.set",
        level: scope(flags)!,
        collection: collectionId,
        target,
        linked: false,
      }),
    );
  scopeOptions(link.commands.at(-1)!);
  const use = command
    .command("use")
    .description("Manage direct catalog roots declared at one configuration scope.");
  const changeUse = async (
    value: Extract<ConfigChange, { readonly type: "use.set" | "use.add" | "use.remove" }>,
  ) => {
    const result = await core().configuration.change(value);
    const delta = result.value.use!;
    const added = delta.after.filter((id) => !delta.before.includes(id));
    const removed = delta.before.filter((id) => !delta.after.includes(id));
    const retained = delta.after.filter((id) => delta.before.includes(id));
    stdout.write(
      `Scope: ${value.level}. Added: ${added.join(", ") || "none"}. Retained: ${retained.join(", ") || "none"}. Removed: ${removed.join(", ") || "none"}.\n`,
    );
  };
  use
    .command("list")
    .description(
      "List direct catalog roots at one scope; this does not show the effective catalog.",
    )
    .option("--json")
    .action(async (flags) => {
      const selectedLevel = scope(flags);
      const workspace = await core().workspace.get();
      const collections =
        workspace.value.configs
          ?.find((item) => item.level === selectedLevel)
          ?.direct.collectionUse.map((item) => item.collection) ?? [];
      stdout.write(
        flagsOf(flags).json
          ? `${JSON.stringify({ scope: selectedLevel, collections })}\n`
          : `${collections.join("\n")}${collections.length ? "\n" : ""}`,
      );
    });
  scopeOptions(use.commands.at(-1)!);
  use
    .command("add <id>")
    .description("Add one direct catalog root at one scope.")
    .action((id, flags) =>
      changeUse({
        type: "use.add",
        level: scope(flags),
        collection: id,
      }),
    );
  scopeOptions(use.commands.at(-1)!);
  use
    .command("remove <id>")
    .description("Remove one direct catalog root from one scope.")
    .action((id, flags) =>
      changeUse({
        type: "use.remove",
        level: scope(flags),
        collection: id,
      }),
    );
  scopeOptions(use.commands.at(-1)!);
  use
    .command("set <collection...>")
    .description("Replace all direct catalog roots at one scope.")
    .action((collections, flags) =>
      changeUse({
        type: "use.set",
        level: scope(flags),
        collections,
      }),
    );
  scopeOptions(use.commands.at(-1)!);
  const managed = command
    .command("managed")
    .description("Enable or disable the managed OpenCode catalog projection.");
  managed
    .command("set")
    .description("Enable the managed OpenCode catalog at one configuration level.")
    .action((flags) =>
      change({
        type: "agent.managed.set",
        level: scope(flags)!,
        managed: true,
      }),
    );
  scopeOptions(managed.commands.at(-1)!);
  managed
    .command("unset")
    .description("Disable the managed OpenCode catalog at one configuration level.")
    .action((flags) =>
      change({
        type: "agent.managed.set",
        level: scope(flags)!,
        managed: false,
      }),
    );
  scopeOptions(managed.commands.at(-1)!);
  command
    .command("gc")
    .description("Permanently delete unreferenced cache material.")
    .action(() =>
      management("Garbage-collected unreferenced cache data.", () => core().management.gc()),
    );
  command
    .command("repair")
    .description("Check workspace configuration and installed Skill state for diagnostics.")
    .action(async () => {
      const result = await core().workspace.get();
      stdout.write(
        `Checked workspace state${result.diagnostics.length ? ` with ${result.diagnostics.length} diagnostics` : ""}.\n`,
      );
    });
  const content = command
    .command("content")
    .description("Inspect or run installed Skills without changing catalog declarations.");
  content
    .command("load <selector>")
    .description("Load an installed Skill's SKILL.md and provenance.")
    .action(async (selector) => {
      const result = await core().content.load({ selector });
      const { value } = result;
      stdout.write(
        [
          `selector ${value.selector}`,
          `name ${value.name}`,
          `description ${value.description}`,
          `path ${value.path}`,
          `source ${value.provenance.source}`,
          ...(value.provenance.revision ? [`revision ${value.provenance.revision}`] : []),
          "---",
        ].join("\n") + `\n${value.text}`,
      );
    });
  content
    .command("run <selector> [argv...]")
    .description("Run a command with an installed Skill materialized as its working directory.")
    .allowUnknownOption()
    .action((selector, argv) => {
      if (!argv.length)
        throw new SkillCliError("INVALID_ARGUMENT", "Run command requires child argv after --");
      return core()
        .content.run({ selector, argv })
        .then((result) => {
          const { value } = result;
          let outcome: string;
          if (value.cancelled) outcome = "was cancelled";
          else if (value.signal) outcome = `was terminated by signal ${value.signal}`;
          else outcome = `exited with code ${value.exitCode}`;
          stdout.write(`Skill "${value.selector}" ${outcome}.\n`);
        });
    });
  return command;
}

export async function runHumanCommand(
  argv: readonly string[],
  options: HumanCommandOptions,
): Promise<number> {
  try {
    await createHumanCommand(options).parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (
      error instanceof CommanderError &&
      error.exitCode === 0 &&
      (error.code === "commander.help" || error.code === "commander.helpDisplayed")
    )
      return 0;
    (options.stderr ?? process.stderr).write(
      `${error instanceof SkillCliError ? error.code : "INVALID_ARGUMENT"}: ${error instanceof Error ? error.message : "Invalid command"}\n`,
    );
    return 2;
  }
}
