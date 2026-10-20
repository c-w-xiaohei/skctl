import * as v from "valibot";
import { isAbsolute, normalize, resolve } from "node:path";
export const sourceRootSchema = v.pipe(
  v.string(),
  v.check(
    (root) =>
      !isAbsolute(root) &&
      !root.includes("\\") &&
      !root.split("/").some((part) => part === "." || part === ".." || (!part && root !== "")),
    "Source Root must be a relative normalized path",
  ),
);
export const canonicalRemoteOriginSchema = v.pipe(
  v.string(),
  v.url(),
  v.transform((value) => new URL(value)),
  v.check(
    (url) =>
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      ["https:", "http:"].includes(url.protocol),
    "Remote origin must not contain credentials",
  ),
  v.transform((url) => {
    const path =
      url.pathname.length > 1 && url.pathname.endsWith("/")
        ? url.pathname.slice(0, -1)
        : url.pathname;
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${path}`;
  }),
);
export const canonicalLocalOriginSchema = v.pipe(
  v.object({
    value: v.pipe(
      v.string(),
      v.minLength(1),
      v.check((value) => !value.includes("\0")),
    ),
    base: v.string(),
  }),
  v.transform(({ value, base }) => normalize(isAbsolute(value) ? value : resolve(base, value))),
);
const remoteBinding = { origin: v.string(), root: v.string(), ref: v.string() };
export const sourceBindingSchema = v.variant("kind", [
  v.strictObject({ kind: v.literal("local"), path: v.string(), root: v.string() }),
  v.strictObject({ kind: v.literal("git"), ...remoteBinding }),
  v.strictObject({
    kind: v.literal("github"),
    owner: v.optional(v.string()),
    repository: v.optional(v.string()),
    ...remoteBinding,
  }),
]);
export const skillAddressSchema = v.strictObject({ source: v.string(), path: v.string() });

export type SourceBinding = Readonly<v.InferOutput<typeof sourceBindingSchema>>;
export type SkillAddress = Readonly<v.InferOutput<typeof skillAddressSchema>>;

export const gitObjectIdSchema = v.pipe(v.string(), v.regex(/^[a-f0-9]{40}$/));
export const gitTreeIdentitySchema = v.strictObject({
  objectFormat: v.literal("sha1"),
  objectId: gitObjectIdSchema,
});
export type GitTreeIdentity = Readonly<v.InferOutput<typeof gitTreeIdentitySchema>>;
