import * as v from "valibot";
import { skillAddressSchema } from "../source/schema";
import { skillProvenanceSchema } from "../source/domain.schema";
import { nameSegmentSchema } from "../collection/schema";

export const skillMetadataSchema = v.object({
  name: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1, "SKILL.md name must be a non-empty string"),
    nameSegmentSchema,
  ),
  description: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1, "SKILL.md description must be a non-empty string"),
  ),
});
export const resourcePathSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.check(
    (value) =>
      !value.includes("\\") &&
      !value.includes("\0") &&
      !value.startsWith("/") &&
      !value.split("/").some((part) => !part || part === "." || part === ".."),
    "Invalid resource path",
  ),
);
export const loadSkillRequestSchema = v.object({ selector: v.string() });
export const readResourceRequestSchema = v.object({
  ...loadSkillRequestSchema.entries,
  path: resourcePathSchema,
});
export const downloadResourceRequestSchema = v.object({
  ...readResourceRequestSchema.entries,
  output: v.string(),
  force: v.boolean(),
});
export const runSkillRequestSchema = v.object({
  ...loadSkillRequestSchema.entries,
  argv: v.pipe(v.tupleWithRest([v.string()], v.string()), v.readonly()),
});
export const loadedSkillSchema = v.object({
  ...loadSkillRequestSchema.entries,
  ...skillMetadataSchema.entries,
  path: v.literal("SKILL.md"),
  text: v.string(),
  provenance: skillProvenanceSchema,
});
export const resourceDescriptorSchema = v.object({
  path: v.string(),
  kind: v.picklist(["file", "symlink", "gitlink", "directory"]),
  size: v.optional(v.number()),
  executable: v.optional(v.boolean()),
  gitlinkCommit: v.optional(v.string()),
});
export const readResourceResultSchema = v.object({
  ...readResourceRequestSchema.entries,
  text: v.string(),
  provenance: skillProvenanceSchema,
});
export const downloadResourceResultSchema = v.object({
  ...readResourceRequestSchema.entries,
  output: v.string(),
  bytesWritten: v.number(),
  provenance: skillProvenanceSchema,
});
export const runSkillResultSchema = v.object({
  ...loadSkillRequestSchema.entries,
  exitCode: v.nullable(v.number()),
  signal: v.nullable(v.string()),
  cancelled: v.boolean(),
});
export const loadedInstalledSkillSchema = v.object({
  ...skillMetadataSchema.entries,
  address: skillAddressSchema,
  rawText: v.string(),
  markdownText: v.string(),
});
export const installedResourceResultSchema = v.variant("kind", [
  v.object({
    kind: v.literal("text"),
    path: v.string(),
    text: v.string(),
    format: v.picklist(["markdown", "text"]),
  }),
  v.object({
    kind: v.literal("not-text"),
    path: v.string(),
    reason: v.picklist(["binary", "too-large", "unsupported"]),
    metadata: resourceDescriptorSchema,
  }),
]);
