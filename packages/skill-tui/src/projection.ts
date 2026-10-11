import { batch, createSignal, type Accessor } from "solid-js";
import type { Diagnostic, ManagementProjection } from "@skill-cli/core";
import { projectionOwnerExists } from "./types";
import type { OperationState } from "./operation-state";
import type { WorkspaceState } from "./workspace/state";
import type { CollectionsState } from "./collections/state";
import type { ConfigState } from "./config/state";

export interface ProjectionOutcomes {
  readonly loading: () => void;
  readonly applyProjection: (snapshot: ManagementProjection) => void;
  readonly failed: (diagnostic: Diagnostic) => void;
}

export interface Projection {
  readonly workspace: Accessor<ManagementProjection | undefined>;
  readonly refresh: Accessor<"idle" | "loading" | "stale">;
  readonly diagnostic: Accessor<Diagnostic | undefined>;
  readonly outcomes: ProjectionOutcomes;
}

export function createProjection(
  operation: OperationState,
  pages: {
    readonly workspace: WorkspaceState;
    readonly collections: CollectionsState;
    readonly config: ConfigState;
  },
  revalidateRoute: (snapshot: ManagementProjection) => void = () => {},
): Projection {
  const [workspace, setWorkspace] = createSignal<ManagementProjection>();
  const [refresh, setRefresh] = createSignal<"idle" | "loading" | "stale">("idle");
  const [diagnostic, setDiagnostic] = createSignal<Diagnostic>();

  const applyProjection = (snapshot: ManagementProjection) => {
    batch(() => {
      const previous = workspace();
      setWorkspace(snapshot);
      pages.workspace.reconcile(previous, snapshot);
      pages.collections.reconcile(previous, snapshot);
      pages.config.reconcile(previous, snapshot);
      revalidateRoute(snapshot);
      const task = operation.task();
      if (task?.semanticOwner && !projectionOwnerExists(snapshot, task.semanticOwner))
        operation.settleMissingOwner(task.semanticOwner);
      setDiagnostic(undefined);
      setRefresh("idle");
    });
  };
  const outcomes: ProjectionOutcomes = {
    loading: () => {
      batch(() => {
        setRefresh("loading");
        setDiagnostic(undefined);
      });
    },
    applyProjection,
    failed: (next) => {
      batch(() => {
        setRefresh("stale");
        setDiagnostic(next);
        operation.report(next);
      });
    },
  };
  return { workspace, refresh, diagnostic, outcomes };
}
