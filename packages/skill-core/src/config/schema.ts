import * as v from "valibot";
import { sourceBindingSchema } from "../source/schema";
import { collectionSchema } from "../collection/schema";

export const schemaId = "https://skctl.dev/schema.json";
export const configLevelSchema = v.picklist(["global", "project", "local"]);
export const declarationProvenanceSchema = v.object({
  level: configLevelSchema,
  file: v.optional(v.string()),
  pointer: v.optional(v.string()),
  namespace: v.optional(v.string()),
});
// Recursive declaration ownership needs one annotated fixed point for TypeScript.
export type ConfigDeclarationOwner = Readonly<v.InferOutput<typeof declarationProvenanceSchema>> & {
  readonly file: string;
  readonly pointer: string;
  readonly contribution?: {
    readonly configSource: ConfigDeclarationOwner;
    readonly declaration: v.InferOutput<typeof declarationProvenanceSchema>;
  };
};
export const configDeclarationOwnerSchema: v.GenericSchema<ConfigDeclarationOwner> = v.object({
  ...declarationProvenanceSchema.entries,
  file: v.string(),
  pointer: v.string(),
  contribution: v.optional(
    v.object({
      configSource: v.lazy(() => configDeclarationOwnerSchema),
      declaration: declarationProvenanceSchema,
    }),
  ),
});
export const configSourceContributionRefSchema = v.object({
  configSource: configDeclarationOwnerSchema,
  declaration: declarationProvenanceSchema,
});
export const configWriteResultSchema = v.object({
  level: configLevelSchema,
  file: v.string(),
  changed: v.boolean(),
});
export const proxyOriginCheck = v.check((value: string) => {
  const literal = /^https?:\/\/([^/?#]+)\/?$/iu.exec(value);
  if (
    !literal ||
    literal[1]!.endsWith(":") ||
    // eslint-disable-next-line no-control-regex -- Proxy URLs must not contain control bytes.
    /\s|[\u0000-\u001f\u007f]/u.test(value) ||
    value.includes("\\")
  )
    return false;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !!url.hostname &&
      !value.includes("?") &&
      !value.includes("#") &&
      url.pathname === "/"
    );
  } catch {
    return false;
  }
}, "Expected an HTTP(S) proxy origin");
export const proxyUrlSchema = v.pipe(v.string(), v.minLength(1), proxyOriginCheck);
const declarationProperties = {
  sources: v.optional(v.record(v.string(), sourceBindingSchema)),
  collections: v.optional(v.record(v.string(), collectionSchema)),
};
const hostProperties = {
  $schema: v.optional(v.literal(schemaId)),
  agents: v.optional(v.strictObject({ opencode: v.literal("managed") })),
  configSources: v.optional(v.record(v.string(), sourceBindingSchema)),
  ...declarationProperties,
  use: v.optional(v.array(v.string())),
};
export const reusableConfigSchema = v.strictObject(declarationProperties);
export const projectConfigSchema = v.strictObject(hostProperties);
export const userConfigSchema = v.strictObject({
  ...hostProperties,
  network: v.optional(v.strictObject({ proxy: v.optional(proxyUrlSchema) })),
});
export const configSchemaFor = (scope: "global" | "project" | "local" | "reusable") =>
  scope === "global"
    ? userConfigSchema
    : scope === "reusable"
      ? reusableConfigSchema
      : projectConfigSchema;
export type ConfigDocument = v.InferOutput<typeof userConfigSchema>;
export type ReusableConfigDocument = v.InferOutput<typeof reusableConfigSchema>;
