import { Show, For, onMount } from "solid-js";
import { useRenderer } from "@opentui/solid";
import type { collectionRemovalPlan } from "../collections/relationship-model";
import type { CollectionReview } from "../session";
import { createModalControlRegistry, useModalControlTraversal } from "../modal-controls";
import { ModalBody, ModalCommand, modalCommand, ModalShell } from "./modal";

export function MembershipRemovalPlanOverlay(props: {
  readonly plan: ReturnType<typeof collectionRemovalPlan>;
  readonly ownerIndex?: number;
  readonly review?: CollectionReview;
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onSelect: (index: number) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const controls = createModalControlRegistry();
  const renderer = useRenderer();
  onMount(() =>
    queueMicrotask(() => renderer.root.findDescendantById("membership-removal-plan")?.focus()),
  );
  useModalControlTraversal(controls, props.onCancel);
  const group = () => props.plan.ownerGroups[props.ownerIndex ?? 0];
  return (
    <ModalShell>
      <ModalBody
        controls={controls}
        header={<text>{`Remove from ${props.plan.collection}`}</text>}
        footer={
          <box flexDirection="row" gap={1} flexShrink={0}>
            <ModalCommand
              id="membership-removal-plan"
              controls={controls}
              record={modalCommand("membership-removal.cancel", "Cancel", "Keep selections")}
              initialFocus
              execute={props.onCancel}
            />
            <Show when={props.review?.impact.allowed}>
              <ModalCommand
                id="collection-review-confirm"
                controls={controls}
                record={modalCommand(
                  "membership-removal.confirm",
                  "Remove",
                  "Remove the reviewed declarations",
                  !props.pending && !props.error && !!props.review?.impact.allowed,
                  true,
                )}
                execute={props.onConfirm}
              />
            </Show>
          </box>
        }
      >
        <text>Installed Skills will be kept.</text>
        <Show when={props.plan.ownerGroups.length > 1}>
          <text>Choose the configuration to change. Other locations will be kept.</text>
          <For each={props.plan.ownerGroups}>
            {(item, index) => (
              <box flexDirection="column" flexShrink={0}>
                <text wrapMode="word">{item.owner.file}</text>
                <ModalCommand
                  id={`membership-removal-owner-${index()}`}
                  controls={controls}
                  record={modalCommand(
                    `membership-removal.owner.${index()}`,
                    `Choose ${item.owner.level} (${index() + 1})`,
                    "Preview removal at this location",
                    !props.pending,
                  )}
                  execute={() => props.onSelect(index())}
                />
              </box>
            )}
          </For>
        </Show>
        <Show when={props.ownerIndex !== undefined || props.plan.ownerGroups.length === 1}>
          <text wrapMode="word">{`Configuration: ${group()?.owner.file ?? "Unavailable"}\n${group()?.owner.pointer ?? ""}`}</text>
          <For each={group()?.rows ?? []}>
            {(row) => (
              <text wrapMode="word">{`Remove: ${row.name}\n${row.address.source}/${row.address.path}`}</text>
            )}
          </For>
          <For
            each={props.plan.ownerGroups.filter((_, index) => index !== (props.ownerIndex ?? 0))}
          >
            {(other) => (
              <text wrapMode="word">{`Kept in ${other.owner.level}: ${other.rows.map((row) => row.name).join(", ")}`}</text>
            )}
          </For>
        </Show>
        <For each={props.plan.explanations}>{(line) => <text wrapMode="word">{line}</text>}</For>
        <Show when={props.review?.impact.kind === "membership-batch" && props.review.impact}>
          {(impact) => (
            <>
              <For each={impact().kind === "membership-batch" ? impact().affected : []}>
                {(item) => <text wrapMode="word">{`Affected: ${item.selector}`}</text>}
              </For>
              <For each={impact().kind === "membership-batch" ? impact().blockers : []}>
                {(item) => <text wrapMode="word">{item.reason}</text>}
              </For>
            </>
          )}
        </Show>
        <Show when={!props.plan.ownerGroups.length}>
          <text>
            No editable direct declarations. Open the source Collection or configuration to make
            changes.
          </text>
        </Show>
        <Show when={props.review && !props.review.impact.allowed}>
          <text>Operation is blocked by current dependencies.</text>
        </Show>
        <Show when={props.pending}>
          <text>Working on the requested change…</text>
        </Show>
        <Show when={props.error}>
          <text wrapMode="word">{props.error?.message}</text>
        </Show>
        <Show when={props.error && group() && !props.pending}>
          <ModalCommand
            id="membership-removal-retry"
            controls={controls}
            record={modalCommand(
              "membership-removal.retry",
              "Preview again",
              "Review current configuration",
            )}
            execute={() => props.onSelect(props.ownerIndex ?? 0)}
          />
        </Show>
      </ModalBody>
    </ModalShell>
  );
}
