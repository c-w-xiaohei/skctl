import { isAbsolute, resolve } from "node:path";
import * as v from "valibot";
import { gitObjectIdSchema, gitTreeIdentitySchema } from "../source/schema";
import { processIdentitySchema } from "../runtime/process";

const name = v.pipe(
  v.string(),
  v.minLength(1),
  v.check((value) => value.normalize("NFC") === value),
);
const path = v.pipe(
  name,
  v.check(
    (value) =>
      !value.includes("\0") &&
      !value.includes("\\") &&
      !value.startsWith("/") &&
      !value.split("/").some((part) => !part || part === "." || part === ".."),
  ),
);
const rootPath = v.union([path, v.literal("")]);
export const digestSchema = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/));
const unavailable = v.strictObject({ status: v.literal("unavailable") });
const knownIdentity = v.strictObject({
  status: v.literal("known"),
  canonicalOrigin: name,
  originRelativeSkillRoot: rootPath,
});
const identity = v.variant("status", [unavailable, knownIdentity]);
const legacyIdentity = v.variant("status", [
  unavailable,
  v.strictObject({ ...knownIdentity.entries, originRelativeSkillRoot: path }),
]);
const common = {
  source: name,
  path,
  name,
  description: name,
  digest: digestSchema,
  bindingDigest: digestSchema,
};
const local = {
  kind: v.literal("local"),
  root: v.pipe(
    v.string(),
    v.check((value) => isAbsolute(value) && resolve(value) === value),
  ),
};
const remote = { kind: v.literal("remote"), treeIdentity: v.optional(v.never()) };
const exact = { adoptedRevision: gitObjectIdSchema, revisionStatus: v.optional(v.never()) };
const unresolved = {
  revisionStatus: v.literal("unresolved"),
  adoptedRevision: v.optional(v.never()),
};
const v1 = v.union([
  v.strictObject({ ...common, ...local, identityEvidence: v.optional(v.never()) }),
  v.strictObject({ ...common, ...remote, ...exact, identityEvidence: v.optional(v.never()) }),
]);
const v2Common = { ...common, identityEvidence: legacyIdentity };
const v2 = v.union([
  v.strictObject({ ...v2Common, ...local }),
  v.strictObject({ ...v2Common, ...remote, ...exact }),
  v.strictObject({ ...v2Common, ...remote, ...unresolved }),
]);
const v3Common = { ...common, path: rootPath, identityEvidence: identity };
export const materializationSchema = v.union([
  v.strictObject({ ...v3Common, ...local }),
  v.strictObject({ ...v3Common, ...remote, ...exact }),
  v.strictObject({ ...v3Common, ...remote, ...unresolved }),
  v.strictObject({
    ...v3Common,
    ...remote,
    ...exact,
    identityEvidence: knownIdentity,
    treeIdentity: gitTreeIdentitySchema,
  }),
]);
const configRecord = v.strictObject({ commit: gitObjectIdSchema, digest: digestSchema });
const stateFields = {
  generation: v.pipe(v.number(), v.integer(), v.minValue(0)),
  configs: v.record(name, configRecord),
};
export const stateSchema = v.variant("version", [
  v.strictObject({ ...stateFields, version: v.literal(1), installed: v.array(v1) }),
  v.strictObject({ ...stateFields, version: v.literal(2), installed: v.array(v2) }),
  v.strictObject({
    ...stateFields,
    version: v.literal(3),
    installed: v.array(materializationSchema),
  }),
]);
export type IdentityEvidence = Readonly<v.InferOutput<typeof identity>>;
export type PrivateState = Readonly<v.InferOutput<typeof stateSchema>>;
export type InstalledMaterialization = PrivateState["installed"][number];
export type StateContents = Readonly<Pick<PrivateState, "configs">> & {
  readonly installed: readonly InstalledMaterialization[];
};
export type RemoteInstalledMaterialization = Extract<InstalledMaterialization, { kind: "remote" }>;

const transactionTarget = v.looseObject({
  target: v.string(),
  stage: v.string(),
  exists: v.boolean(),
  old: v.nullable(digestSchema),
  next: digestSchema,
});
export const transactionSchema = v.looseObject({
  status: v.picklist(["prepared", "committed"]),
  targets: v.array(transactionTarget),
  state: v.optional(
    v.looseObject({
      target: v.string(),
      expected: v.pipe(v.number(), v.integer()),
      next: v.pipe(v.number(), v.integer()),
    }),
  ),
});
export type Transaction = v.InferOutput<typeof transactionSchema>;
export type TransactionTarget = Transaction["targets"][number];
const processOwner = { ...processIdentitySchema.entries, nonce: v.string() };
export const lockOwnerSchema = v.looseObject(processOwner);
export type LockOwner = v.InferOutput<typeof lockOwnerSchema>;
export const snapshotUseSchema = v.looseObject({ ...processOwner, digest: v.string() });
export type SnapshotUse = v.InferOutput<typeof snapshotUseSchema>;
export const tombstoneOwnerSchema = v.looseObject({ ...processOwner, startToken: v.string() });
