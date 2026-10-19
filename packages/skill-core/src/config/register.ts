import { SkctlError, type OperationOptions } from "../shared";
import { type CoreOptions } from "../shared";

import type { RegisterSourceRequest } from "../source/types";
import type { ManagedOpenCodeRequest } from "./types";

import { parseQualifiedName } from "../collection/names";
import { validateSourceRoot } from "./document";
import { writeConfig } from "./write";

function register(
  options: CoreOptions,
  request: RegisterSourceRequest,
  key: "sources" | "configSources",
  operation?: OperationOptions,
) {
  return writeConfig(
    options,
    request.level,
    (edit) => {
      parseQualifiedName(request.id);
      if (edit.immutableContributions.has(request.id))
        throw new SkctlError("INVALID_ARGUMENT", "Config Source contributions are immutable");
      if (edit.document()[key]?.[request.id])
        throw new SkctlError(
          "CONFIG_CONFLICT",
          "Source bindings are immutable; remove and register a new Source ID",
        );
      validateSourceRoot(request.binding.root ?? "");
      edit.set([key, request.id], { ...request.binding, root: request.binding.root ?? "" });
      return {};
    },
    operation,
  );
}
export function registerSource(
  options: CoreOptions,
  request: RegisterSourceRequest,
  operation?: OperationOptions,
) {
  return register(options, request, "sources", operation);
}
export function registerConfigSource(
  options: CoreOptions,
  request: RegisterSourceRequest,
  operation?: OperationOptions,
) {
  return register(options, request, "configSources", operation);
}
export function setManagedOpenCode(
  options: CoreOptions,
  request: ManagedOpenCodeRequest,
  operation?: OperationOptions,
) {
  return writeConfig(
    options,
    request.level,
    (edit) => {
      edit.set(["agents"], request.managed ? { opencode: "managed" } : undefined);
      return {};
    },
    operation,
  );
}
