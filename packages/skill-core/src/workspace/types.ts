import type * as v from "valibot";
import type * as schema from "./domain.schema";

export type ConfigFileView = Readonly<v.InferOutput<typeof schema.configFileViewSchema>>;
export type ConfigLevelView = Readonly<v.InferOutput<typeof schema.configLevelViewSchema>>;
export type InstalledSkillSelectorViews = Readonly<
  v.InferOutput<typeof schema.installedSkillSelectorViewsSchema>
>;
export type WorkspaceView = Readonly<v.InferOutput<typeof schema.workspaceViewSchema>>;
