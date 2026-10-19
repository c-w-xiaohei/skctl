import type { ConfigDeclarationOwner } from "@skctl/core";
import type { CollectionReview } from "../effects";
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
}) {
  const controls = createModalControlRegistry();
  useModalControlTraversal(controls, props.onCancel);
  const impact = props.review.impact;
  const destructive =
    props.review.kind === "membership-removal" ||
    props.review.kind === "collection-removal" ||
    (props.review.kind === "membership-batch" && props.review.impact.removals.length > 0) ||
    props.review.kind === "reference-remove" ||
    (props.review.kind === "link-change" && !props.review.impact.linked);
  const verb =
    impact.kind === "membership-batch"
      ? impact.additions.length
        ? "Add to Collection"
        : "Remove from Collection"
      : impact.kind === "membership-removal"
        ? "Remove Membership"
        : impact.kind === "reference"
          ? props.review.kind === "reference-remove"
            ? "Remove Reference"
            : "Add Reference"
          : impact.kind === "link-change"
            ? impact.linked
              ? "Add Link"
              : "Remove Link"
            : impact.kind === "collection-removal"
              ? "Remove Collection"
              : impact.kind === "add-to-collection"
                ? "Add Membership"
                : impact.kind === "collection-import"
                  ? "Import Collection"
                  : "Set Collection Use";
  const lines = () => {
    switch (impact.kind) {
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
      <ModalBody controls={controls}>
        <text>{verb}</text>
        {lines().map((line) => (
          <text>{line}</text>
        ))}
        {!impact.allowed && <text>Operation is blocked by current dependencies.</text>}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <box flexDirection="column" gap={1} flexShrink={0}>
          <ModalCommand
            id="collection-review-choice"
            controls={controls}
            record={modalCommand(
              "collection-review.cancel",
              "Cancel",
              "Keep current configuration",
            )}
            initialFocus
            execute={props.onCancel}
          />
          {impact.allowed && (
            <ModalCommand
              id="collection-review-confirm"
              intent="primary"
              controls={controls}
              record={modalCommand(
                "collection-review.confirm",
                props.pending ? `${verb}...` : props.error ? `Retry ${verb}` : verb,
                `Apply reviewed ${verb.toLowerCase()}`,
                !props.pending,
                destructive,
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
