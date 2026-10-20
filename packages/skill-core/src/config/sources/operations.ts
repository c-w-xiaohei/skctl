import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SkctlError,
  type CoreOptions,
  type OperationOptions,
  type OperationResult,
} from "../../shared";
import { readSourceConfig, type SourceContext } from "../../source/service";
import { StateCoordinator } from "../../storage/state";
import {
  captureConfigSource,
  migrateLegacyInstalled,
  readWorkspaceUnlocked,
} from "../../workspace/capture";
import { sourceView } from "../bindings";
import { decodeConfig, edit, parseDocument, validateConfigBytes } from "../document";
import { assertDeclarationOwner } from "../write";
import { contributions, configImpact } from "./impact";
import type {
  AdoptConfigRequest,
  ConfigLevel,
  ConfigSourceImpact,
  ConfigSourceObservation,
} from "../types";
import type { ReusableConfigDocument } from "../schema";

type Capture = Awaited<ReturnType<typeof captureConfigSource>>;
const fingerprint = (capture: Capture) => {
  const { source } = capture,
    view = sourceView(source.id, source.binding, source.owner.file, source.owner.level);
  return JSON.stringify([source.owner, view.bindingDigest]);
};
const context = (
  options: CoreOptions,
  captured: Capture,
  operation?: OperationOptions,
): SourceContext => ({
  binding: sourceView(
    captured.source.id,
    captured.source.binding,
    captured.source.owner.file,
    captured.source.owner.level,
  ),
  ...captured.network,
  transport: options.sourceTransport,
  githubApiBaseUrl: options.githubApiBaseUrl,
  signal: operation?.signal,
});

async function revalidate(
  options: CoreOptions,
  captured: Capture,
  coordinator: StateCoordinator,
  operation?: OperationOptions,
) {
  const current = await captureConfigSource(
    { ...options, signal: operation?.signal },
    captured.source.id,
    coordinator,
  ).catch((error) => {
    if (error instanceof SkctlError && error.code === "SOURCE_NOT_FOUND")
      throw new SkctlError("CONFIG_CONFLICT", "Config Source disappeared during the operation");
    throw error;
  });
  if (fingerprint(current) !== fingerprint(captured))
    throw new SkctlError("CONFIG_CONFLICT", "Config Source changed during the operation");
  return current;
}

async function currentConfig(captured: Capture, coordinator: StateCoordinator) {
  const { source, state } = captured;
  if (source.binding.kind === "local") {
    const result = await readSourceConfig(
      context({ cwd: captured.workspace.project.root }, captured),
    );
    return validateConfigBytes(result.bytes);
  }
  const applied = state.configs[source.id];
  if (!applied) return undefined;
  return validateConfigBytes(
    await readFile(join(coordinator.root, "configs", applied.digest, "config.jsonc")),
  );
}

function validateObservation(
  request: AdoptConfigRequest,
  captured: Capture,
  value: ReusableConfigDocument,
) {
  const observation = request.observation;
  if (!observation) return;
  if (
    observation.id !== request.id ||
    observation.exactRevision !== request.exactRevision ||
    JSON.stringify(observation.contributions) !==
      JSON.stringify(contributions(captured.source, value, request.exactRevision))
  )
    throw new SkctlError("CONFIG_CONFLICT", "Config observation does not match the exact target");
}

async function inspect(
  options: CoreOptions,
  captured: Capture,
  kind: ConfigSourceImpact["kind"],
  coordinator: StateCoordinator,
  proposed?: ReusableConfigDocument,
  revision?: string,
) {
  const impact = configImpact(
    captured.workspace,
    captured.source,
    kind,
    await currentConfig(captured, coordinator),
    proposed,
    revision,
  );
  if (!proposed || !revision) return impact;
  try {
    const workspace = await readWorkspaceUnlocked(options, coordinator, {
      id: captured.source.id,
      commit: revision,
      value: proposed,
    });
    if (workspace.value.effective.status === "complete") return impact;
  } catch (error) {
    if (!(error instanceof SkctlError)) throw error;
  }
  return {
    ...impact,
    blockers: [...impact.blockers, { reason: "incomplete" as const }],
    allowed: false,
  };
}

export async function observeConfigSource(
  options: CoreOptions,
  request: { readonly id: string },
  operation?: OperationOptions,
): Promise<OperationResult<ConfigSourceObservation>> {
  const coordinator = new StateCoordinator(),
    captured = await captureConfigSource(
      { ...options, signal: operation?.signal },
      request.id,
      coordinator,
    );
  if (captured.source.binding.kind === "local")
    throw new SkctlError("INVALID_ARGUMENT", "Local Config Source has no revision");
  const result = await readSourceConfig(context(options, captured, operation));
  const config = validateConfigBytes(result.bytes);
  await revalidate(options, captured, coordinator, operation);
  return {
    value: {
      id: request.id,
      kind: captured.source.binding.kind,
      exactRevision: result.version!.commit,
      contributions: contributions(captured.source, config, result.version!.commit),
    },
    diagnostics: captured.diagnostics,
  };
}

export async function previewConfigAdoption(
  options: CoreOptions,
  request: AdoptConfigRequest,
  operation?: OperationOptions,
): Promise<OperationResult<ConfigSourceImpact>> {
  const coordinator = new StateCoordinator(),
    captured = await captureConfigSource(
      { ...options, signal: operation?.signal },
      request.id,
      coordinator,
    );
  if (captured.source.binding.kind === "local" || !request.exactRevision)
    throw new SkctlError("INVALID_ARGUMENT", "Adoption requires an exact remote revision");
  const result = await readSourceConfig(
      context(options, captured, operation),
      request.exactRevision,
    ),
    config = validateConfigBytes(result.bytes);
  validateObservation(request, captured, config);
  return coordinator.withLock(async () => {
    const current = await revalidate(options, captured, coordinator, operation);
    return {
      value: await inspect(
        options,
        current,
        "config-source-adopt",
        coordinator,
        config,
        request.exactRevision,
      ),
      diagnostics: current.diagnostics,
    };
  });
}

export async function adoptConfigSource(
  options: CoreOptions,
  request: AdoptConfigRequest,
  operation?: OperationOptions,
): Promise<OperationResult<void>> {
  const coordinator = new StateCoordinator(),
    captured = await captureConfigSource(
      { ...options, signal: operation?.signal },
      request.id,
      coordinator,
    );
  if (captured.source.binding.kind === "local" || !request.exactRevision)
    throw new SkctlError("INVALID_ARGUMENT", "Adoption requires an exact remote revision");
  const result = await readSourceConfig(
      context(options, captured, operation),
      request.exactRevision,
    ),
    config = validateConfigBytes(result.bytes);
  validateObservation(request, captured, config);
  return coordinator.withLock(async () => {
    const current = await revalidate(options, captured, coordinator, operation);
    const impact = await inspect(
      options,
      current,
      "config-source-adopt",
      coordinator,
      config,
      request.exactRevision,
    );
    if (!impact.allowed)
      throw new SkctlError(
        "CONFIG_CONFLICT",
        "Config adoption changes installed owners or graph dependencies",
      );
    const installed = await migrateLegacyInstalled(options, coordinator, current.state);
    const digest = await coordinator.publishConfig(result.bytes);
    if (operation?.signal?.aborted)
      throw new SkctlError("CANCELLED", "Config adoption cancelled before publication");
    await coordinator.write(
      {
        installed,
        configs: {
          ...current.state.configs,
          [request.id]: { commit: request.exactRevision, digest },
        },
      },
      current.state.generation,
    );
    return { value: undefined, diagnostics: current.diagnostics };
  });
}

async function previewRemoval(
  options: CoreOptions,
  id: string,
  kind: "config-source-forget" | "config-source-removal",
  operation?: OperationOptions,
): Promise<OperationResult<ConfigSourceImpact>> {
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const captured = await captureConfigSource(
      { ...options, signal: operation?.signal },
      id,
      coordinator,
    );
    return {
      value: await inspect(options, captured, kind, coordinator),
      diagnostics: captured.diagnostics,
    };
  });
}
export function previewConfigForget(
  options: CoreOptions,
  request: { readonly id: string },
  operation?: OperationOptions,
) {
  return previewRemoval(options, request.id, "config-source-forget", operation);
}
export function previewConfigRemoval(
  options: CoreOptions,
  request: { readonly id: string },
  operation?: OperationOptions,
) {
  return previewRemoval(options, request.id, "config-source-removal", operation);
}

export async function forgetConfig(
  options: CoreOptions,
  request: { readonly id: string },
  operation?: OperationOptions,
): Promise<OperationResult<void>> {
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const captured = await captureConfigSource(
      { ...options, signal: operation?.signal },
      request.id,
      coordinator,
    );
    if (!captured.state.configs[request.id])
      throw new SkctlError("SOURCE_NOT_FOUND", "Config Source is not adopted");
    const impact = await inspect(options, captured, "config-source-forget", coordinator);
    if (!impact.allowed)
      throw new SkctlError(
        "CONFIG_CONFLICT",
        "Config Source has installed content or graph dependencies",
      );
    const installed = await migrateLegacyInstalled(options, coordinator, captured.state);
    if (operation?.signal?.aborted) throw new SkctlError("CANCELLED", "Config forget cancelled");
    await coordinator.write(
      {
        installed,
        configs: Object.fromEntries(
          Object.entries(captured.state.configs).filter(([id]) => id !== request.id),
        ),
      },
      captured.state.generation,
    );
    return { value: undefined, diagnostics: captured.diagnostics };
  });
}

export async function removeConfig(
  options: CoreOptions,
  request: { readonly id: string; readonly level?: ConfigLevel },
  operation?: OperationOptions,
): Promise<OperationResult<void>> {
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const captured = await captureConfigSource(
      { ...options, signal: operation?.signal },
      request.id,
      coordinator,
    );
    const { owner } = captured.source;
    if (request.level) assertDeclarationOwner(owner, { ...owner, level: request.level });
    const impact = await inspect(options, captured, "config-source-removal", coordinator);
    if (!impact.allowed)
      throw new SkctlError(
        "CONFIG_CONFLICT",
        "Config Source has installed content or graph dependencies",
      );
    const original = decodeConfig(await readFile(owner.file), owner.file);
    const declaration = parseDocument(original, owner.file, owner.level).configSources?.[
      request.id
    ];
    if (
      !declaration ||
      sourceView(request.id, declaration, owner.file, owner.level).bindingDigest !==
        sourceView(request.id, captured.source.binding, owner.file, owner.level).bindingDigest
    )
      throw new SkctlError("CONFIG_CONFLICT", "Config Source changed during removal");
    const next = edit(original, ["configSources", request.id], undefined);
    parseDocument(next, owner.file, owner.level);
    const installed = await migrateLegacyInstalled(options, coordinator, captured.state);
    const state = {
      version: 3,
      generation: captured.state.generation + 1,
      installed,
      configs: Object.fromEntries(
        Object.entries(captured.state.configs).filter(([id]) => id !== request.id),
      ),
    };
    if (operation?.signal?.aborted) throw new SkctlError("CANCELLED", "Config removal cancelled");
    await coordinator.publish(
      [
        { target: owner.file, bytes: next },
        { target: join(coordinator.root, "state.json"), bytes: `${JSON.stringify(state)}\n` },
      ],
      captured.state.generation,
    );
    return { value: undefined, diagnostics: captured.diagnostics };
  });
}
