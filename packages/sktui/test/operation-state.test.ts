import { expect, test } from "bun:test";
import { createOperationState } from "../src/operation-state";

test("operation state exposes task lifecycle and its diagnostic", () => {
  const operation = createOperationState();
  operation.start({ id: "1", title: "Updating source", cancellationRequested: false });
  operation.requestCancel("1");
  expect(operation.task()?.cancellationRequested).toBe(true);

  const problem = { code: "FAILED", severity: "warning" as const, message: "disk full" };
  operation.settle("1", "Update failed", problem);
  expect(operation.task()).toBeUndefined();
  expect(operation.notice()).toBe("Update failed");
  expect(operation.problem()).toEqual(problem);
});

test("dismiss removes only the exact dismissible no-write task", () => {
  const operation = createOperationState();
  operation.start({
    id: "membership-impact-task",
    title: "Membership impact requires multiple owners",
    cancellationRequested: false,
    dismissible: true,
  });
  operation.dismiss("other");
  expect(operation.task()?.id).toBe("membership-impact-task");
  operation.dismiss("membership-impact-task", "Impact dismissed");
  expect(operation.task()).toBeUndefined();
  expect(operation.notice()).toBe("Impact dismissed");
});
