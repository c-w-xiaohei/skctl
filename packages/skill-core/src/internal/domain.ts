import { readdir, lstat, readFile } from "node:fs/promises";
import { basename, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { isAlias, isMap, parseDocument, visit } from "yaml";
import { SkillCliError, type Diagnostic } from "../api";

export { SkillCliError } from "../api";
export const textLimit = 1_048_576;
/** A bounded provider read can report real size without returning an oversized buffer. */
export class SourceContentLimitError extends SkillCliError {
  constructor(readonly byteLength: number) {
    super("TEXT_TOO_LARGE", "Source content exceeds the requested read limit");
  }
}
export function assertSourceContentLimit(byteLength: number, maxBytes?: number) {
  if (maxBytes !== undefined && byteLength > maxBytes)
    throw new SourceContentLimitError(byteLength);
}
const fail = (code: SkillCliError["code"], message: string): never => {
  throw new SkillCliError(code, message);
};
export function parseNameSegment(value: string, normalizeNfc = true): string {
  const n = value.normalize("NFC");
  if (
    (!normalizeNfc && n !== value) ||
    Buffer.byteLength(n) > 128 ||
    n.length === 0 ||
    n === "." ||
    n === ".." ||
    [...n].some(
      (character) =>
        /\s/u.test(character) ||
        character.codePointAt(0)! < 32 ||
        character.codePointAt(0) === 127 ||
        ":\\/#".includes(character),
    )
  )
    return fail("INVALID_ARGUMENT", "Invalid Name Segment");
  return n;
}
export function parseQualifiedName(value: string): string {
  const segments = value.split("/");
  if (segments.length === 0 || segments.some((segment) => !segment))
    return fail("INVALID_ARGUMENT", "Invalid qualified name");
  return segments.map((segment) => parseNameSegment(segment)).join("/");
}
export function parseSelector(value: string): { source: string; skill: string } {
  if ((value.match(/:/g) ?? []).length !== 1)
    return fail("INVALID_ARGUMENT", "Invalid Skill Selector");
  const [source, skill] = value.split(":");
  return { source: parseQualifiedName(source!), skill: parseNameSegment(skill!) };
}
export function parseResourcePath(value: string): string {
  if (
    !value ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    return fail("INVALID_RESOURCE_PATH", "Invalid resource path");
  return value;
}
export interface SourceBinding {
  readonly kind: "local" | "git" | "github";
  readonly origin: string;
  readonly root: string;
  readonly path?: string;
  readonly ref?: string;
}
/** Identity of the full Origin-relative Skill Root at its adopted SHA-1 commit. */
export interface GitTreeIdentity {
  readonly objectFormat: "sha1";
  readonly objectId: string;
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
export function bindingDigest(binding: SourceBinding): string {
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
export function parseSkillAddress(
  value: string,
  sourceIds: readonly string[],
): {
  source: string;
  path: string;
} {
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
export function decodeStrictText(bytes: Uint8Array): string {
  if (bytes.byteLength > textLimit) return fail("TEXT_TOO_LARGE", "Text exceeds 1048576 bytes");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return fail("INVALID_UTF8", "Text is not valid UTF-8");
  }
}
export interface DiscoveredSkill {
  readonly root: string;
  readonly relativeRoot: string;
  readonly name: string;
  readonly description: string;
}
export function parseSkillFrontmatter(header: string): Record<string, unknown> {
  const document = parseDocument(header, { uniqueKeys: true });
  if (document.errors.length || !isMap(document.contents))
    throw new SkillCliError("CONFIG_INVALID", "SKILL.md frontmatter is invalid");
  // Inspect YAML syntax, not punctuation inside scalar text or comments. Reject
  // aliases before toJS can expand them; anchors and explicit tags remain disallowed.
  visit(document, {
    Node(_key, node) {
      if (isAlias(node) || node.anchor || node.tag)
        throw new SkillCliError(
          "CONFIG_INVALID",
          "SKILL.md frontmatter cannot use YAML aliases, anchors or tags",
        );
    },
  });
  return document.toJS({ maxAliasCount: 0 });
}
export function parseSkillMetadata(text: string): { name: string; description: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
  if (!match) throw new SkillCliError("CONFIG_INVALID", "SKILL.md frontmatter is invalid");
  const data = parseSkillFrontmatter(match[1]!);
  if (typeof data.name !== "string" || !data.name.trim())
    throw new SkillCliError("CONFIG_INVALID", "SKILL.md name must be a non-empty string");
  if (typeof data.description !== "string" || !data.description.trim())
    throw new SkillCliError("CONFIG_INVALID", "SKILL.md description must be a non-empty string");
  return { name: parseNameSegment(data.name.trim()), description: data.description.trim() };
}
export async function discoverLocalSkills(
  root: string,
): Promise<{ skills: readonly DiscoveredSkill[]; diagnostics: readonly Diagnostic[] }> {
  const skills: DiscoveredSkill[] = [];
  const diagnostics: Diagnostic[] = [];
  const names = new Set<string>();
  async function walk(directory: string): Promise<void> {
    const skillFile = resolve(directory, "SKILL.md");
    try {
      const stat = await lstat(skillFile);
      if (stat.isFile() && !stat.isSymbolicLink()) {
        try {
          const text = decodeStrictText(await readFile(skillFile));
          const { name, description } = parseSkillMetadata(text);
          if (names.has(name)) fail("DUPLICATE_SKILL_NAME", `Duplicate Skill name: ${name}`);
          names.add(name);
          skills.push({
            root: directory,
            relativeRoot: relative(root, directory).split(sep).join("/"),
            name,
            description,
          });
        } catch (error) {
          if (error instanceof SkillCliError && error.code === "DUPLICATE_SKILL_NAME") throw error;
          diagnostics.push({
            code: "SKILL_FRONTMATTER_INVALID",
            severity: "warning",
            message: "Malformed SKILL.md",
            location: { file: skillFile },
          });
        }
        return;
      }
    } catch (error) {
      if (error instanceof SkillCliError) throw error;
    }
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name))))
      if (entry.isDirectory() && !entry.isSymbolicLink())
        await walk(resolve(directory, entry.name));
  }
  await walk(root);
  return { skills, diagnostics };
}
export const isWithin = (root: string, candidate: string) => {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
};
export const fileBase = (path: string) => basename(path);
