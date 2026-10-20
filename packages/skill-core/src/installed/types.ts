import type * as v from "valibot";
import type * as schema from "./domain.schema";
import type { SourceFileChange } from "../source/types";

export type UninstallImpact = Readonly<v.InferOutput<typeof schema.uninstallImpactSchema>>;
export type RebindImpact = Readonly<v.InferOutput<typeof schema.rebindImpactSchema>>;
export type UpdateObservation = Readonly<v.InferOutput<typeof schema.updateObservationSchema>>;
export type UpdateFileChange = SourceFileChange;
export type UpdatePreview = Readonly<v.InferOutput<typeof schema.updatePreviewSchema>>;
export type RebindRequest = Readonly<v.InferOutput<typeof schema.rebindRequestSchema>>;
export type InstalledSelection = Readonly<v.InferOutput<typeof schema.installedSelectionSchema>>;
export type InstallRequest = Readonly<v.InferOutput<typeof schema.installRequestSchema>>;
export type UpdateRequest = Readonly<v.InferOutput<typeof schema.updateRequestSchema>>;
