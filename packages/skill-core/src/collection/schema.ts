import { Type, type Static } from "@sinclair/typebox";
import { skillAddressSchema } from "../source/schema";
export const referenceSchema = Type.Object(
  { collection: Type.String(), description: Type.String() },
  { additionalProperties: false },
);
export const collectionSchema = Type.Object(
  {
    description: Type.Optional(Type.String({ minLength: 1 })),
    members: Type.Optional(Type.Record(Type.String(), skillAddressSchema)),
    links: Type.Optional(Type.Array(Type.String())),
    references: Type.Optional(Type.Record(Type.String(), referenceSchema)),
  },
  { additionalProperties: false },
);

export type CollectionDeclaration = Readonly<Static<typeof collectionSchema>>;
export type CollectionReference = Readonly<Static<typeof referenceSchema>>;
