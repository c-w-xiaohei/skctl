import type { ConfigDeclarationOwner } from "@skctl/core";
import { Show } from "solid-js";
import { useTerminalSize } from "../ui/terminal-size";
import type { CollectionReview } from "../session";
import { createModalControlRegistry, useModalControlTraversal } from "../modal-controls";
import { ModalBody, ModalCommand, modalCommand, ModalShell } from "./modal";

export const ownerLine = (owner: ConfigDeclarationOwner | undefined) =>
  owner ? `${owner.level}: ${owner.file} ${owner.pointer}` : "No direct editable owner";

export function CollectionReviewOverlay(props: {
  readonly review: CollectionReview;
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onBack?: () => void;
  readonly onPreviewAgain?: () => void;
}) {
  const terminal = useTerminalSize();
  const renameTarget = () =>
    props.review.kind === "collection-rename"
      ? `Collection: ${props.review.intent.collection} -> ${props.review.intent.target}`
      : "";
  const controls = createModalControlRegistry();
  useModalControlTraversal(controls, () => (props.onBack ?? props.onCancel)());
  const destructive = () =>
    props.review.kind === "membership-removal" ||
    props.review.kind === "collection-removal" ||
    (props.review.kind === "membership-batch" && props.review.impact.removals.length > 0) ||
    props.review.kind === "reference-remove" ||
    (props.review.kind === "link-change" && !props.review.impact.linked);
  const verb = () => {
    const impact = props.review.impact;
    return impact.kind === "collection-rename"
      ? "Rename Collection"
      : impact.kind === "membership-batch"
        ? impact.additions.length
          ? "Add to Collection"
          : "Remove from Collection"
        : impact.kind === "membership-removal"
          ? "Remove from Collection"
          : impact.kind === "reference"
            ? props.review.kind === "reference-remove"
              ? "Remove Collection entry"
              : "Add Collection entry"
            : impact.kind === "link-change"
              ? impact.linked
                ? "Include Collection"
                : "Stop including Collection"
              : impact.kind === "collection-removal"
                ? "Remove Collection"
                : impact.kind === "add-to-collection"
                  ? "Add Membership"
                  : impact.kind === "collection-import"
                    ? "Copy Skills from Collection"
                    : "Set Collection Use";
  };
  const lines = () => {
    const impact = props.review.impact;
    switch (impact.kind) {
      case "collection-rename":
        return [
          `Scope: ${impact.scope}`,
          `Limitation: ${impact.limitation}`,
          ...impact.declarations.map((owner) => `Declaration: ${ownerLine(owner)}`),
          ...impact.references.map((item) => `${item.kind}: ${ownerLine(item.owner)}`),
          ...impact.addresses.map((item) => `Address: ${item.before} -> ${item.after}`),
          ...impact.blockers.map(
            (item) => `Blocker: ${item.reason}${item.owner ? ` (${ownerLine(item.owner)})` : ""}`,
          ),
        ];
      case "membership-batch":
        return [
          `Collection: ${impact.collection}`,
          `Owner: ${ownerLine(impact.decision.kind === "direct" ? impact.decision.owner : undefined)}`,
          ...impact.additions.map(
            (item) => `Add: ${item.name} ${item.address.source}/${item.address.path}`,
          ),
          ...impact.removals.map(
            (item) =>
              `Remove: ${item.name} ${item.expectedAddress.source}/${item.expectedAddress.path}`,
          ),
          ...impact.affected.map((item) => `Affected: ${item.selector}`),
          ...impact.blockers.map((item) => `Blocker: ${item.reason}`),
        ];
      case "add-to-collection":
        return [
          `Collection: ${impact.collection}`,
          `Address: ${impact.address.source}/${impact.address.path}`,
          `Decision: ${impact.decision.kind}`,
          ...impact.existing.map((item) => `Existing: ${item.name}`),
        ];
      case "membership-removal":
        return [
          `Collection: ${impact.collection}`,
          `Membership: ${impact.name}`,
          ...impact.disappearing.map((item) => `Disappears: ${item.selector}`),
          ...impact.retained.map((item) => `Retained: ${item.selector}`),
          ...impact.linkActions.map((item) => `Link alternative: ${ownerLine(item.owner)}`),
        ];
      case "collection-import":
        return [
          `From: ${impact.source}`,
          `Into: ${impact.destination}`,
          `Owner: ${ownerLine(impact.owner)}`,
          ...impact.additions.map((item) => `Add: ${item.name}`),
          ...impact.skipped.map((item) => `Skip: ${item.name}`),
          ...impact.conflicts.map((item) => `Conflict: ${item.reason}`),
        ];
      case "reference":
        return [
          `Collection: ${impact.collection}`,
          `Reference: ${impact.name} -> ${impact.referencedCollection}`,
          `Description: ${impact.description}`,
          "Exposure: none",
        ];
      case "link-change":
        return [
          `Link: ${impact.linked ? "add" : "remove"}`,
          `Collection: ${impact.collection} -> ${impact.target}`,
          ...impact.members.map((item) => `Resulting member: ${item.name}`),
          ...impact.disappearingSelectors.map((item) => `Disappears: ${item.selector}`),
          ...impact.retainedSelectors.map((item) => `Retained: ${item.selector}`),
          ...impact.blockers.map((item) => `Blocker: ${item.reason}`),
        ];
      case "collection-use":
        return [
          `Owner: ${ownerLine(impact.owner)}`,
          `Old: ${impact.oldCollections.join(", ") || "(empty)"}`,
          `New: ${impact.newCollections.join(", ") || "(empty)"}`,
          `Complete: ${impact.proposedComplete ? "yes" : "no"}`,
          ...impact.newlyExposed.map((item) => `Expose: ${item.selector}`),
          ...impact.removedAtOwner.map((item) => `Remove: ${item.selector}`),
          ...impact.alternateOwners.map((owner) => `Alternate owner: ${ownerLine(owner)}`),
        ];
      case "collection-removal":
        return [
          `Owner: ${ownerLine(impact.owner)}`,
          ...impact.disappearingSelectors.map((item) => `Disappears: ${item.selector}`),
          ...impact.retainedSelectors.map((item) => `Retained: ${item.selector}`),
          ...impact.blockers.map((item) => `Blocker: ${item.reason}`),
        ];
    }
  };
  return (
    <ModalShell>
      <ModalBody
        controls={controls}
        header={
          <>
            <text height={1} wrapMode="none">
              {verb()}
            </text>
            {props.review.kind === "collection-rename" && (
              <text height={1} wrapMode="none">
                {renameTarget()}
              </text>
            )}
          </>
        }
        footer={
          <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
            <ModalCommand
              id="collection-review-choice"
              controls={controls}
              record={modalCommand(
                "collection-review.cancel",
                props.pending ? "Stop" : "Cancel",
                props.pending
                  ? "Request stop; operation may already have been applied"
                  : "Keep current configuration",
              )}
              initialFocus
              execute={props.onCancel}
            />
            {props.onBack && (
              <ModalCommand
                id="collection-review-back"
                controls={controls}
                record={modalCommand(
                  "collection-review.back",
                  "Back",
                  "Keep draft and edit",
                  !props.pending,
                )}
                execute={props.onBack}
              />
            )}
            {props.review.impact.kind === "collection-rename" &&
              props.error?.code === "CONFIG_CONFLICT" &&
              props.onPreviewAgain && (
                <ModalCommand
                  id="collection-review-preview-again"
                  controls={controls}
                  record={modalCommand(
                    "collection-review.preview-again",
                    "Preview again",
                    "Review current impact",
                    !props.pending,
                  )}
                  execute={props.onPreviewAgain}
                />
              )}
            {!props.pending &&
              props.review.impact.allowed &&
              !(props.review.impact.kind === "collection-rename" && props.error) && (
                <ModalCommand
                  id="collection-review-confirm"
                  intent="primary"
                  controls={controls}
                  record={modalCommand(
                    "collection-review.confirm",
                    props.pending ? `${verb()}...` : props.error ? `Retry ${verb()}` : verb(),
                    `Apply reviewed ${verb().toLowerCase()}`,
                    !props.pending,
                    destructive(),
                    props.pending ? "Wait for the current operation to settle" : undefined,
                  )}
                  execute={props.onConfirm}
                />
              )}
          </box>
        }
      >
        <Show when={Bun.stringWidth(renameTarget()) > terminal().width - 6}>
          <text id="collection-review-target" wrapMode="word">
            {renameTarget()}
          </text>
        </Show>
        {lines().map((line) => (
          <text>{line}</text>
        ))}
        {!props.review.impact.allowed && <text>Operation is blocked by current dependencies.</text>}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        {props.pending && (
          <text>Stop is a request; the operation may already have been applied.</text>
        )}
      </ModalBody>
    </ModalShell>
  );
}
