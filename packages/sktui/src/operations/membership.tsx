import { createModalControlRegistry, useModalControlTraversal } from "../modal-controls";
import { ModalBody, ModalCommand, modalCommand, ModalShell } from "./modal";

export function MembershipRemovalPlanOverlay(props: {
  readonly collection: string;
  readonly lines: readonly string[];
  readonly executableCount: number;
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onContinue: () => void;
  readonly onCancel: () => void;
}) {
  const controls = createModalControlRegistry();
  useModalControlTraversal(controls, props.onCancel);
  return (
    <ModalShell>
      <ModalBody controls={controls}>
        <text>{`Remove from ${props.collection}`}</text>
        <text>{`${props.executableCount} direct Membership${props.executableCount === 1 ? "" : "s"} can be removed`}</text>
        {props.lines.map((line) => (
          <text>{line}</text>
        ))}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <box flexDirection="column" gap={1} flexShrink={0}>
          <ModalCommand
            id="membership-removal-plan"
            controls={controls}
            record={modalCommand("membership-removal.cancel", "Cancel", "Keep selections")}
            initialFocus
            execute={props.onCancel}
          />
          {props.executableCount > 0 ? (
            <ModalCommand
              id="membership-removal-plan-continue"
              controls={controls}
              record={modalCommand(
                "membership-removal.continue",
                "Continue",
                "Review the direct Membership delta",
                !props.pending,
                false,
                props.pending ? "Wait for the current review to settle" : undefined,
              )}
              execute={props.onContinue}
            />
          ) : (
            <text>No direct Membership can be removed; Cancel keeps the current selections.</text>
          )}
        </box>
        <text>Tab switch controls · Enter activate · Esc cancel</text>
      </ModalBody>
    </ModalShell>
  );
}
