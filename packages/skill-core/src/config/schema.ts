import { Type, type Static } from "@sinclair/typebox";
import { sourceBindingSchema } from "../source/schema";
import { collectionSchema } from "../collection/schema";
export const schemaId = "https://skill-cli.dev/schema.json";
const declarationProperties = {
  sources: Type.Optional(Type.Record(Type.String(), sourceBindingSchema)),
  collections: Type.Optional(Type.Record(Type.String(), collectionSchema)),
};
const hostProperties = {
  $schema: Type.Optional(Type.Literal(schemaId)),
  agents: Type.Optional(
    Type.Object({ opencode: Type.Literal("managed") }, { additionalProperties: false }),
  ),
  configSources: Type.Optional(Type.Record(Type.String(), sourceBindingSchema)),
  ...declarationProperties,
  use: Type.Optional(Type.Array(Type.String())),
};
export const reusableConfigSchema = Type.Object(declarationProperties, {
  additionalProperties: false,
});
export const userConfigSchema = Type.Object(
  {
    ...hostProperties,
    network: Type.Optional(
      Type.Object(
        {
          proxy: Type.Optional(Type.String({ minLength: 1, format: "http-proxy-url" })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export const projectConfigSchema = Type.Object(hostProperties, { additionalProperties: false });
export const persistedConfigSchema = {
  $id: schemaId,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $comment:
    "Only the user/global file may contain network. Runtime selects the schema by owner scope; the editor root accepts any document form.",
  anyOf: ["userConfig", "projectConfig", "localConfig", "reusableConfig"].map((name) => ({
    $ref: `#/$defs/${name}`,
  })),
  $defs: {
    userConfig: userConfigSchema,
    projectConfig: projectConfigSchema,
    localConfig: projectConfigSchema,
    reusableConfig: reusableConfigSchema,
  },
};
export type ConfigDocument = Static<typeof userConfigSchema>;
export type ReusableConfigDocument = Static<typeof reusableConfigSchema>;
