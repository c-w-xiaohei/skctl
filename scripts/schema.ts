import { toJsonSchema } from "@valibot/to-json-schema";
import { format } from "oxfmt";
import {
  userConfigSchema,
  projectConfigSchema,
  reusableConfigSchema,
  proxyOriginCheck,
  schemaId,
} from "../packages/skill-core/src/config/schema";

const definitions = {
  userConfig: userConfigSchema,
  projectConfig: projectConfigSchema,
  localConfig: projectConfigSchema,
  reusableConfig: reusableConfigSchema,
};
const persistedConfigSchema = {
  $id: schemaId,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $comment:
    "Only the user/global file may contain network. Runtime selects the schema by owner scope; the editor root accepts any document form. Custom proxy URL validation is represented by its format annotation.",
  anyOf: Object.keys(definitions).map((name) => ({ $ref: `#/$defs/${name}` })),
  $defs: Object.fromEntries(
    Object.entries(definitions).map(([name, schema]) => [
      name,
      toJsonSchema(schema, {
        target: "draft-2020-12",
        // Only this declared URL-origin check is runtime-only, not arbitrary checks.
        overrideAction: ({ valibotAction, jsonSchema }) =>
          valibotAction === proxyOriginCheck
            ? { ...jsonSchema, format: "http-proxy-url" }
            : undefined,
      }),
    ]),
  ),
};
const sort = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sort)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, sort(item)]),
        )
      : value;
const path = "packages/skill-core/schema/skctl.schema.json";
const formatted = await format(
  path,
  JSON.stringify(sort(persistedConfigSchema)),
  await Bun.file(new URL("../.oxfmtrc.json", import.meta.url)).json(),
);
if (formatted.errors.length) throw new Error("Cannot format generated Config schema");
export const schemaJson = formatted.code;

const mode = import.meta.main ? process.argv[2] : undefined;

if (mode === "write") {
  await Bun.write(path, schemaJson);
} else if (mode === "check") {
  const actual = await Bun.file(path).text();
  if (actual !== schemaJson) {
    throw new Error(`${path} does not match the Valibot source; run bun run schema:write`);
  }
} else if (import.meta.main) {
  throw new Error("usage: bun scripts/schema.ts <write|check>");
}
