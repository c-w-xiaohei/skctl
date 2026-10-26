import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertPath } from "../storage/files";
import { SkctlError, type CoreOptions, type OperationOptions } from "../shared";
import type { InternalSourceBinding } from "../source/identity";
import { StateCoordinator } from "../storage/state";
import type { InstalledMaterialization, PrivateState } from "../storage/schema";
import { capturedWorkspace, captureSource, migrateLegacyInstalled } from "../workspace/capture";
import { resolveEffectiveCollections } from "../collection/resolve";
import type { PreparedSkill } from "../source/service";

export function assertOwner(state: PrivateState, binding: InternalSourceBinding) {
  for (const item of state.installed.filter((item) => item.source === binding.id)) {
    const identity = item.identityEvidence;
    if (
      item.bindingDigest !== binding.bindingDigest ||
      (item.kind === "local") !== (binding.kind === "local") ||
      (identity?.status === "known" &&
        (identity.canonicalOrigin !== binding.origin ||
          identity.originRelativeSkillRoot !==
            [binding.root, item.path].filter(Boolean).join("/"))) ||
      (item.kind === "local" && item.root !== resolve(binding.origin, binding.root, item.path))
    )
      throw new SkctlError("CONFIG_CONFLICT", "Installed Skill owner binding has drifted");
  }
}

async function localEvidence(root: string) {
  await assertPath(root, "directory", true).catch((error) => {
    if (error instanceof SkctlError && error.code === "CONFIG_SYMLINK")
      throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Installed Local prefix is unsafe");
    throw error;
  });
  try {
    const marker = join(root, "SKILL.md");
    await assertPath(marker, "file");
    return { marker: (await readFile(marker)).toString("utf8") };
  } catch (error) {
    if (!(error instanceof SkctlError) && (error as NodeJS.ErrnoException).code !== "ENOENT")
      throw error;
    const marker = await readFile(join(root, "SKILL.md")).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
      throw error;
    });
    return {
      error: error instanceof SkctlError ? error.code : "missing",
      marker: marker?.toString("utf8"),
    };
  }
}

export async function captureInstalled(
  options: CoreOptions,
  source: string,
  operation?: OperationOptions,
  coordinator = new StateCoordinator(),
) {
  return coordinator.withLock(async () => {
    const captured = await captureSource(
      { ...options, signal: operation?.signal },
      source,
      coordinator,
    );
    assertOwner(captured.state, captured.binding);
    const installed = captured.state.installed
      .filter((item) => item.source === source)
      .sort((a, b) => a.path.localeCompare(b.path));
    const evidence = [];
    for (const item of installed)
      evidence.push({
        ...item,
        ...(item.kind === "local" ? { content: await localEvidence(item.root) } : {}),
      });
    const baseline = new Bun.CryptoHasher("sha256")
      .update(
        JSON.stringify({
          version: 6,
          environment: coordinator.root,
          source,
          binding: captured.binding.bindingDigest,
          installed: evidence,
        }),
      )
      .digest("hex");
    return { ...captured, installed, baseline };
  });
}
export type InstalledContext = Awaited<ReturnType<typeof captureInstalled>>;

/** Remote repository entry names stay stable; Local names follow the live marker. */
export function preparedMaterializations(
  context: InstalledContext,
  prepared: readonly PreparedSkill[],
): InstalledMaterialization[] {
  return prepared.map((skill) => ({
    source: context.binding.id,
    path: skill.path,
    name: skill.name,
    description: skill.description,
    bindingDigest: context.binding.bindingDigest,
    identityEvidence: {
      status: "known",
      canonicalOrigin: context.binding.origin,
      originRelativeSkillRoot: [context.binding.root, skill.path].filter(Boolean).join("/"),
    },
    ...(skill.kind === "local"
      ? { kind: "local" as const, root: skill.directory }
      : {
          kind: "remote" as const,
          snapshotId: skill.snapshotId,
          adoptedRevision: skill.revision,
          treeIdentity: skill.tree,
          name: context.installed.find((item) => item.path === skill.path)?.name ?? skill.name,
        }),
  }));
}

export async function revalidateInstalled(
  options: CoreOptions,
  expected: InstalledContext,
  operation?: OperationOptions,
  coordinator = new StateCoordinator(),
) {
  let current: InstalledContext;
  try {
    current = await captureInstalled(options, expected.binding.id, operation, coordinator);
  } catch (error) {
    if (error instanceof SkctlError && error.code === "SOURCE_NOT_FOUND")
      throw new SkctlError("CONFIG_CONFLICT", "Source disappeared during the operation");
    throw error;
  }
  if (current.binding.bindingDigest !== expected.binding.bindingDigest)
    throw new SkctlError("CONFIG_CONFLICT", "Source binding changed during the operation");
  if (current.baseline !== expected.baseline)
    throw new SkctlError("TRANSACTION_CONFLICT", "Installed comparison changed; check again");
  return current;
}

/** Checks current identity ownership and the proposed Collection graph, not just selected names. */
export async function validateInstallation(
  options: CoreOptions,
  context: InstalledContext,
  additions: readonly InstalledMaterialization[],
  coordinator: StateCoordinator,
  removals: readonly string[] = [],
) {
  const installed = await migrateLegacyInstalled(options, coordinator, context.state);
  const identities = new Set(
    additions.map((item) =>
      item.identityEvidence?.status === "known"
        ? `${item.identityEvidence.canonicalOrigin}\0${item.identityEvidence.originRelativeSkillRoot}`
        : undefined,
    ),
  );
  const sources = capturedWorkspace(context.workspace)!.sources;
  for (const item of installed) {
    const owner = sources.get(item.source);
    const identity =
      item.identityEvidence?.status === "known"
        ? item.identityEvidence
        : owner && owner.bindingDigest === item.bindingDigest
          ? {
              canonicalOrigin: owner.origin,
              originRelativeSkillRoot: [owner.root, item.path].filter(Boolean).join("/"),
            }
          : undefined;
    if (
      item.source !== context.binding.id &&
      identity &&
      identities.has(`${identity.canonicalOrigin}\0${identity.originRelativeSkillRoot}`)
    )
      throw new SkctlError(
        "CONFIG_CONFLICT",
        "Installed Skill identity already belongs to another Source",
      );
  }
  const next = [
    ...installed.filter(
      (item) =>
        !(item.source === context.binding.id && removals.includes(item.path)) &&
        !additions.some((next) => next.source === item.source && next.path === item.path),
    ),
    ...additions,
  ];
  const resolved = await resolveEffectiveCollections(
    options,
    context.workspace,
    { ...context.state, installed: next },
    coordinator,
  );
  const previous = capturedWorkspace(context.workspace)!.resolved;
  if ([...resolved.missing].some((address) => !previous.missing.has(address)))
    throw new SkctlError(
      "CONFIG_CONFLICT",
      "Remove direct Memberships before removing installed content",
    );
  return next;
}
