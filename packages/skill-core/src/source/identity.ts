import { SkctlError } from "../shared";
import type { SkillAddress, SourceBinding } from "./schema";
import { canonicalRemoteOriginSchema, canonicalLocalOriginSchema } from "./schema";
import * as v from "valibot";
import type { SourceBindingView } from "./types";

export interface InternalSourceBinding extends SourceBindingView {
  readonly bindingDigest: string;
}

const fail = (code: SkctlError["code"], message: string): never => {
  throw new SkctlError(code, message);
};
export interface CanonicalSourceBinding {
  readonly kind: SourceBinding["kind"];
  readonly origin: string;
  readonly root: string;
  readonly path?: string;
  readonly ref?: string;
}
export function canonicalRemoteOrigin(value: string): string {
  const result = v.safeParse(canonicalRemoteOriginSchema, value);
  if (!result.success) return fail("INVALID_ARGUMENT", "Invalid remote origin or credentials");
  return result.output;
}

export function canonicalLocalOrigin(value: string, base: string): string {
  const result = v.safeParse(canonicalLocalOriginSchema, { value, base });
  if (!result.success) return fail("INVALID_ARGUMENT", "Invalid local origin");
  return result.output;
}

export function bindingDigest(binding: CanonicalSourceBinding): string {
  return new Bun.CryptoHasher("sha256")
    .update(
      JSON.stringify({
        kind: binding.kind,
        origin: binding.origin,
        root: binding.root,
        ...(binding.path === undefined ? {} : { path: binding.path }),
        ...(binding.ref === undefined ? {} : { ref: binding.ref }),
      }),
    )
    .digest("hex");
}

export function parseSkillAddress(value: string, sourceIds: readonly string[]): SkillAddress {
  const source = [...sourceIds]
    .sort((left, right) => right.length - left.length)
    .find((id) => value.startsWith(`${id}/`));
  if (!source) return fail("INVALID_ARGUMENT", "Skill address must use a registered source ID");
  const path = value.slice(source.length + 1);
  if (
    path.startsWith("/") ||
    (path !== "" && path.split("/").some((part) => part === "." || part === ".." || !part))
  )
    return fail("INVALID_ARGUMENT", "Invalid Skill address path");
  return { source, path };
}
