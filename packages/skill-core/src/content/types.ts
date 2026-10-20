import type * as v from "valibot";
import type * as schema from "./domain.schema";

export type LoadSkillRequest = Readonly<v.InferOutput<typeof schema.loadSkillRequestSchema>>;
export type ReadResourceRequest = Readonly<v.InferOutput<typeof schema.readResourceRequestSchema>>;
export type DownloadResourceRequest = Readonly<
  v.InferOutput<typeof schema.downloadResourceRequestSchema>
>;
export type RunSkillRequest = Readonly<v.InferOutput<typeof schema.runSkillRequestSchema>>;
export type LoadedSkill = Readonly<v.InferOutput<typeof schema.loadedSkillSchema>>;
export type ResourceDescriptor = Readonly<v.InferOutput<typeof schema.resourceDescriptorSchema>>;
export type ReadResourceResult = Readonly<v.InferOutput<typeof schema.readResourceResultSchema>>;
export type DownloadResourceResult = Readonly<
  v.InferOutput<typeof schema.downloadResourceResultSchema>
>;
export type RunSkillResult = Readonly<v.InferOutput<typeof schema.runSkillResultSchema>>;
export type LoadedInstalledSkill = Readonly<
  v.InferOutput<typeof schema.loadedInstalledSkillSchema>
>;
export type InstalledResourceResult = Readonly<
  v.InferOutput<typeof schema.installedResourceResultSchema>
>;
