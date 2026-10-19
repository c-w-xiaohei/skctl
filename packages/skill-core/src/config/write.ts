import { lstat, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse } from "jsonc-parser";
import type { ConfigDeclarationOwner, ConfigLevel, ConfigWriteResult } from "./types";

import type { OperationOptions, OperationResult } from "../shared";

import { SkctlError } from "../shared";
import { canonicalLocalOrigin } from "../source/identity";
import { parseQualifiedName } from "../collection/names";
import { StateCoordinator } from "../storage/state";
import type { PrivateState } from "../storage/schema";
import {
  decodeConfig,
  document,
  edit,
  parseDocument,
  validateDocumentBindings,
  validateDocumentNames,
  validatorFor,
} from "./document";
import { type ConfigDocument } from "./schema";
import type { CollectionDeclaration } from "../collection/schema";
import { configFile, configInputs, resolveProjectRoot, type ReadWorkspaceOptions } from "./inputs";
import { cachedConfig } from "./bindings";
import { readWorkspaceUnlocked } from "../workspace/capture";
import { resolveEffectiveCollections } from "../collection/resolve";

async function contributionIds(
  project: string | undefined,
  options: ReadWorkspaceOptions,
  state: PrivateState,
  coordinator: StateCoordinator,
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const { file, level } of configInputs(options, project)) {
    const host = await document(file, level);
    for (const [configId, binding] of Object.entries(host.configSources ?? {})) {
      const reusable =
        binding.kind === "local"
          ? await document(
              join(canonicalLocalOrigin(binding.path, dirname(file)), binding.root, "config.jsonc"),
              "reusable",
            )
          : state.configs[configId]
            ? await cachedConfig(configId, state, coordinator)
            : undefined;
      if (!reusable) continue;
      for (const id of Object.keys(reusable.sources ?? {}))
        ids.add(`${configId}/${parseQualifiedName(id)}`);
    }
  }
  return ids;
}

export interface ConfigEdit {
  readonly file: string;
  readonly level: ConfigLevel;
  readonly coordinator: StateCoordinator;
  readonly workspaceOptions: ReadWorkspaceOptions;
  readonly immutableContributions: ReadonlySet<string>;
  document(): ConfigDocument;
  collection(id: string): CollectionDeclaration;
  set(path: (string | number)[], value: unknown): void;
  proposed(): ConfigDocument;
}

export function assertDeclarationOwner(
  actual: ConfigDeclarationOwner,
  expected?: ConfigDeclarationOwner,
) {
  if (
    expected &&
    (actual.level !== expected.level ||
      actual.file !== expected.file ||
      actual.pointer !== expected.pointer ||
      actual.namespace !== expected.namespace ||
      !!actual.contribution !== !!expected.contribution)
  )
    throw new SkctlError("CONFIG_CONFLICT", "Declaration changed after review");
}

export async function writeConfig<T extends object>(
  options: ReadWorkspaceOptions,
  level: ConfigLevel,
  apply: (edit: ConfigEdit) => Promise<T> | T,
  operation?: OperationOptions,
): Promise<OperationResult<ConfigWriteResult & T>> {
  if (operation?.signal?.aborted) throw new SkctlError("CANCELLED", "Operation cancelled");
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const project =
      level === "global" && !options.project
        ? { root: resolve(options.cwd), resolution: "global-only" as const }
        : await resolveProjectRoot(options.cwd, options.project, operation?.signal);
    const immutableContributions = await contributionIds(
      level === "global" ? undefined : project.root,
      options,
      await coordinator.read(),
      coordinator,
    );
    const workspaceOptions =
      level === "global" ? { ...options, globalOnly: true } : { ...options, project: project.root };
    const file = configFile(options, level, project.root);
    const stat = await lstat(file).catch(() => undefined);
    if (stat && (!stat.isFile() || stat.isSymbolicLink()))
      throw new SkctlError("CONFIG_SYMLINK", `Configuration file is not an ordinary file: ${file}`);
    const original = stat ? decodeConfig(await readFile(file), file) : "{}\n";
    let host: ConfigDocument | undefined;
    const directDocument = () => (host ??= parseDocument(original, file, level));
    const directCollection = (id: string) => {
      const collection = directDocument().collections?.[id];
      if (!collection)
        throw new SkctlError(
          "INVALID_ARGUMENT",
          `Collection "${id}" is not directly declared at ${level} scope in ${file}`,
        );
      return collection;
    };
    let next = original;
    const result = await apply({
      file,
      level,
      coordinator,
      workspaceOptions,
      immutableContributions,
      document: directDocument,
      collection: directCollection,
      set: (path, value) => {
        next = edit(next, path, value);
      },
      proposed: () => parse(next, [], { allowTrailingComma: true }) as ConfigDocument,
    });
    const proposed: unknown = parse(next, [], { allowTrailingComma: true });
    if (!validatorFor(level)(proposed))
      throw new SkctlError("CONFIG_INVALID", "Invalid declaration edit");
    validateDocumentNames(proposed, file);
    validateDocumentBindings(proposed, file, false);
    const workspace = await readWorkspaceUnlocked(workspaceOptions, coordinator);
    await resolveEffectiveCollections(
      options,
      workspace.value,
      await coordinator.read(),
      coordinator,
      { file, value: proposed },
    );
    if (operation?.signal?.aborted) throw new SkctlError("CANCELLED", "Operation cancelled");
    const changed = next !== original;
    let diagnostics = workspace.diagnostics;
    if (changed) {
      await coordinator.publish([{ target: file, bytes: next }]);
      // A failed refresh must not turn a committed write into an apparent failure.
      try {
        diagnostics = (await readWorkspaceUnlocked(workspaceOptions, coordinator)).diagnostics;
      } catch {
        diagnostics = [
          {
            code: "WORKSPACE_REFRESH_FAILED",
            severity: "warning",
            message: "Configuration was saved, but workspace diagnostics could not be refreshed.",
            location: { file },
          },
        ];
      }
    }
    return {
      value: {
        ...result,
        level,
        file,
        changed,
      },
      diagnostics,
    };
  });
}
