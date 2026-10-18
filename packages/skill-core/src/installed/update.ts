import { sourceFor, validPaths, localRoot, type Candidate } from "../source/roots";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import type { CoreFactoryOptions } from "../shared";
import type { InstalledCapability } from "./types";
import type { OperationResult } from "../shared";

import { SkillCliError } from "../shared";
import { decodeStrictText, parseSkillMetadata, type SkillMetadata } from "../content/text";
import { type GitTreeIdentity } from "../source/schema";
import type { DiscoveredSkillCandidate } from "../source/types";
import type { InternalSourceBinding } from "../source/identity";
import { migrateLegacyInstalled, readWorkspaceUnlocked } from "../workspace/capture";
import { resolveEffectiveCollections } from "../collection/resolve";
import { StateCoordinator } from "../storage/state";
import type { InstalledMaterialization, PrivateState } from "../storage/schema";
import {
  inspectRemoteRoots,
  materializeUpdateRoots,
  openUpdateSource,
  type RootInspection,
} from "../source/snapshot";
import { type RunGit } from "../source/git";
import { createSourceOperation, sourceCheckBudgetMs } from "../source/network";
import { previewUpdateFiles } from "./preview";

let publicationHook: (() => void | Promise<void>) | undefined;
export function setManagementPublicationHookForTest(next?: () => void | Promise<void>) {
  publicationHook = next;
}
export async function invokePublicationHook() {
  await publicationHook?.();
}
let updateCheckHook: (() => void | Promise<void>) | undefined;
export function setManagementUpdateCheckHookForTest(next?: () => void | Promise<void>) {
  updateCheckHook = next;
}

function knownTree(item: InstalledMaterialization, binding: InternalSourceBinding) {
  return item.kind === "remote" &&
    item.adoptedRevision &&
    item.identityEvidence?.status === "known" &&
    item.identityEvidence.canonicalOrigin === binding.origin &&
    item.identityEvidence.originRelativeSkillRoot ===
      [binding.root, item.path].filter(Boolean).join("/")
    ? item.treeIdentity
    : undefined;
}

function sameTree(left: GitTreeIdentity | undefined, right: GitTreeIdentity | undefined) {
  return (
    left !== undefined &&
    right !== undefined &&
    left.objectFormat === right.objectFormat &&
    left.objectId === right.objectId
  );
}

/** No IO: a failed/incomplete acquisition is never a removal observation. */
export function compareRoots(
  installed: readonly InstalledMaterialization[],
  target: readonly RootInspection[],
  previous: ReadonlyMap<string, GitTreeIdentity>,
) {
  const roots = new Map(target.map((root) => [root.path, root]));
  if (roots.size !== target.length)
    throw new SkillCliError(
      "PROVIDER_INTEGRITY_FAILED",
      "Remote Root inspection has duplicate paths",
    );
  const changed: InstalledMaterialization[] = [],
    removed: InstalledMaterialization[] = [],
    unchanged: InstalledMaterialization[] = [];
  for (const item of installed) {
    const root = roots.get(item.path);
    if (!root)
      throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Remote Root inspection is incomplete");
    if (root.status !== "present") {
      removed.push(item);
      continue;
    }
    if (!root.tree)
      throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Present Root has no tree identity");
    const old = previous.get(item.path);
    if (!old)
      throw new SkillCliError(
        "PINNED_COMMIT_UNAVAILABLE",
        "Installed Root has no exact comparison evidence",
      );
    (sameTree(old, root.tree) ? unchanged : changed).push(item);
  }
  return { changed, removed, unchanged };
}

export function assertOwner(state: PrivateState, binding: InternalSourceBinding) {
  const drifted = state.installed.some(
    (item) =>
      item.source === binding.id &&
      (item.bindingDigest !== binding.bindingDigest ||
        (item.kind === "local") !== (binding.kind === "local") ||
        (item.identityEvidence?.status === "known" &&
          (item.identityEvidence.canonicalOrigin !== binding.origin ||
            item.identityEvidence.originRelativeSkillRoot !==
              [binding.root, item.path].filter(Boolean).join("/"))) ||
        (item.kind === "local" && item.root !== resolve(binding.origin, binding.root, item.path))),
  );
  if (drifted)
    throw new SkillCliError("CONFIG_CONFLICT", "Installed Skill owner binding has drifted");
}

async function updateBaseline(
  coordinator: StateCoordinator,
  binding: InternalSourceBinding,
  state: PrivateState,
): Promise<string> {
  assertOwner(state, binding);
  const installed = state.installed
    .filter((item) => item.source === binding.id)
    .sort((left, right) => left.path.localeCompare(right.path));
  const snapshot = {
    comparisonVersion: 4,
    environment: coordinator.root,
    source: binding.id,
    binding: binding.bindingDigest,
    installed: await Promise.all(
      installed.map(async (item) => ({
        path: item.path,
        digest: item.digest,
        kind: item.kind,
        name: item.name,
        description: item.description,
        identityEvidence: item.identityEvidence,
        ...(item.kind === "remote"
          ? { treeIdentity: item.treeIdentity, revisionStatus: item.revisionStatus }
          : { root: item.root }),
        ...(item.kind === "remote" && item.adoptedRevision
          ? { adoptedRevision: item.adoptedRevision }
          : {}),
        ...(item.kind === "local"
          ? { local: await localRoot(binding, item.path, coordinator) }
          : {}),
      })),
    ),
  };
  return new Bun.CryptoHasher("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export async function installedForMutation(
  options: CoreFactoryOptions,
  coordinator: StateCoordinator,
  state: PrivateState,
) {
  return state.version === 1
    ? migrateLegacyInstalled(options, coordinator, state)
    : state.installed;
}

export function createUpdates(
  options: CoreFactoryOptions,
  runGit?: RunGit,
): Pick<InstalledCapability, "checkUpdate" | "updateBaseline" | "previewUpdate" | "update"> {
  const coordinator = new StateCoordinator();
  const captureUpdateBaseline = async (
    source: string,
    binding: InternalSourceBinding,
    signal?: AbortSignal,
  ) =>
    coordinator.withLock(async () => {
      const { binding: currentBinding } = await sourceFor(options, source, signal).catch(
        (error) => {
          if (error instanceof SkillCliError && error.code === "SOURCE_NOT_FOUND")
            throw new SkillCliError(
              "CONFIG_CONFLICT",
              "Source binding disappeared while reading update baseline",
            );
          throw error;
        },
      );
      if (currentBinding.bindingDigest !== binding.bindingDigest)
        throw new SkillCliError(
          "CONFIG_CONFLICT",
          "Source binding changed while reading update baseline",
        );
      const state = await coordinator.read();
      return { state, baseline: await updateBaseline(coordinator, currentBinding, state) };
    });
  return {
    async previewUpdate(request, operation) {
      if (operation?.signal?.aborted)
        throw new SkillCliError("CANCELLED", "Update preview cancelled");
      validPaths([request.path]);
      if (!request.expectedBaseline)
        throw new SkillCliError("INVALID_ARGUMENT", "Check updates before previewing");
      const { binding, network: policy } = await sourceFor(
        options,
        request.source,
        operation?.signal,
      );
      const captured = await captureUpdateBaseline(request.source, binding, operation?.signal);
      if (captured.baseline !== request.expectedBaseline)
        throw new SkillCliError(
          "TRANSACTION_CONFLICT",
          "Installed comparison changed; check updates again",
        );
      const item = captured.state.installed.find(
        (item) => item.source === request.source && item.path === request.path,
      );
      if (!item) throw new SkillCliError("SKILL_NOT_FOUND", "Installed Skill not found");
      const address = { source: request.source, path: request.path };
      if (item.kind === "local")
        return {
          value: { address, status: "unavailable", reason: "local-live-content" },
          diagnostics: [],
        };
      if (!request.exactRevision || !/^[a-f0-9]{40}$/.test(request.exactRevision))
        throw new SkillCliError(
          "INVALID_ARGUMENT",
          "Remote preview requires the checked exact revision",
        );
      const revision = request.exactRevision;
      const network = createSourceOperation({
        ...policy,
        source: binding.id,
        signal: operation?.signal,
        budgetMs: sourceCheckBudgetMs,
      });
      try {
        return await coordinator.withInstalledRoot(address, async (installed) => {
          if (installed.item.kind !== "remote" || installed.item.digest !== item.digest)
            throw new SkillCliError(
              "TRANSACTION_CONFLICT",
              "Installed comparison changed; check updates again",
            );
          const snapshot = await openUpdateSource(binding, options, network, revision, runGit);
          try {
            const inspections = await snapshot.inspectRoots([request.path], network.signal);
            const target = inspections.find((root) => root.path === request.path);
            if (!target)
              throw new SkillCliError(
                "PROVIDER_INTEGRITY_FAILED",
                "Update target inspection is incomplete",
              );
            const removed = target.status !== "present";
            const files = await previewUpdateFiles(
              installed.root,
              snapshot,
              request.path,
              removed,
              network.signal,
            );
            const current = await captureUpdateBaseline(request.source, binding, operation?.signal);
            if (current.baseline !== captured.baseline)
              throw new SkillCliError(
                "TRANSACTION_CONFLICT",
                "Installed comparison changed during preview; check updates again",
              );
            network.throwIfAborted("preview completion");
            return {
              value: {
                address,
                status: "ready" as const,
                installedRevision: item.adoptedRevision,
                targetRevision: revision,
                removed,
                files,
              },
              diagnostics: [],
            };
          } finally {
            await snapshot.close();
          }
        });
      } finally {
        network.dispose();
      }
    },
    async checkUpdate(request, operation) {
      if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
      const { binding, network: policy } = await sourceFor(
        options,
        request.source,
        operation?.signal,
      );
      const checked = await captureUpdateBaseline(request.source, binding, operation?.signal);
      const { state, baseline } = checked;
      const current = state.installed
        .filter((item) => item.source === binding.id)
        .sort((a, b) => a.path.localeCompare(b.path));
      const changed: DiscoveredSkillCandidate[] = [],
        removed: DiscoveredSkillCandidate[] = [],
        unchanged: DiscoveredSkillCandidate[] = [];
      let exactRevision: string | undefined;
      if (binding.kind === "local") {
        for (const item of current) {
          const root = await localRoot(binding, item.path, coordinator);
          if (root.status !== "present") removed.push(item);
          else (root.digest === item.digest ? unchanged : changed).push(root.candidate);
        }
      } else if (current.length) {
        const network = createSourceOperation({
          ...policy,
          source: binding.id,
          signal: operation?.signal,
          budgetMs: sourceCheckBudgetMs,
        });
        try {
          const observed = await inspectRemoteRoots(
            binding,
            options,
            current.map((item) => ({
              path: item.path,
              tree: knownTree(item, binding),
              revision: item.kind === "remote" ? item.adoptedRevision : undefined,
            })),
            network,
            runGit,
          );
          exactRevision = observed.commit;
          const result = compareRoots(current, observed.roots, observed.previous);
          changed.push(...result.changed);
          removed.push(...result.removed);
          unchanged.push(...result.unchanged);
          network.throwIfAborted("check completion");
        } finally {
          network.dispose();
        }
      }
      await updateCheckHook?.();
      const completed = await captureUpdateBaseline(request.source, binding, operation?.signal);
      if (completed.baseline !== baseline)
        throw new SkillCliError(
          "TRANSACTION_CONFLICT",
          "Installed comparison baseline changed during update check",
        );
      return {
        value: {
          source: binding.id,
          kind: binding.kind,
          baseline,
          ...(exactRevision ? { exactRevision } : {}),
          changed: changed.map(({ path, name, description }) => ({ path, name, description })),
          added: [],
          removed: removed.map(({ path, name, description }) => ({ path, name, description })),
          unchanged: unchanged.map(({ path, name, description }) => ({ path, name, description })),
        },
        diagnostics: [],
      };
    },
    async updateBaseline(request, operation) {
      if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
      const { binding } = await sourceFor(options, request.source, operation?.signal);
      return {
        value: (await captureUpdateBaseline(request.source, binding, operation?.signal)).baseline,
        diagnostics: [],
      };
    },
    async update(request, operation): Promise<OperationResult<void>> {
      if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
      const { binding, network: policy } = await sourceFor(
        options,
        request.source,
        operation?.signal,
      );
      if (binding.kind === "local" && request.exactRevision)
        throw new SkillCliError("INVALID_ARGUMENT", "Local Source does not accept a revision");
      if (
        binding.kind !== "local" &&
        (!request.exactRevision || !/^[a-f0-9]{40}$/u.test(request.exactRevision))
      )
        throw new SkillCliError("INVALID_ARGUMENT", "Remote Source requires an exact revision");
      const remove = request.remove ?? [];
      validPaths(request.paths);
      validPaths(remove);
      const checked = await captureUpdateBaseline(request.source, binding, operation?.signal);
      const installed = checked.state.installed.filter((item) => item.source === binding.id);
      if (
        (!request.paths.length && !remove.length) ||
        request.paths.some((path) => remove.includes(path)) ||
        [...request.paths, ...remove].some((path) => !installed.some((item) => item.path === path))
      )
        throw new SkillCliError("INVALID_ARGUMENT", "Updates must select owned Installed Skills");
      if (request.expectedBaseline !== undefined && request.expectedBaseline !== checked.baseline)
        throw new SkillCliError(
          "TRANSACTION_CONFLICT",
          "Installed comparison baseline changed before update",
        );
      let stage: string | undefined;
      const preparedByPath = new Map<string, { candidate: Candidate; digest: string }>();
      try {
        if (binding.kind === "local") {
          for (const path of [...request.paths, ...remove]) {
            const root = await localRoot(binding, path, coordinator);
            if (remove.includes(path)) {
              if (root.status === "present")
                throw new SkillCliError(
                  "INVALID_ARGUMENT",
                  "Cannot remove a present valid Skill Root through update",
                );
            } else {
              const item = installed.find((item) => item.path === path)!;
              if (root.status !== "present" || root.digest === item.digest)
                throw new SkillCliError(
                  "INVALID_ARGUMENT",
                  "Updates must explicitly select changed Installed Skills",
                );
              preparedByPath.set(path, { candidate: root.candidate, digest: root.digest });
            }
          }
        } else {
          const network = createSourceOperation({
            ...policy,
            source: binding.id,
            signal: operation?.signal,
          });
          try {
            stage = await mkdtemp(join(tmpdir(), "skill-cli-update-"));
            const prepared = await materializeUpdateRoots(
              binding,
              options,
              request.exactRevision!,
              request.paths,
              remove,
              stage,
              network,
              runGit,
            );
            for (const path of remove)
              if (prepared.inspections.find((root) => root.path === path)?.status === "present")
                throw new SkillCliError(
                  "INVALID_ARGUMENT",
                  "Cannot remove a present valid Skill Root through update",
                );
            for (const root of prepared.roots) {
              const bytes = await readFile(join(root.root, "SKILL.md"));
              let parsed: SkillMetadata;
              try {
                parsed = parseSkillMetadata(decodeStrictText(bytes));
              } catch (error) {
                if (
                  !(error instanceof SkillCliError) ||
                  ![
                    "CONFIG_INVALID",
                    "INVALID_ARGUMENT",
                    "INVALID_UTF8",
                    "TEXT_TOO_LARGE",
                  ].includes(error.code)
                )
                  throw error;
                const file = [root.path, "SKILL.md"].filter(Boolean).join("/");
                // This receipt is issued only here, before the publication hook,
                // Snapshot publication or state replacement can be attempted.
                throw new SkillCliError(
                  "INVALID_ARGUMENT",
                  `Invalid SKILL.md at ${file}: ${error.message}`,
                  [
                    {
                      code: "UPDATE_NOT_APPLIED",
                      severity: "warning",
                      message:
                        "Skill validation rejected this batch before publication; installed Skills were kept",
                      location: { file },
                      subject: {
                        kind: "installed-skill",
                        address: { source: binding.id, path: root.path },
                      },
                      suggestion: "Fix this Source file, then recheck updates.",
                    },
                  ],
                  { cause: error },
                );
              }
              const candidate: Candidate = { ...root, ...parsed, revision: request.exactRevision! };
              const digest = await coordinator.snapshotDigest(candidate.root);
              const item = installed.find((item) => item.path === candidate.path)!;
              const tree = knownTree(item, binding);
              if (sameTree(tree, candidate.tree))
                throw new SkillCliError(
                  "INVALID_ARGUMENT",
                  "Updates must explicitly select changed Installed Skills",
                );
              if (!tree) {
                if (item.kind !== "remote")
                  throw new SkillCliError(
                    "CONFIG_CONFLICT",
                    "Remote owner has Local materialization",
                  );
                await coordinator.withRemoteUse(item.digest, async () => {});
                if (digest === item.digest)
                  throw new SkillCliError("INVALID_ARGUMENT", "Selected legacy Root is unchanged");
              }
              preparedByPath.set(candidate.path, { candidate, digest });
            }
            network.throwIfAborted("update preparation");
          } finally {
            network.dispose();
          }
        }
        await invokePublicationHook();
        if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
        await coordinator.withLock(async () => {
          const { binding: currentBinding } = await sourceFor(
            options,
            request.source,
            operation?.signal,
          ).catch((error) => {
            if (error instanceof SkillCliError && error.code === "SOURCE_NOT_FOUND")
              throw new SkillCliError(
                "CONFIG_CONFLICT",
                "Source binding disappeared during update",
              );
            throw error;
          });
          if (currentBinding.bindingDigest !== binding.bindingDigest)
            throw new SkillCliError("CONFIG_CONFLICT", "Source binding changed during update");
          const current = await coordinator.read();
          const installed = await installedForMutation(options, coordinator, current);
          assertOwner(current, currentBinding);
          if (checked.baseline !== (await updateBaseline(coordinator, currentBinding, current)))
            throw new SkillCliError(
              "TRANSACTION_CONFLICT",
              "Installed comparison baseline changed during update",
            );
          if (binding.kind === "local") {
            for (const path of [...request.paths, ...remove]) {
              const root = await localRoot(currentBinding, path, coordinator);
              const prepared = preparedByPath.get(path);
              if (
                remove.includes(path)
                  ? root.status === "present"
                  : root.status !== "present" ||
                    root.digest !== prepared?.digest ||
                    root.candidate.name !== prepared?.candidate.name ||
                    root.candidate.description !== prepared?.candidate.description
              )
                throw new SkillCliError("TRANSACTION_CONFLICT", "Local Root changed during update");
            }
          }
          const workspace = await readWorkspaceUnlocked(options, coordinator);
          if (
            workspace.value.installedSkills.some(
              (item) =>
                item.address.source === binding.id &&
                remove.includes(item.address.path) &&
                item.collections.some(({ paths }) =>
                  paths.some((path) => path.kind === "direct" && path.owner),
                ),
            )
          )
            throw new SkillCliError(
              "CONFIG_CONFLICT",
              "Installed Skill has direct Membership dependencies",
            );
          const next = installed
            .filter((item) => item.source !== binding.id || !remove.includes(item.path))
            .map((item) => {
              const prepared =
                item.source === binding.id ? preparedByPath.get(item.path) : undefined;
              if (!prepared) return item;
              const { candidate, digest } = prepared;
              if (item.kind === "local")
                return {
                  ...item,
                  name: candidate.name,
                  description: candidate.description,
                  digest,
                };
              const { revisionStatus: _revisionStatus, ...retained } = item;
              return {
                ...retained,
                description: candidate.description,
                digest,
                adoptedRevision: candidate.revision!,
                treeIdentity: candidate.tree!,
                identityEvidence: {
                  status: "known" as const,
                  canonicalOrigin: binding.origin,
                  originRelativeSkillRoot: [binding.root, item.path].filter(Boolean).join("/"),
                },
              };
            });
          await resolveEffectiveCollections(
            options,
            workspace.value,
            { ...current, installed: next },
            coordinator,
          );
          if (operation?.signal?.aborted)
            throw new SkillCliError("CANCELLED", "Operation cancelled");
          if (stage)
            for (const path of request.paths) {
              const { candidate, digest } = preparedByPath.get(path)!;
              await coordinator.publishSnapshot(digest, candidate.root);
            }
          await coordinator.write(
            { installed: next, configs: current.configs },
            current.generation,
          );
        });
      } catch (error) {
        if (stage)
          for (const path of request.paths) {
            const digest = preparedByPath.get(path)?.digest;
            if (digest) await coordinator.discardUnreferencedSnapshot(digest);
          }
        throw error;
      } finally {
        if (stage) await rm(stage, { recursive: true, force: true });
      }
      return { value: undefined, diagnostics: [] };
    },
  };
}
