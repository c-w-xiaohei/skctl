import { parseNameSegment } from "../collection/names";

import { isAlias, isMap, parseDocument, visit } from "yaml";
import { SkctlError } from "../shared";

const fail = (code: SkctlError["code"], message: string): never => {
  throw new SkctlError(code, message);
};
export const textLimit = 1_048_576;
/** A bounded provider read can report real size without returning an oversized buffer. */

export class SourceContentLimitError extends SkctlError {
  constructor(readonly byteLength: number) {
    super("TEXT_TOO_LARGE", "Source content exceeds the requested read limit");
  }
}

export function assertSourceContentLimit(byteLength: number, maxBytes?: number) {
  if (maxBytes !== undefined && byteLength > maxBytes)
    throw new SourceContentLimitError(byteLength);
}

export function decodeStrictText(bytes: Uint8Array): string {
  if (bytes.byteLength > textLimit) return fail("TEXT_TOO_LARGE", "Text exceeds 1048576 bytes");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return fail("INVALID_UTF8", "Text is not valid UTF-8");
  }
}

export function parseSkillFrontmatter(header: string): Record<string, unknown> {
  const document = parseDocument(header, { uniqueKeys: true });
  if (document.errors.length || !isMap(document.contents))
    throw new SkctlError("CONFIG_INVALID", "SKILL.md frontmatter is invalid");
  // Inspect YAML syntax, not punctuation inside scalar text or comments. Reject
  // aliases before toJS can expand them; anchors and explicit tags remain disallowed.
  visit(document, {
    Node(_key, node) {
      if (isAlias(node) || node.anchor || node.tag)
        throw new SkctlError(
          "CONFIG_INVALID",
          "SKILL.md frontmatter cannot use YAML aliases, anchors or tags",
        );
    },
  });
  return document.toJS({ maxAliasCount: 0 });
}

export type SkillMetadata = Readonly<ReturnType<typeof parseSkillMetadata>>;

export function parseSkillMetadata(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
  if (!match) throw new SkctlError("CONFIG_INVALID", "SKILL.md frontmatter is invalid");
  const data = parseSkillFrontmatter(match[1]!);
  if (typeof data.name !== "string" || !data.name.trim())
    throw new SkctlError("CONFIG_INVALID", "SKILL.md name must be a non-empty string");
  if (typeof data.description !== "string" || !data.description.trim())
    throw new SkctlError("CONFIG_INVALID", "SKILL.md description must be a non-empty string");
  return { name: parseNameSegment(data.name.trim()), description: data.description.trim() };
}
