import { createSignal, type Accessor } from "solid-js";
import type { Diagnostic } from "@skctl/core";
import type { ProjectionOwner, TaskState } from "./types";

export interface OperationState {
  readonly task: Accessor<TaskState | undefined>;
  readonly problem: Accessor<Diagnostic | undefined>;
  readonly notice: Accessor<string | undefined>;
  readonly start: (task: TaskState) => void;
  readonly requestCancel: (id: string) => void;
  readonly dismiss: (id: string, notice?: string) => void;
  readonly settle: (id: string, notice: string, error?: Diagnostic) => void;
  readonly report: (diagnostic: Diagnostic) => void;
  readonly clearProblem: () => void;
  readonly settleMissingOwner: (owner: ProjectionOwner) => void;
}

/** Owns the lifecycle of one foreground management operation. */
export function createOperationState(): OperationState {
  const [task, setTask] = createSignal<TaskState>();
  const [problem, setProblem] = createSignal<Diagnostic>();
  const [notice, setNotice] = createSignal<string>();
  let activeId: string | undefined;
  return {
    task,
    problem,
    notice,
    start(next) {
      activeId = next.id;
      setTask(next);
      setNotice(next.title);
    },
    requestCancel(id) {
      const current = task();
      if (current?.id !== id) return;
      setTask({ ...current, cancellationRequested: true });
      setNotice("Cancelling operation");
    },
    dismiss(id, nextNotice) {
      const current = task();
      if (current?.id !== id || !current.dismissible) return;
      setTask(undefined);
      activeId = undefined;
      setNotice(nextNotice);
    },
    settle(id, nextNotice, error) {
      if (task()?.id !== id && activeId !== id) return;
      setTask(undefined);
      activeId = undefined;
      setNotice(nextNotice);
      setProblem(error);
    },
    report(diagnostic) {
      setProblem(diagnostic);
      setNotice(`${diagnostic.code}: ${diagnostic.message}`);
    },
    clearProblem() {
      setProblem(undefined);
    },
    settleMissingOwner(owner) {
      const current = task();
      if (
        !current?.semanticOwner ||
        JSON.stringify(current.semanticOwner) !== JSON.stringify(owner)
      )
        return;
      setTask(undefined);
      setNotice("Operation target is no longer available");
    },
  };
}
