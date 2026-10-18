import { Type, type Static } from "@sinclair/typebox";
const remoteBinding = { origin: Type.String(), root: Type.String(), ref: Type.String() };
export const sourceBindingSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal("local"), path: Type.String(), root: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal("git"), ...remoteBinding }, { additionalProperties: false }),
  Type.Object(
    {
      kind: Type.Literal("github"),
      owner: Type.Optional(Type.String()),
      repository: Type.Optional(Type.String()),
      ...remoteBinding,
    },
    { additionalProperties: false },
  ),
]);
export const skillAddressSchema = Type.Object(
  { source: Type.String(), path: Type.String() },
  { additionalProperties: false },
);

export type SourceBinding = Readonly<Static<typeof sourceBindingSchema>>;
export type SkillAddress = Readonly<Static<typeof skillAddressSchema>>;

export const gitObjectIdSchema = Type.String({ pattern: "^[a-f0-9]{40}$" });
export const gitTreeIdentitySchema = Type.Object(
  { objectFormat: Type.Literal("sha1"), objectId: gitObjectIdSchema },
  { additionalProperties: false },
);
export type GitTreeIdentity = Readonly<Static<typeof gitTreeIdentitySchema>>;
