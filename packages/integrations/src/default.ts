import { Lexer } from "marked";
import { dirname, join } from "node:path";
import { configHome, type Capture } from "./context";
import { toml } from "./documents";
import { IntegrationError, type IntegrationEntry, type IntegrationTarget } from "./schema";

export const bootstrap = `<!-- skctl:begin v1 -->
## Skills via skctl

Use \`skctl\` to discover and load installed Skills.
Before planning or working on a task, run \`skctl agent browse\` in the
current project directory unless its current root catalog is already
available in this context. Follow the returned guidance and load relevant
Skills as needed.
Refresh the catalog after switching projects, when it is missing after
compaction, or when configuration or installed content has changed.
If the catalog is unavailable, report that fact and continue without
inventing Skills or changing their installation.
<!-- skctl:end -->
`;
function markers(text: string) {
  const positions: number[] = [];
  let normalized = "";
  for (let i = 0; i < text.length; i++) {
    positions.push(i);
    if (text[i] === "\r") {
      normalized += "\n";
      if (text[i + 1] === "\n") i++;
    } else normalized += text[i];
  }
  positions.push(text.length);
  let offset = 0;
  const found: { start: number; end: number; text: string }[] = [];
  for (const token of Lexer.lex(normalized)) {
    if (token.type === "html" && /^<!-- skctl:(?:begin|end)\b/.test(token.raw))
      found.push({
        start: positions[offset]!,
        end: positions[offset + token.raw.trimEnd().length]!,
        text: token.raw.trim(),
      });
    offset += token.raw.length;
  }
  return found;
}
export function instructionBlock(text: string): {
  status?: IntegrationEntry["status"];
  start?: number;
  end?: number;
} {
  const found = markers(text);
  if (!found.length) return {};
  if (
    found.length !== 2 ||
    !found[0]!.text.startsWith("<!-- skctl:begin") ||
    found[1]!.text !== "<!-- skctl:end -->"
  )
    return { status: "conflict" };
  const start = found[0]!.start;
  const markerEnd = found[1]!.end;
  const end =
    markerEnd + (text.slice(markerEnd).startsWith("\r\n") ? 2 : text[markerEnd] === "\n" ? 1 : 0);
  return {
    status:
      text.slice(start, end).replaceAll("\r\n", "\n").trimEnd() === bootstrap.trimEnd()
        ? "current"
        : "modified",
    start,
    end,
  };
}
export function editInstructions(text: string, remove: boolean): string {
  const block = instructionBlock(text);
  if (block.status && block.status !== "current")
    throw new IntegrationError(
      "ENTRY_MODIFIED",
      "Instruction markers are modified, unsupported or ambiguous",
    );
  if (block.status) return remove ? text.slice(0, block.start) + text.slice(block.end) : text;
  if (remove) return text;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const separator = !text || text.endsWith(eol + eol) ? "" : text.endsWith(eol) ? eol : eol + eol;
  const next = text + separator + bootstrap.replaceAll("\n", eol);
  if (instructionBlock(next).status !== "current")
    throw new IntegrationError(
      "INVALID_INSERTION_CONTEXT",
      "Cannot append guidance inside an unclosed Markdown container",
    );
  return next;
}
export async function scanDefault(target: IntegrationTarget, reads: Capture) {
  const root = target.scope.kind === "global" ? configHome(target) : target.scope.directory;
  const candidates: string[] = [];
  const entries: IntegrationEntry[] = [];
  let selected = join(root, "AGENTS.md");
  const home = configHome(target);
  const roots = target.scope.kind === "project" ? [home, root] : [root];
  for (const directory of new Set(roots)) {
    const names =
      target.environment.harness === "codex" ? ["AGENTS.override.md", "AGENTS.md"] : ["AGENTS.md"];
    if (
      target.environment.harness === "codex" &&
      directory === root &&
      target.scope.kind === "project"
    ) {
      let fallbackNames: string[] = [];
      for (const file of [join(home, "config.toml"), join(root, ".codex/config.toml")]) {
        const snapshot = await reads.read(file);
        if (!snapshot) continue;
        try {
          const fallback = toml(snapshot.text, file).value.project_doc_fallback_filenames;
          if (Array.isArray(fallback))
            fallbackNames = fallback.filter(
              (name): name is string =>
                typeof name === "string" &&
                !!name &&
                name !== "." &&
                name !== ".." &&
                !/[\\/]/.test(name),
            );
        } catch {
          /* The host adapter inspection reports invalid configuration. */
        }
      }
      names.push(...fallbackNames);
    }
    let preferred: string | undefined;
    for (const name of new Set(names)) {
      const file = join(directory, name);
      if (directory === root) candidates.push(file);
      const snapshot = await reads.read(file);
      if (!snapshot) continue;
      if (!preferred && snapshot.text.trim()) preferred = file;
      const block = instructionBlock(snapshot.text);
      if (block.status)
        entries.push({
          mechanism: "default",
          file,
          status: block.status,
          inherited: directory !== root,
          selected: "unknown",
        });
    }
    for (const entry of entries.filter((e) => dirname(e.file) === directory))
      entry.selected = entry.file === preferred ? "selected" : "shadowed";
    if (directory === root && preferred) selected = preferred;
  }
  return { root, selected, candidates, entries };
}
