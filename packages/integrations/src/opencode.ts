import { readFile, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { configHome, configRoot, type Capture } from "./context";
import { json, editJson, object } from "./documents";
import { capture, digest, type FileSnapshot } from "./files";
import {
  diagnostic,
  IntegrationError,
  type IntegrationEntry,
  type IntegrationTarget,
} from "./schema";

declare const SKCTL_OPENCODE_ARTIFACT: string | undefined;
export async function pluginArtifact(): Promise<string> {
  if (typeof SKCTL_OPENCODE_ARTIFACT !== "undefined") return SKCTL_OPENCODE_ARTIFACT!;
  try {
    return await readFile(new URL("../../opencode-adapter/dist/index.js", import.meta.url), "utf8");
  } catch {
    throw new IntegrationError(
      "ADAPTER_ARTIFACT_MISSING",
      "OpenCode V2 adapter artifact is missing. Build the plugin before connecting.",
    );
  }
}
function packageRef(item: unknown): string | undefined {
  const value = typeof item === "string" ? item : object(item).package;
  return typeof value === "string" ? value : undefined;
}
function owned(ref: string) {
  return ref.includes(".skctl-adapters/opencode-v2/");
}
function known(ref: string) {
  return owned(ref) || /skill-cli-v2|skctl.*opencode|opencode-adapter/.test(ref);
}
function resolveRef(file: string, ref: string) {
  return ref.startsWith("file:") ? fileURLToPath(ref) : resolve(dirname(file), ref);
}
function validMetadata(snapshot: FileSnapshot): boolean {
  const value = json(snapshot.text, snapshot.file);
  return (
    snapshot.exists &&
    value.name === "@skctl/opencode-adapter" &&
    value.type === "module" &&
    value.exports === "./index.js"
  );
}

export async function scanOpenCode(target: IntegrationTarget, reads: Capture) {
  const root = configRoot(target);
  const homes =
    target.scope.kind === "project" ? [configHome(target), target.scope.directory, root] : [root];
  const candidates: string[] = [];
  const entries: IntegrationEntry[] = [];
  let selected: string | undefined;
  for (const home of new Set(homes)) {
    for (const name of ["opencode.json", "opencode.jsonc"]) {
      const file = join(home, name);
      const inherited = target.scope.kind === "project" && home === configHome(target);
      if (!inherited) candidates.push(file);
      const snapshot = await reads.read(file);
      if (!snapshot) continue;
      if (!inherited && snapshot.exists) selected = file;
      try {
        const value = json(snapshot.text, file);
        if (value.plugin !== undefined) {
          const competing =
            Array.isArray(value.plugin) &&
            value.plugin.some((item) => {
              const ref = packageRef(Array.isArray(item) ? item[0] : item);
              return ref && known(ref);
            });
          reads.diagnostics.push({
            code: competing ? "LEGACY_PLUGIN_CONFIG" : "LEGACY_PLUGIN_SYNTAX",
            message: competing
              ? "A legacy skctl plugin reference exists; migrate it before adding another entry"
              : "Unrelated legacy plugin configuration was retained",
            file,
          });
        }
        if (value.plugins !== undefined && !Array.isArray(value.plugins))
          throw new IntegrationError("INVALID_HOST_CONFIG", "plugins must be an array", file);
        for (const item of Array.isArray(value.plugins) ? value.plugins : []) {
          const ref = packageRef(item);
          if (!ref || !known(ref)) continue;
          if (!owned(ref)) {
            entries.push({
              mechanism: "opencode-v2",
              file,
              status: "modified",
              inherited,
              selected: "unknown",
            });
            continue;
          }
          const artifact = join(resolveRef(file, ref), "index.js");
          const bytes = await reads.read(artifact);
          const metadata = await reads.read(join(dirname(artifact), "package.json"));
          const expected = /\/([a-f0-9]{64})\/index\.js$/.exec(artifact)?.[1];
          const custom =
            typeof item !== "string" && Object.keys(object(item)).some((key) => key !== "package");
          let metadataValid = false;
          try {
            metadataValid = !!metadata && validMetadata(metadata);
          } catch (error) {
            reads.diagnostics.push(diagnostic(error));
          }
          const status = custom
            ? "modified"
            : !bytes?.exists || !metadata?.exists
              ? "missing-artifact"
              : !expected || digest(bytes.text) !== expected || !metadataValid
                ? "modified"
                : "current";
          entries.push({
            mechanism: "opencode-v2",
            file,
            status,
            inherited,
            selected: "unknown",
            artifact,
          });
        }
      } catch (error) {
        reads.failed.add(file);
        reads.diagnostics.push(diagnostic(error));
      }
    }
    for (const scan of ["plugins", "plugin"]) {
      const directory = join(home, scan);
      for (const name of await readdir(directory).catch(() => [] as string[])) {
        if (/skill-cli|skctl|opencode-adapter/.test(name))
          reads.diagnostics.push({
            code: "LEGACY_AUTODISCOVERED_PLUGIN",
            message:
              "A legacy skctl plugin may be automatically loaded; migrate it before adding another plugin",
            file: join(directory, name),
          });
      }
    }
  }
  return {
    root,
    selected: selected ?? join(root, "opencode.jsonc"),
    candidates,
    entries,
    nextSteps: [
      "Reload the intended OpenCode V2 service/location to load configuration changes. A file check does not prove the running plugin was reloaded.",
    ],
  };
}

export async function preparePlugin(root: string): Promise<string> {
  const text = await pluginArtifact();
  const hash = digest(text);
  const parent = join(root, ".skctl-adapters", "opencode-v2");
  const directory = join(parent, hash);
  const existing = await capture(join(directory, "index.js"));
  if (existing.exists) {
    if (digest(existing.text) !== hash)
      throw new IntegrationError(
        "ADAPTER_MODIFIED",
        "Installed adapter bytes were modified",
        existing.file,
      );
    const metadata = await capture(join(directory, "package.json"));
    if (!validMetadata(metadata))
      throw new IntegrationError(
        "ADAPTER_MODIFIED",
        "Installed adapter package metadata is missing or modified",
        metadata.file,
      );
    return directory;
  }
  await mkdir(parent, { recursive: true });
  const stage = join(parent, `.stage-${randomUUID()}`);
  await mkdir(stage);
  try {
    for (const [name, content] of [
      ["index.js", text],
      [
        "package.json",
        JSON.stringify({ name: "@skctl/opencode-adapter", type: "module", exports: "./index.js" }),
      ],
    ]) {
      const file = await open(join(stage, name!), "wx", 0o644);
      try {
        await file.writeFile(content!);
        await file.sync();
      } finally {
        await file.close();
      }
    }
    await rename(stage, directory);
    const fd = await open(parent, "r");
    try {
      await fd.sync();
    } finally {
      await fd.close();
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  return directory;
}

export function editPlugin(snapshot: FileSnapshot, directory?: string): string {
  const config = json(snapshot.text, snapshot.file);
  if (config.plugins !== undefined && !Array.isArray(config.plugins))
    throw new IntegrationError("INVALID_HOST_CONFIG", "plugins must be an array", snapshot.file);
  const plugins = Array.isArray(config.plugins) ? config.plugins : [];
  const indexes = plugins.flatMap((item, index) => {
    const ref = packageRef(item);
    return ref && owned(ref) ? [index] : [];
  });
  if (indexes.length > 1)
    throw new IntegrationError(
      "MULTIPLE_ENTRIES",
      "Multiple managed plugin references exist",
      snapshot.file,
    );
  if (
    indexes.length &&
    typeof plugins[indexes[0]!] !== "string" &&
    Object.keys(object(plugins[indexes[0]!])).some((k) => k !== "package")
  )
    throw new IntegrationError(
      "ENTRY_MODIFIED",
      "Plugin options were customized; preserve or migrate them explicitly",
      snapshot.file,
    );
  if (!directory)
    return indexes.length
      ? editJson(snapshot.text, ["plugins", indexes[0]!], undefined)
      : snapshot.text;
  const ref = relative(dirname(snapshot.file), directory).split("\\").join("/");
  const value = ref.startsWith("./") || ref.startsWith("../") ? ref : `./${ref}`;
  if (!indexes.length) return editJson(snapshot.text, ["plugins"], [...plugins, value]);
  const prior = plugins[indexes[0]!];
  if (typeof prior === "string") return editJson(snapshot.text, ["plugins", indexes[0]!], value);
  return editJson(snapshot.text, ["plugins", indexes[0]!, "package"], value);
}
