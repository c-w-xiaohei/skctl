import { join } from "node:path";
import { editJson, object, same, toml } from "./documents";
import { configHome, configRoot, type Capture } from "./context";
import type { FileSnapshot } from "./files";
import {
  IntegrationError,
  diagnostic,
  type IntegrationEntry,
  type IntegrationTarget,
} from "./schema";

const legacyHandler = {
  type: "command",
  command: "skctl agent browse",
  timeout: 30,
  statusMessage: "skctl: loading Skill catalog",
};
const handler = { ...legacyHandler, additionalContextLimit: 0 };
export const hookGroups = {
  SessionStart: { matcher: "^(startup|resume|clear|compact|fork)$", hooks: [handler] },
  SubagentStart: { hooks: [handler] },
} as const;
const events = ["SessionStart", "SubagentStart"] as const;
type Event = (typeof events)[number];
function json(text: string, file: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text.trim() ? text : "{}");
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return object(value);
  } catch {
    throw new IntegrationError(
      "INVALID_HOST_CONFIG",
      "Codex hooks.json requires a strict JSON object",
      file,
    );
  }
}
function owned(group: unknown, event: Event): boolean {
  return (
    same(group, hookGroups[event]) || same(group, { ...hookGroups[event], hooks: [legacyHandler] })
  );
}
function mentions(value: unknown): boolean {
  if (typeof value === "string")
    return value.includes("skctl agent browse") || value.startsWith("skctl:");
  if (Array.isArray(value)) return value.some(mentions);
  return Object.values(object(value)).some(mentions);
}
export function hookStatus(value: Record<string, unknown>): IntegrationEntry["status"] | undefined {
  const hooks = object(value.hooks);
  let count = 0;
  let outdated = false;
  let modified = false;
  for (const event of Object.keys(hooks)) {
    if (event === "state") continue;
    const groups = hooks[event];
    if (!Array.isArray(groups)) {
      if (mentions(groups)) modified = true;
      continue;
    }
    let matched = 0;
    for (const group of groups) {
      if (!mentions(group)) continue;
      if (events.includes(event as Event) && owned(group, event as Event)) {
        matched++;
        if (!same(group, hookGroups[event as Event])) outdated = true;
      } else modified = true;
    }
    if (matched > 1) return "conflict";
    count += matched;
  }
  return modified
    ? "modified"
    : count === 2 && !outdated
      ? "current"
      : count
        ? "outdated"
        : undefined;
}

export function editHooks(snapshot: FileSnapshot, remove: boolean): string {
  const isToml = snapshot.file.endsWith(".toml");
  const parsed = isToml ? toml(snapshot.text, snapshot.file) : undefined;
  const value = parsed?.value ?? json(snapshot.text, snapshot.file);
  const status = hookStatus(value);
  if (status === "modified" || status === "conflict")
    throw new IntegrationError(
      "ENTRY_MODIFIED",
      "Hook definition is modified or duplicated; inspect it before editing",
      snapshot.file,
    );
  if (remove && !status) return snapshot.text;
  const hooks = object(value.hooks);
  if (!isToml) {
    let text = snapshot.text;
    for (const event of events) {
      const groups = hooks[event];
      if (groups !== undefined && !Array.isArray(groups))
        throw new IntegrationError(
          "INVALID_HOST_CONFIG",
          "Expected hook matcher groups",
          snapshot.file,
        );
      const list = Array.isArray(groups) ? groups : [];
      if (remove) {
        for (let i = list.length - 1; i >= 0; i--)
          if (owned(list[i], event)) text = editJson(text, ["hooks", event, i], undefined);
      } else if (!list.some((item) => same(item, hookGroups[event]))) {
        const index = list.findIndex((item) => owned(item, event));
        text =
          index >= 0
            ? editJson(text, ["hooks", event, index], hookGroups[event])
            : editJson(text, ["hooks", event], [...list, hookGroups[event]]);
      }
    }
    json(text, snapshot.file);
    return text;
  }
  const ranges: [number, number][] = [];
  for (const event of events) {
    const list = hooks[event];
    if (!Array.isArray(list)) continue;
    for (let index = 0; index < list.length; index++) {
      if (!owned(list[index], event)) continue;
      const tables = parsed!.ast.body[0].body.filter(
        (node) =>
          node.type === "TOMLTable" &&
          node.resolvedKey[0] === "hooks" &&
          node.resolvedKey[1] === event &&
          node.resolvedKey[2] === index,
      );
      if (!tables.length)
        throw new IntegrationError(
          "UNSUPPORTED_TOML_EDIT",
          "Expand the managed hook into array tables before editing",
          snapshot.file,
        );
      if (remove || !same(list[index], hookGroups[event]))
        for (const table of tables) ranges.push(table.range);
    }
  }
  let text = snapshot.text;
  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0]))
    text = text.slice(0, start) + text.slice(end);
  if (!remove) {
    for (const event of events) {
      const list = hooks[event];
      if (Array.isArray(list) && list.some((item) => same(item, hookGroups[event]))) continue;
      const group = hookGroups[event];
      text =
        text.trimEnd() +
        `\n\n[[hooks.${event}]]\n` +
        ("matcher" in group ? `matcher = ${JSON.stringify(group.matcher)}\n` : "") +
        `[[hooks.${event}.hooks]]\n` +
        Object.entries(handler)
          .map(([k, v]) => `${k} = ${JSON.stringify(v)}\n`)
          .join("");
    }
  }
  if (snapshot.text.includes("\r\n")) text = text.replace(/(?<!\r)\n/g, "\r\n");
  const result = toml(text, snapshot.file).value;
  if (remove ? hookStatus(result) !== undefined : hookStatus(result) !== "current")
    throw new IntegrationError(
      "UNSUPPORTED_TOML_EDIT",
      "Cannot edit this hook layout without changing other entries",
      snapshot.file,
    );
  return text;
}

export async function scanCodex(target: IntegrationTarget, capture: Capture) {
  const root = configRoot(target);
  const entries: IntegrationEntry[] = [];
  const nextSteps = [
    "Review new or changed hook definitions in Codex /hooks. Project hooks also require a trusted project.",
  ];
  const local: FileSnapshot[] = [];
  let selected: string | undefined;
  const roots = target.scope.kind === "project" ? [configHome(target), root] : [root];
  for (const directory of new Set(roots)) {
    let hasJson = false;
    let hasInline = false;
    for (const name of ["hooks.json", "config.toml"]) {
      const snapshot = await capture.read(join(directory, name));
      if (!snapshot) continue;
      if (directory === root) local.push(snapshot);
      try {
        const value = name.endsWith("toml")
          ? toml(snapshot.text, snapshot.file).value
          : json(snapshot.text, snapshot.file);
        const hooks = object(value.hooks);
        const hasHooks = Object.entries(hooks).some(([event, groups]) => {
          if (event === "state") return false;
          if (!Array.isArray(groups)) return true;
          return groups.some((group) => {
            const handlers = object(group).hooks;
            return !Array.isArray(handlers) || handlers.length > 0;
          });
        });
        if (name === "hooks.json") hasJson = hasHooks;
        else {
          hasInline = hasHooks;
          if (
            object(value.features).hooks === false ||
            object(value.features).codex_hooks === false
          )
            capture.diagnostics.push({
              code: "HOOKS_DISABLED",
              message: "Codex hooks are disabled in this configuration",
              file: snapshot.file,
            });
        }
        if (directory === root && hasHooks) selected = snapshot.file;
        const status = hookStatus(value);
        if (status)
          entries.push({
            mechanism: "codex-hooks",
            file: snapshot.file,
            status,
            inherited: directory !== root,
            selected: "unknown",
          });
      } catch (error) {
        capture.failed.add(snapshot.file);
        capture.diagnostics.push(diagnostic(error));
      }
    }
    if (hasJson && hasInline)
      capture.diagnostics.push({
        code: "MULTIPLE_HOOK_SOURCES",
        message:
          "Both hooks.json and inline hooks are loaded; select the existing source explicitly",
        file: directory,
      });
  }
  return {
    entries,
    nextSteps,
    candidates: local.map((item) => item.file),
    selected: selected ?? join(root, "hooks.json"),
    root,
  };
}
