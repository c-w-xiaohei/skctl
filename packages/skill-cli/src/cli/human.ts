import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
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
  const makeCore = options.createCore ?? createSkillCliCore;
  let project: string | undefined;
  const core = () => makeCore({ cwd: options.cwd, project });
  const change = async (value: ConfigChange) => {
    await core().configuration.change(value);
    stdout.write(`${value.type}\n`);
  };
  const management = async <T>(label: string, action: () => Promise<T>) => {
    await action();
    stdout.write(`${label}\n`);
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
  const flagsOf = (value: { opts?: () => Record<string, unknown> }): Record<string, unknown> =>
    value.opts?.() ?? Object.fromEntries(Object.entries(value));
  const command = new Command("skill-cli")
    .exitOverride()
    .option("--project <path>")
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
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, flags.host === "local" ? "skill-cli.local.jsonc" : "skill-cli.jsonc"),
        "{}\n",
        { flag: "a" },
      );
    });

  const source = command.command("source");
  const sourceRegister = source
    .command("register <kind> <id> <origin>")
    .option("--root <root>", "")
    .option("--ref <ref>")
    .option("--level <level>", "project");
  sourceRegister.action((kind, id, origin, flags) => {
    const options = flagsOf(flags);
    if (kind !== "local" && kind !== "git" && kind !== "github")
      throw new SkillCliError("INVALID_ARGUMENT", "Source kind must be local, git, or github");
    if (kind !== "local" && options.ref === undefined)
      throw new SkillCliError("INVALID_ARGUMENT", "Remote Source requires --ref");
    return change({
      type: "source.register",
      level: level(String(options.level ?? "project")),
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
    .action((id) =>
      management("source.remove", () => core().management.removeSource({ source: id })),
    );
  source
    .command("discover <id>")
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
    .option("--revision <revision>")
    .action((sourceId, paths, flags) =>
      management("management.install", () =>
        core().management.install({
          source: sourceId,
          paths,
          exactRevision:
            flagsOf(flags).revision === undefined ? undefined : revision(flagsOf(flags).revision),
        }),
      ),
    );
  const update = command.command("update");
  update
    .command("check <source>")
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
    .option("--remove <path...>")
    .option("--revision <revision>")
    .action((sourceId, paths, flags) =>
      management("update.apply", () =>
        core().management.update({
          source: sourceId,
          paths,
          remove: flags.remove ?? [],
          exactRevision: flags.revision === undefined ? undefined : revision(flags.revision),
        }),
      ),
    );
  command
    .command("rebind <source> <path> <owner>")
    .option("--path <path>")
    .action((sourceId, path, owner, flags) =>
      management("skill.rebind", () =>
        core().management.rebind({ source: sourceId, path, owner, ownerPath: flags.path }),
      ),
    );
  command
    .command("uninstall <source> <path...>")
    .action((sourceId, paths) =>
      management("management.uninstall", () =>
        core().management.uninstall({ source: sourceId, paths }),
      ),
    );

  const configs = command.command("config-source");
  configs
    .command("register <kind> <id> <origin>")
    .option("--root <root>", "")
    .option("--ref <ref>")
    .option("--level <level>", "project")
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
        level: level(String(options.level ?? "project")),
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
  configs
    .command("remove <id>")
    .action((id) =>
      management("config-source.remove", () => core().management.removeConfig({ id })),
    );
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
      management("config-source.adopt", () =>
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
      management("config-source.forget", () => core().management.forgetConfig({ id })),
    );

  const collection = command.command("collection");
  const member = collection.command("member");
  member
    .command("add <collection> <name> <source> <path>")
    .option("--level <level>", "project")
    .action((collectionId, name, sourceId, path, flags) =>
      change({
        type: "collection.member.set",
        level: level(String(flagsOf(flags).level ?? "project")),
        collection: collectionId,
        name,
        address: { source: sourceId, path },
      }),
    );
  member
    .command("remove <collection> <name>")
    .option("--level <level>", "project")
    .action((collectionId, name, flags) =>
      change({
        type: "collection.member.remove",
        level: level(String(flagsOf(flags).level ?? "project")),
        collection: collectionId,
        name,
      }),
    );
  collection
    .command("import <from> <into>")
    .option("--level <level>", "project")
    .action((from, into, flags) =>
      change({
        type: "collection.import",
        level: level(String(flagsOf(flags).level ?? "project")),
        from,
        into,
      }),
    );
  const reference = collection.command("reference");
  reference
    .command("add <collection> <name> <target> <description>")
    .option("--level <level>", "project")
    .action((collectionId, name, target, description, flags) =>
      change({
        type: "collection.reference.set",
        level: level(String(flagsOf(flags).level ?? "project")),
        collection: collectionId,
        name,
        target,
        description,
      }),
    );
  const link = collection.command("link");
  link
    .command("add <collection> <target>")
    .option("--level <level>", "project")
    .action((collectionId, target, flags) =>
      change({
        type: "collection.link.set",
        level: level(String(flagsOf(flags).level ?? "project")),
        collection: collectionId,
        target,
        linked: true,
      }),
    );
  link
    .command("remove <collection> <target>")
    .option("--level <level>", "project")
    .action((collectionId, target, flags) =>
      change({
        type: "collection.link.set",
        level: level(String(flagsOf(flags).level ?? "project")),
        collection: collectionId,
        target,
        linked: false,
      }),
    );
  const use = command.command("use");
  use
    .command("set <collection...>")
    .option("--level <level>", "project")
    .action((collections, flags) =>
      change({
        type: "use.set",
        level: level(String(flagsOf(flags).level ?? "project")),
        collections,
      }),
    );
  const managed = command.command("managed");
  managed
    .command("set")
    .option("--level <level>", "project")
    .action((flags) =>
      change({
        type: "agent.managed.set",
        level: level(String(flagsOf(flags).level ?? "project")),
        managed: true,
      }),
    );
  managed
    .command("unset")
    .option("--level <level>", "project")
    .action((flags) =>
      change({
        type: "agent.managed.set",
        level: level(String(flagsOf(flags).level ?? "project")),
        managed: false,
      }),
    );
  command.command("gc").action(() => management("cache.gc", () => core().management.gc()));
  command.command("repair").action(() => management("repair", () => core().workspace.get()));
  const content = command.command("content");
  content
    .command("load <selector>")
    .action((selector) => management("content.load", () => core().content.load({ selector })));
  content
    .command("run <selector> [argv...]")
    .allowUnknownOption()
    .action((selector, argv) => {
      if (!argv.length)
        throw new SkillCliError("INVALID_ARGUMENT", "Run command requires child argv after --");
      return management("content.run", () => core().content.run({ selector, argv }));
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
    (options.stderr ?? process.stderr).write(
      `${error instanceof SkillCliError ? error.code : "INVALID_ARGUMENT"}: ${error instanceof Error ? error.message : "Invalid command"}\n`,
    );
    return 2;
  }
}
