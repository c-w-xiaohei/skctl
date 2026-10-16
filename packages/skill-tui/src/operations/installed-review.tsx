import type { ConfigDeclarationOwner } from "@skill-cli/core";
import type { InstalledSkillReview } from "../effects";
import { createModalControlRegistry, useModalControlTraversal } from "../modal-controls";
import { ModalBody, ModalCommand, modalCommand, ModalShell } from "./modal";

export type InstalledSkillPreviewRequest =
  | {
      readonly kind: "uninstall";
      readonly address: { readonly source: string; readonly path: string };
    }
  | {
      readonly kind: "rebind";
      readonly address: { readonly source: string; readonly path: string };
      readonly owner: string;
      readonly ownerPath: string;
    };

export function InstalledSkillPreviewOverlay(props: {
  readonly request: InstalledSkillPreviewRequest;
  readonly cancelling: boolean;
  readonly onCancel: () => void;
}) {
  const rebind = props.request.kind === "rebind";
  const controls = createModalControlRegistry();
  useModalControlTraversal(controls, props.onCancel);
  return (
    <ModalShell>
      <ModalBody>
        <text>{`${rebind ? "Rebind" : "Uninstall"} Skill preview`}</text>
        <text>{`Installed Skill: ${props.request.address.source}/${props.request.address.path}`}</text>
        {rebind && <text>{`Replacement: ${props.request.owner}/${props.request.ownerPath}`}</text>}
        <text>{props.cancelling ? "Cancelling preview" : "Reviewing impact"}</text>
        <ModalCommand
          id="installed-skill-preview-progress"
          controls={controls}
          record={modalCommand("installed.preview.cancel", "Cancel", "Return to Details")}
          initialFocus
          execute={props.onCancel}
        />
        <text>Escape Cancel</text>
      </ModalBody>
    </ModalShell>
  );
}

export function InstalledSkillPreviewFailureOverlay(props: {
  readonly request: InstalledSkillPreviewRequest;
  readonly error?: { readonly code: string; readonly message: string };
  readonly pending: boolean;
  readonly cancelling: boolean;
  readonly onRetry: () => void;
  readonly onCancel: () => void;
}) {
  const rebind = props.request.kind === "rebind";
  const controls = createModalControlRegistry();
  useModalControlTraversal(controls, props.onCancel);
  return (
    <ModalShell>
      <ModalBody>
        <text>{`${rebind ? "Rebind" : "Uninstall"} Skill preview failed`}</text>
        <text>{`Installed Skill: ${props.request.address.source}/${props.request.address.path}`}</text>
        {rebind && <text>{`Replacement: ${props.request.owner}/${props.request.ownerPath}`}</text>}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        {props.cancelling && <text>Cancelling preview</text>}
        <box flexDirection="column" gap={1} flexShrink={0}>
          <ModalCommand
            id="installed-skill-preview-failure-cancel"
            controls={controls}
            record={modalCommand("installed.preview.cancel", "Cancel", "Return to Details")}
            initialFocus
            execute={props.onCancel}
          />
          <ModalCommand
            id="installed-skill-preview-failure-retry"
            controls={controls}
            record={modalCommand(
              "installed.preview.retry",
              props.pending ? "Cancelling" : "Retry",
              "Repeat this exact preview",
              !props.pending,
              false,
              props.pending ? "Wait for preview settlement" : undefined,
            )}
            execute={props.onRetry}
          />
        </box>
        <text>Cancel is selected by default</text>
      </ModalBody>
    </ModalShell>
  );
}

export function InstalledSkillReviewOverlay(props: {
  readonly review: InstalledSkillReview;
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onResolveMembership: (owner: ConfigDeclarationOwner) => void;
}) {
  const controls = createModalControlRegistry();
  useModalControlTraversal(controls, props.onCancel);
  const uninstall = props.review.kind === "uninstall";
  const blocked = !props.review.impact.allowed;
  const directMemberships = uninstall ? props.review.impact.directMemberships : [];
  const lines = uninstall
    ? [
        ...props.review.impact.directMemberships.map(
          (owner) => `Direct Membership: ${owner.level} (${owner.pointer})`,
        ),
        ...props.review.impact.disappearingSelectors.map((item) => `Disappears: ${item.selector}`),
        ...props.review.impact.retainedSelectors.map((item) => `Retained: ${item.selector}`),
      ]
    : [
        `Old owner: ${props.review.address.source}`,
        `New owner: ${props.review.owner}`,
        `New path: ${props.review.ownerPath}`,
        `Identity proof: ${props.review.impact.proof}`,
      ];
  return (
    <ModalShell>
      <ModalBody controls={controls}>
        <text>{uninstall ? "Uninstall Skill" : "Rebind Skill"}</text>
        <text>{`Installed Skill: ${props.review.address.source}/${props.review.address.path}`}</text>
        {lines.map((line) => (
          <text>{line}</text>
        ))}
        {blocked && <text>Operation is blocked by current dependencies.</text>}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <box flexDirection="column" gap={1} flexShrink={0}>
          <ModalCommand
            id="installed-skill-review-cancel"
            controls={controls}
            record={modalCommand("installed.cancel", "Cancel", "Details")}
            initialFocus
            execute={props.onCancel}
          />
          {blocked &&
            directMemberships.map((owner, index) => (
              <ModalCommand
                id={`installed-skill-review-resolve-${index}`}
                controls={controls}
                record={modalCommand(
                  `installed.resolve.${index}`,
                  `Resolve References: ${owner.level} (${owner.pointer})`,
                  owner.file,
                )}
                execute={() => props.onResolveMembership(owner)}
              />
            ))}
          {!blocked && (
            <ModalCommand
              id="installed-skill-review-confirm"
              intent="primary"
              controls={controls}
              record={modalCommand(
                "installed.confirm",
                props.pending
                  ? "Applying"
                  : props.error
                    ? "Retry"
                    : uninstall
                      ? "Uninstall Skill"
                      : "Rebind Skill",
                "Apply reviewed operation",
                !props.pending,
                true,
                props.pending ? "Wait for the current operation to settle" : undefined,
              )}
              execute={props.onConfirm}
            />
          )}
        </box>
        <text>Cancel is selected by default</text>
      </ModalBody>
    </ModalShell>
  );
}
