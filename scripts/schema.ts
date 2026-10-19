import { schemaJson } from "../packages/skill-core/src/config/document";

const path = "packages/skill-core/schema/skctl.schema.json";
const mode = process.argv[2];

if (mode === "write") {
  await Bun.write(path, schemaJson);
} else if (mode === "check") {
  const actual = await Bun.file(path).text();
  if (actual !== schemaJson) {
    throw new Error(`${path} does not match the TypeBox source; run bun run schema:write`);
  }
} else {
  throw new Error("usage: bun scripts/schema.ts <write|check>");
}
