import { Option, type Command } from "commander";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CommandContext } from "../command-context";
import { formatChange, formatObservation, scope, scopeOptions } from "./shared";
export function collectionCommand(
  parent: Command,
  { api, environment, stdout, cwd }: CommandContext,
) {
  const collection = parent
    .command("collection")
    .description(
      "Configure Collection descriptions and instructions; compose installed Skills with memberships, References, and Links.",
    )
    .addHelpText(
      "after",
      "\nCollection as Skill:\n" +
        "  Write it like a Skill referring to other Skills: description for when to enter;\n" +
        "  instructions for roles, workflows, and guidance. skctl adds member descriptions;\n" +
        "  full member instructions load on demand.\n" +
        "\nAuthoring: skctl collection set --help. Discovery: skctl agent --help.\n",
    );
  scopeOptions(collection.command("create <id>"))
    .description("Create an empty Collection declaration at one configuration level.")
    .action(async (collection, flags, action) => {
      const { value } = await api.createCollection(environment(action), {
        level: scope(flags)!,
        collection,
      });
      stdout.write(formatChange(value));
    });
  scopeOptions(collection.command("set <id>"))
    .description(
      "Set or clear a directly declared Collection's description and instructions. Omitted fields are preserved.",
    )
    .addOption(
      new Option("--description <text>", "Set the entry description").conflicts("clearDescription"),
    )
    .option("--clear-description", "Remove the entry description")
    .addOption(
      new Option("--instructions <text>", "Set custom instructions").conflicts([
        "instructionsFile",
        "clearInstructions",
      ]),
    )
    .addOption(
      new Option(
        "--instructions-file <path>",
        "Copy UTF-8 file contents into inline instructions",
      ).conflicts("clearInstructions"),
    )
    .option("--clear-instructions", "Remove custom instructions")
    .addHelpText(
      "after",
      "\nWriting Collection content:\n" +
        "  description: when to enter. Optional instructions: roles, workflows, and guidance.\n" +
        "  Do not repeat description or copy member descriptions; skctl supplies member entries.\n" +
        "\nExamples:\n" +
        '  skctl collection set frontend-perf-analysis --description "Diagnose frontend performance"\n' +
        "  skctl collection set frontend-perf-analysis --instructions-file ./collection-guide.md\n" +
        "  skctl agent browse frontend-perf-analysis\n" +
        "\n--instructions-file copies text into JSONC once; it does not keep a live file reference.\n",
    )
    .action(async (collection, flags, action) => {
      const instructions = flags.clearInstructions
        ? null
        : flags.instructionsFile !== undefined
          ? await readFile(resolve(cwd, flags.instructionsFile), "utf8")
          : flags.instructions;
      const { value } = await api.setCollectionContent(environment(action), {
        level: scope(flags)!,
        collection,
        ...(flags.clearDescription
          ? { description: null }
          : flags.description !== undefined
            ? { description: flags.description }
            : {}),
        ...(instructions !== undefined ? { instructions } : {}),
      });
      stdout.write(formatChange(value, `Updated content for collection "${collection}"`));
    });
  scopeOptions(collection.command("remove <id>"))
    .description("Remove an unreferenced, directly declared Collection.")
    .action(async (collection, flags, action) => {
      const { value } = await api.removeCollection(environment(action), {
        level: scope(flags)!,
        collection,
      });
      stdout.write(formatChange(value));
    });
  scopeOptions(collection.command("inspect <id>"), false)
    .description("Inspect a Collection's declarations, composition, and catalog disclosure.")
    .option("--json")
    .action(async (collectionId, flags, action) => {
      const selectedLevel = scope(flags, null);
      const { value: result } = await api.inspectCollection(environment(action), {
        collection: collectionId,
        ...(selectedLevel ? { level: selectedLevel } : {}),
      });
      stdout.write(
        formatObservation(result, !!flags.json, [
          `collection ${result.id}`,
          ...(result.description !== undefined ? [`description ${result.description}`] : []),
          ...(result.instructions !== undefined ? [`instructions\n${result.instructions}`] : []),
          `declared ${result.declared.map((owner) => `${owner.level}:${owner.file}`).join(", ") || "none"}`,
          `members ${result.members.length}`,
          `references ${result.references.length}`,
          `links ${result.links.length}`,
          `catalog preview ${result.catalogPreview.skills} skills; ${result.catalogPreview.linkedSkills} via links; ${result.catalogPreview.collections} child collections`,
          `disclosure available=${result.disclosure.available} use-root=${result.disclosure.useRoot} reference-reachable=${result.disclosure.referenceReachable}`,
        ]),
      );
    });
  const member = collection.command("member");
  scopeOptions(member.command("add <collection> <name> <source> <path>"))
    .description("Add an installed Skill address under a stable Collection entry name.")
    .action(async (collection, name, source, path, flags, action) => {
      const { value } = await api.addMember(environment(action), {
        level: scope(flags)!,
        collection,
        name,
        address: { source, path },
      });
      stdout.write(formatChange(value, `Added member "${name}" to collection "${collection}"`));
    });
  scopeOptions(member.command("remove <collection> <name>"))
    .description("Remove a direct Collection membership by its stable entry name.")
    .action(async (collection, name, flags, action) => {
      const { value } = await api.removeMember(environment(action), {
        level: scope(flags)!,
        collection,
        name,
      });
      stdout.write(formatChange(value, `Removed member "${name}" from collection "${collection}"`));
    });
  scopeOptions(collection.command("import <from> <into>"))
    .description("Copy effective memberships once into an editable Collection declaration.")
    .action(async (from, into, flags, action) => {
      const { value } = await api.importMembers(environment(action), {
        level: scope(flags)!,
        from,
        into,
      });
      stdout.write(formatChange(value, `Imported collection "${from}" into "${into}"`));
    });
  const reference = collection.command("reference");
  scopeOptions(reference.command("add <collection> <name> <target> <description>"))
    .description("Expose a child Collection for progressive catalog navigation.")
    .action(async (collection, name, target, description, flags, action) => {
      const { value } = await api.addReference(environment(action), {
        level: scope(flags)!,
        collection,
        name,
        target,
        description,
      });
      stdout.write(formatChange(value, `Added reference "${name}" to collection "${collection}"`));
    });
  scopeOptions(reference.command("remove <collection> <name>"))
    .description("Remove one named child Collection reference.")
    .action(async (collection, name, flags, action) => {
      const { value } = await api.removeReference(environment(action), {
        level: scope(flags)!,
        collection,
        name,
      });
      stdout.write(
        formatChange(value, `Removed reference "${name}" from collection "${collection}"`),
      );
    });
  const link = collection.command("link");
  scopeOptions(link.command("add <collection> <target>"))
    .description("Live-merge a target Collection's effective members into this Collection.")
    .action(async (collection, target, flags, action) => {
      const { value } = await api.setLink(environment(action), {
        level: scope(flags)!,
        collection,
        target,
        linked: true,
      });
      stdout.write(formatChange(value, `Linked collection "${collection}" to "${target}"`));
    });
  scopeOptions(link.command("remove <collection> <target>"))
    .description("Remove one live Collection membership link.")
    .action(async (collection, target, flags, action) => {
      const { value } = await api.setLink(environment(action), {
        level: scope(flags)!,
        collection,
        target,
        linked: false,
      });
      stdout.write(formatChange(value, `Unlinked collection "${collection}" from "${target}"`));
    });
}
