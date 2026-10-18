import type { Command } from "commander";
import { SkillCliError } from "@skill-cli/core";
import type { CommandContext } from "../command-context";
import { formatChange, formatObservation, scope, scopeOptions } from "./shared";

export function collectionCommand(parent: Command, { core, stdout }: CommandContext) {
  const collection = parent
    .command("collection")
    .description(
      "Create Collections and compose installed Skills with memberships, References, and Links.",
    );
  scopeOptions(collection.command("create <id>"))
    .description("Create an empty Collection declaration at one configuration level.")
    .action(async (collection, flags, action) => {
      const { value } = await core(action).configuration.change({
        type: "collection.create",
        level: scope(flags)!,
        collection,
      });
      stdout.write(formatChange(value));
    });
  scopeOptions(collection.command("remove <id>"))
    .description("Remove an unreferenced, directly declared Collection.")
    .action(async (collection, flags, action) => {
      const { value } = await core(action).configuration.change({
        type: "collection.remove",
        level: scope(flags)!,
        collection,
      });
      stdout.write(formatChange(value));
    });
  scopeOptions(collection.command("inspect <id>"), false)
    .description("Inspect a Collection's declarations, composition, and catalog disclosure.")
    .option("--json")
    .action(async (collectionId, flags, action) => {
      const selectedLevel = scope(flags, undefined);
      const { value: workspace } = await core(action).workspace.get();
      const effective = workspace.effective;
      if (effective.status !== "complete")
        throw new SkillCliError("REFERENCE_NOT_FOUND", `Collection not found: ${collectionId}`);
      const view = effective.collectionsView.find((item) => item.id === collectionId);
      if (!view)
        throw new SkillCliError("REFERENCE_NOT_FOUND", `Collection not found: ${collectionId}`);
      const selected = effective.use.includes(collectionId);
      const collections = new Map(effective.collectionsView.map((item) => [item.id, item]));
      const reachable = new Set(effective.use);
      for (const id of reachable)
        for (const reference of collections.get(id)?.references ?? [])
          reachable.add(reference.collection);
      const installed = new Set(
        workspace.installedSkills
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
        catalogPreview: { skills: healthy.length, linkedSkills, collections: references.length },
        disclosure: {
          available: effective.agent.status === "available",
          useRoot: selected,
          referenceReachable: reachable.has(collectionId) && !selected,
        },
      };
      stdout.write(
        formatObservation(result, !!flags.json, [
          `collection ${result.id}`,
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
      const { value } = await core(action).configuration.change({
        type: "collection.member.set",
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
      const { value } = await core(action).configuration.change({
        type: "collection.member.remove",
        level: scope(flags)!,
        collection,
        name,
      });
      stdout.write(formatChange(value, `Removed member "${name}" from collection "${collection}"`));
    });
  scopeOptions(collection.command("import <from> <into>"))
    .description("Copy effective memberships once into an editable Collection declaration.")
    .action(async (from, into, flags, action) => {
      const { value } = await core(action).configuration.change({
        type: "collection.import",
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
      const { value } = await core(action).configuration.change({
        type: "collection.reference.set",
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
      const { value } = await core(action).configuration.change({
        type: "collection.reference.remove",
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
      const { value } = await core(action).configuration.change({
        type: "collection.link.set",
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
      const { value } = await core(action).configuration.change({
        type: "collection.link.set",
        level: scope(flags)!,
        collection,
        target,
        linked: false,
      });
      stdout.write(formatChange(value, `Unlinked collection "${collection}" from "${target}"`));
    });
}
