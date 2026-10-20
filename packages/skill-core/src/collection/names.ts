import * as v from "valibot";
import { nameSegmentSchema, qualifiedNameSchema } from "./schema";
import { SkctlError } from "../shared";

export function parseNameSegment(value: string, normalizeNfc = true): string {
  const result = v.safeParse(nameSegmentSchema, value);
  if (!result.success || (!normalizeNfc && result.output !== value))
    throw new SkctlError("INVALID_ARGUMENT", "Invalid Name Segment");
  return result.output;
}
export function parseQualifiedName(value: string): string {
  const result = v.safeParse(qualifiedNameSchema, value);
  if (!result.success) throw new SkctlError("INVALID_ARGUMENT", "Invalid qualified name");
  return result.output;
}
const selectorSchema = v.pipe(
  v.string(),
  v.transform((value) => value.split(":")),
  v.strictTuple([qualifiedNameSchema, nameSegmentSchema]),
  v.transform(([source, skill]) => ({ source, skill })),
);
export function parseSelector(value: string): v.InferOutput<typeof selectorSchema> {
  const result = v.safeParse(selectorSchema, value);
  if (!result.success) throw new SkctlError("INVALID_ARGUMENT", "Invalid Skill Selector");
  return result.output;
}
