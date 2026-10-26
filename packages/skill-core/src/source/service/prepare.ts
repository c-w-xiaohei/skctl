import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SkctlError } from "../../shared";
import { gitTreeIdentitySchema } from "../schema";
import { skillMetadataSchema } from "../../content/domain.schema";
import * as v from "valibot";
import type { RepositoryReader } from "./remote/types";
import { skillTree, joinSourcePath, listFiles, skillMetadata } from "./skills";

const content = {
  ...skillMetadataSchema.entries,
  path: v.string(),
  directory: v.string(),
};
export const preparedSkillSchema = v.variant("kind", [
  v.object({ ...content, kind: v.literal("local") }),
  v.object({
    ...content,
    kind: v.literal("remote"),
    snapshotId: v.string(),
    tree: gitTreeIdentitySchema,
    revision: v.string(),
  }),
]);
export type PreparedSkill = Readonly<v.InferOutput<typeof preparedSkillSchema>>;

export async function prepareRemote(
  reader: RepositoryReader,
  boundary: string | undefined,
  paths: readonly string[],
  stage: string,
) {
  const plans = [];
  for (const [index, path] of paths.entries()) {
    const tree = await skillTree(reader, boundary, path);
    if (!tree) throw new SkctlError("SKILL_NOT_FOUND", `Skill Root is unavailable: ${path}`);
    const files = await listFiles(reader, tree);
    if (files.some((entry) => !["100644", "100755"].includes(entry.mode)))
      throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Skill Root contains an unsafe entry");
    plans.push({ path, tree, directory: join(stage, String(index)), files });
  }
  const bytes = await reader.blobs(plans.flatMap((plan) => plan.files.map((entry) => entry.oid)));
  const prepared: PreparedSkill[] = [];
  for (const plan of plans) {
    for (const entry of plan.files) {
      const target = join(plan.directory, ...entry.path.split("/"));
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, bytes.get(entry.oid)!, {
        mode: entry.mode === "100755" ? 0o700 : 0o600,
      });
      if (entry.mode === "100755") await chmod(target, 0o700);
    }
    const marker = plan.files.find((entry) => entry.path === "SKILL.md")!;
    let metadata;
    try {
      metadata = skillMetadata(bytes.get(marker.oid)!);
    } catch (error) {
      throw new SkctlError(
        "CONFIG_INVALID",
        `Invalid SKILL.md at ${joinSourcePath(plan.path, "SKILL.md")}`,
        [
          {
            code: "SOURCE_METADATA_REJECTED",
            severity: "warning",
            message: "Prepared Skill metadata is invalid.",
            location: { file: joinSourcePath(plan.path, "SKILL.md") },
          },
        ],
        { cause: error },
      );
    }
    prepared.push({
      kind: "remote",
      path: plan.path,
      directory: plan.directory,
      snapshotId: crypto.randomUUID(),
      ...metadata,
      revision: reader.version.commit,
      tree: { objectFormat: "sha1", objectId: plan.tree },
    });
  }
  return prepared;
}
