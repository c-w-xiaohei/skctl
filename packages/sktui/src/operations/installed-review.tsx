import type { ConfigDeclarationOwner } from "@skctl/core";
import { Show } from "solid-js";
import { useTerminalSize } from "../ui/terminal-size";
import type { InstalledSkillReview } from "../session";
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
      <ModalBody
        controls={controls}
        header={
          <text
            height={1}
            wrapMode="none"
          >{`${rebind ? "Rebind" : "Uninstall"} Skill preview`}</text>
        }
        footer={
          <ModalCommand
            id="installed-skill-preview-progress"
            controls={controls}
            record={modalCommand("installed.preview.cancel", "Cancel", "Return to previous view")}
            initialFocus
            execute={props.onCancel}
          />
        }
      >
        <text wrapMode="word">{`Installed Skill: ${props.request.address.source}/${props.request.address.path}`}</text>
        {rebind && (
          <text wrapMode="word">{`Replacement: ${props.request.owner}/${props.request.ownerPath}`}</text>
        )}
        <text>{props.cancelling ? "Cancelling preview" : "Reviewing impact"}</text>
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
      <ModalBody
        controls={controls}
        header={
          <text
            height={1}
            wrapMode="none"
          >{`${rebind ? "Rebind" : "Uninstall"} Skill preview failed`}</text>
        }
        footer={
          <box flexDirection="row" gap={1} flexShrink={0}>
            <ModalCommand
              id="installed-skill-preview-failure-cancel"
              controls={controls}
              record={modalCommand("installed.preview.cancel", "Cancel", "Return to previous view")}
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
        }
      >
        <text wrapMode="word">{`Installed Skill: ${props.request.address.source}/${props.request.address.path}`}</text>
        {rebind && (
          <text wrapMode="word">{`Replacement: ${props.request.owner}/${props.request.ownerPath}`}</text>
        )}
        {props.error && (
          <text wrapMode="word">{`${props.error.code}: ${props.error.message}`}</text>
        )}
        {props.cancelling && <text>Cancelling preview</text>}
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
  readonly onPreviewAgain?: () => void;
}) {
  const terminal = useTerminalSize();
  const targetLabel = () =>
    `Installed Skill: ${props.review.address.source}/${props.review.address.path}`;
  const controls = createModalControlRegistry();
  useModalControlTraversal(controls, props.onCancel);
  const uninstall = () => props.review.kind === "uninstall";
  const blocked = () => !props.review.impact.allowed;
  const directMemberships = () =>
    props.review.kind === "uninstall" ? props.review.impact.directMemberships : [];
  const lines = () =>
    props.review.kind === "uninstall"
      ? [
          ...props.review.impact.directMemberships.map(
            (owner) => `Direct Membership: ${owner.level} (${owner.pointer})`,
          ),
          ...props.review.impact.disappearingSelectors.map(
            (item) => `Disappears: ${item.selector}`,
          ),
          ...props.review.impact.retainedSelectors.map((item) => `Retained: ${item.selector}`),
        ]
      : [
          `Old owner: ${props.review.address.source}`,
          `New owner: ${props.review.owner}`,
          `New path: ${props.review.ownerPath}`,
          `Identity proof: ${props.review.impact.proof}`,
          `Scope: ${props.review.impact.scope}`,
          `Limitation: ${props.review.impact.limitation}`,
          ...props.review.impact.directMemberships.map(
            (item) =>
              `Membership ${item.collection}:${item.name}: ${item.before.source}/${item.before.path} -> ${item.after.source}/${item.after.path} (${item.owner.level}: ${item.owner.file} ${item.owner.pointer})`,
          ),
          ...props.review.impact.blockers.map(
            (item) =>
              `Blocker: ${item.reason}${item.owner ? ` (${item.owner.level}: ${item.owner.file} ${item.owner.pointer})` : ""}`,
          ),
        ];
  return (
    <ModalShell>
      <ModalBody
        controls={controls}
        header={
          <>
            <text height={1} wrapMode="none">
              {uninstall() ? "Uninstall Skill" : "Rebind Skill"}
            </text>
            <text height={1} wrapMode="none">
              {targetLabel()}
            </text>
          </>
        }
        footer={
          <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
            <ModalCommand
              id="installed-skill-review-cancel"
              controls={controls}
              record={modalCommand(
                "installed.cancel",
                props.pending ? "Stop" : "Cancel",
                props.pending
                  ? "Request stop; operation may already have been applied"
                  : "Return to previous view",
              )}
              initialFocus
              execute={props.onCancel}
            />
            {props.review.kind === "rebind" &&
              props.error?.code === "CONFIG_CONFLICT" &&
              props.onPreviewAgain && (
                <ModalCommand
                  id="installed-skill-preview-again"
                  controls={controls}
                  record={modalCommand(
                    "installed.preview-again",
                    "Preview again",
                    "Review current impact",
                    !props.pending,
                  )}
                  execute={props.onPreviewAgain}
                />
              )}
            {!props.pending && !blocked() && !(props.review.kind === "rebind" && props.error) && (
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
                      : uninstall()
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
        }
      >
        <Show when={Bun.stringWidth(targetLabel()) > terminal().width - 6}>
          <text id="installed-review-target" wrapMode="word">
            {targetLabel()}
          </text>
        </Show>
        {lines().map((line) => (
          <text>{line}</text>
        ))}
        {blocked() && <text>Operation is blocked by current dependencies.</text>}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        {blocked() &&
          directMemberships().map((owner, index) => (
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
        {props.pending && (
          <text>Stop is a request; the operation may already have been applied.</text>
        )}
      </ModalBody>
    </ModalShell>
  );
}
