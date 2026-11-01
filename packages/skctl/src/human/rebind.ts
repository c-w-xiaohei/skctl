import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Command } from "commander";
import { rebindImpactSchema, sameSkillAddress, SkctlError, type RebindImpact } from "@skctl/core";
import type { CommandContext } from "../command-context";
import { formatObservation } from "./shared";

export function rebindCommand(parent: Command, { api, cwd, environment, stdout }: CommandContext) {
  const rebind = parent
    .command("rebind")
    .description("Review and move an installed Skill to a different Source owner.");
  rebind
    .command("preview <source> <path> <owner>")
    .description("Preview the complete rebind impact; save --json output for apply.")
    .option("--path <path>", "Skill path at the destination Source.")
    .option("--json", "Output the complete review as JSON.")
    .action(async (source, path, owner, flags, action) => {
      const { value } = await api.previewRebind(environment(action), {
        source,
        path,
        owner,
        ownerPath: flags.path,
      });
      stdout.write(
        formatObservation(value, !!flags.json, [
          `source ${value.address.source}/${value.address.path}`,
          `destination ${value.owner}/${value.ownerPath}`,
          `proof ${value.proof}`,
          `allowed ${value.allowed}`,
          `scope ${value.scope}`,
          ...value.directMemberships.map(
            (item) => `membership ${item.collection}:${item.name} ${item.owner.file}`,
          ),
          ...value.blockers.map(
            (item) => `blocker ${item.reason}${item.owner ? ` ${item.owner.file}` : ""}`,
          ),
          `limitation ${value.limitation}`,
        ]),
      );
    });
  rebind
    .command("apply <review-file>")
    .description("Apply a saved JSON rebind review after Core revalidates it.")
    .action(async (file, _flags, action) => {
      let review: unknown;
      try {
        review = JSON.parse(await readFile(resolve(cwd, file), "utf8"));
      } catch {
        throw new SkctlError("INVALID_ARGUMENT", `Cannot read a valid JSON rebind review: ${file}`);
      }
      const validation = rebindImpactSchema["~standard"].validate(review);
      if (validation instanceof Promise || validation.issues)
        throw new SkctlError("INVALID_ARGUMENT", "Invalid rebind review");
      const impact = review as RebindImpact;
      await api.rebindSkill(environment(action), {
        source: impact.address.source,
        path: impact.address.path,
        owner: impact.owner,
        ownerPath: impact.ownerPath,
        reviewedImpact: impact,
      });
      const repaired = impact.directMemberships.filter(
        (item) => !sameSkillAddress(item.before, item.after),
      ).length;
      const unchanged = sameSkillAddress(impact.address, {
        source: impact.owner,
        path: impact.ownerPath,
      });
      const result = unchanged
        ? `Skill "${impact.address.path}" remains at the same source address "${impact.address.source}"`
        : `Rebound skill "${impact.address.path}" from source "${impact.address.source}" to "${impact.owner}"`;
      stdout.write(
        `${result}; repaired ${repaired} direct memberships.\nScope: ${impact.scope}. ${impact.limitation}\n`,
      );
    });
  return rebind;
}
