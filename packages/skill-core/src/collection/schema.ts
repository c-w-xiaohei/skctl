import * as v from "valibot";
import { skillAddressSchema } from "../source/schema";
export const nameSegmentSchema = v.pipe(
  v.string(),
  v.normalize("NFC"),
  v.check(
    (value) =>
      !!value &&
      ![".", ".."].includes(value) &&
      Buffer.byteLength(value) <= 128 &&
      ![...value].some(
        (character) =>
          /\s/u.test(character) ||
          character.codePointAt(0)! < 32 ||
          character.codePointAt(0) === 127 ||
          ":\\/#".includes(character),
      ),
    "Invalid Name Segment",
  ),
);
export const qualifiedNameSchema = v.pipe(
  v.string(),
  v.transform((value) => value.split("/")),
  v.array(nameSegmentSchema),
  v.transform((segments) => segments.join("/")),
);
export const referenceSchema = v.strictObject({ collection: v.string(), description: v.string() });
export const collectionSchema = v.strictObject({
  description: v.optional(v.pipe(v.string(), v.minLength(1))),
  instructions: v.optional(v.string()),
  members: v.optional(v.record(v.string(), skillAddressSchema)),
  links: v.optional(v.array(v.string())),
  references: v.optional(v.record(v.string(), referenceSchema)),
});

export type CollectionDeclaration = Readonly<v.InferOutput<typeof collectionSchema>>;
export type CollectionReference = Readonly<v.InferOutput<typeof referenceSchema>>;
