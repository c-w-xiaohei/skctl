import { readdir, lstat, readFile } from "node:fs/promises";
import { basename, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { parseDocument } from "yaml";
import { SkillCliError, type Diagnostic } from "../api";

export { SkillCliError } from "../api";
export const textLimit = 1_048_576;
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
    !path ||
    path.startsWith("/") ||
    path.split("/").some((part) => part === "." || part === ".." || !part)
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
          const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
          if (!match || /(^|\s)[*!&][^\s]*/u.test(match[1]!))
            throw new Error("invalid frontmatter");
          const document = parseDocument(match[1]!, { uniqueKeys: true });
          if (document.errors.length) throw new Error("invalid frontmatter");
          const data = document.toJS();
          if (
            !data ||
            Array.isArray(data) ||
            typeof data.name !== "string" ||
            !data.name ||
            typeof data.description !== "string" ||
            !data.description
          )
            throw new Error("invalid frontmatter");
          const name = parseNameSegment(data.name);
          if (names.has(name)) fail("DUPLICATE_SKILL_NAME", `Duplicate Skill name: ${name}`);
          names.add(name);
          skills.push({
            root: directory,
            relativeRoot: relative(root, directory).split(sep).join("/"),
            name,
            description: data.description,
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
