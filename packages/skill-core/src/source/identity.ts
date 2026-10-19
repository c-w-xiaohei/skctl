import { isAbsolute, normalize, resolve } from "node:path";

import { SkctlError } from "../shared";
import type { SkillAddress, SourceBinding } from "./schema";
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
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("INVALID_ARGUMENT", "Invalid remote origin");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && url.protocol !== "http:")
  )
    return fail("INVALID_ARGUMENT", "Remote origin must not contain credentials");
  const port =
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
      ? ""
      : url.port;
  const path =
    url.pathname.length > 1 && url.pathname.endsWith("/")
      ? url.pathname.slice(0, -1)
      : url.pathname;
  return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}${port ? `:${port}` : ""}${path}${url.search}${url.hash}`;
}

export function canonicalLocalOrigin(value: string, base: string): string {
  if (!value || value.includes("\0")) return fail("INVALID_ARGUMENT", "Invalid local origin");
  return normalize(isAbsolute(value) ? value : resolve(base, value));
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
