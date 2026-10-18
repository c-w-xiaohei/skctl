import { isAbsolute, resolve } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import Ajv2020 from "ajv/dist/2020";
import { gitObjectIdSchema, gitTreeIdentitySchema } from "../source/schema";

const ajv = new Ajv2020({ strict: true });
ajv.addFormat(
  "state-name",
  (value: string) => value.length > 0 && value.normalize("NFC") === value,
);
ajv.addFormat(
  "state-path",
  (value: string) =>
    value.length > 0 &&
    value.normalize("NFC") === value &&
    !value.includes("\0") &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !value.split("/").some((part) => !part || part === "." || part === ".."),
);
ajv.addFormat(
  "absolute-normalized-path",
  (value: string) => isAbsolute(value) && resolve(value) === value,
);

const name = Type.String({ format: "state-name" });
const path = Type.String({ format: "state-path" });
const rootPath = Type.Union([path, Type.Literal("")]);
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const strict = { additionalProperties: false } as const;
const unavailable = Type.Object({ status: Type.Literal("unavailable") }, strict);
const knownIdentity = Type.Object(
  {
    status: Type.Literal("known"),
    canonicalOrigin: name,
    originRelativeSkillRoot: rootPath,
  },
  strict,
);
const identity = Type.Union([unavailable, knownIdentity]);
const legacyIdentity = Type.Union([
  unavailable,
  Type.Object({ ...knownIdentity.properties, originRelativeSkillRoot: path }, strict),
]);

const common = {
  source: name,
  path,
  name,
  description: name,
  digest,
  bindingDigest: digest,
};
const local = {
  kind: Type.Literal("local"),
  root: Type.String({ format: "absolute-normalized-path" }),
};
const remote = { kind: Type.Literal("remote"), treeIdentity: Type.Optional(Type.Never()) };
const exact = { adoptedRevision: gitObjectIdSchema, revisionStatus: Type.Optional(Type.Never()) };
const unresolved = {
  revisionStatus: Type.Literal("unresolved"),
  adoptedRevision: Type.Optional(Type.Never()),
};
const v1 = Type.Union([
  Type.Object({ ...common, ...local, identityEvidence: Type.Optional(Type.Never()) }, strict),
  Type.Object(
    { ...common, ...remote, ...exact, identityEvidence: Type.Optional(Type.Never()) },
    strict,
  ),
]);
const v2Common = { ...common, identityEvidence: legacyIdentity };
const v2 = Type.Union([
  Type.Object({ ...v2Common, ...local }, strict),
  Type.Object({ ...v2Common, ...remote, ...exact }, strict),
  Type.Object({ ...v2Common, ...remote, ...unresolved }, strict),
]);
const v3Common = { ...common, path: rootPath, identityEvidence: identity };
const v3 = Type.Union([
  Type.Object({ ...v3Common, ...local }, strict),
  Type.Object({ ...v3Common, ...remote, ...exact }, strict),
  Type.Object({ ...v3Common, ...remote, ...unresolved }, strict),
  Type.Object(
    {
      ...v3Common,
      ...remote,
      ...exact,
      identityEvidence: knownIdentity,
      treeIdentity: gitTreeIdentitySchema,
    },
    strict,
  ),
]);
const configRecord = Type.Object({ commit: gitObjectIdSchema, digest }, strict);
const stateFields = {
  generation: Type.Integer({ minimum: 0 }),
  configs: Type.Record(Type.String(), configRecord, { propertyNames: name }),
};
const stateSchema = Type.Union([
  Type.Object({ ...stateFields, version: Type.Literal(1), installed: Type.Array(v1) }, strict),
  Type.Object({ ...stateFields, version: Type.Literal(2), installed: Type.Array(v2) }, strict),
  Type.Object({ ...stateFields, version: Type.Literal(3), installed: Type.Array(v3) }, strict),
]);

export type IdentityEvidence = Readonly<Static<typeof identity>>;
export type PrivateState = Readonly<Static<typeof stateSchema>>;
export type InstalledMaterialization = PrivateState["installed"][number];
export type StateContents = Readonly<Pick<PrivateState, "configs">> & {
  readonly installed: readonly InstalledMaterialization[];
};
export type RemoteInstalledMaterialization = Extract<InstalledMaterialization, { kind: "remote" }>;
export const validateState = ajv.compile<PrivateState>(stateSchema);
export const validateCurrentMaterialization = ajv.compile<Static<typeof v3>>(v3);
export const validateConfigIdentity = ajv.compile(
  Type.Object({ id: name, commit: gitObjectIdSchema }, strict),
);

const transactionTarget = Type.Object({
  target: Type.String(),
  stage: Type.String(),
  exists: Type.Boolean(),
  old: Type.Union([Type.Null(), digest]),
  next: digest,
});
const transactionSchema = Type.Object({
  status: Type.Union([Type.Literal("prepared"), Type.Literal("committed")]),
  targets: Type.Array(transactionTarget),
  state: Type.Optional(
    Type.Object({ target: Type.String(), expected: Type.Integer(), next: Type.Integer() }),
  ),
});
export type Transaction = Static<typeof transactionSchema>;
export type TransactionTarget = Transaction["targets"][number];
export const validateTransaction = ajv.compile<Transaction>(transactionSchema);

const processOwner = {
  pid: Type.Number(),
  nonce: Type.String(),
  startToken: Type.Optional(Type.String()),
};
const lockOwnerSchema = Type.Object({ ...processOwner, pid: Type.Integer({ minimum: 1 }) });
export type LockOwner = Static<typeof lockOwnerSchema>;
export const validateLockOwner = ajv.compile<LockOwner>(lockOwnerSchema);
const snapshotUseSchema = Type.Object({ ...processOwner, digest: Type.String() });
export type SnapshotUse = Static<typeof snapshotUseSchema>;
export const validateSnapshotUse = ajv.compile<SnapshotUse>(snapshotUseSchema);
const tombstoneOwnerSchema = Type.Object({ ...processOwner, startToken: Type.String() });
export const validateTombstoneOwner =
  ajv.compile<Static<typeof tombstoneOwnerSchema>>(tombstoneOwnerSchema);
