import { InputRenderable } from "@opentui/core";
import { createSignal, Index, onMount } from "solid-js";
import type { AddMembershipPreviewRequest } from "../effects";
import {
  createModalControlRegistry,
  useModalControl,
  useModalControlTraversal,
} from "../modal-controls";
import { Input } from "../ui/input";
import { ModalBody, ModalCommand, modalCommand, ModalShell } from "./modal";

export function MembershipAddOverlay(props: {
  readonly level: "global" | "project" | "local";
  readonly collection: string;
  readonly address: { readonly source: string; readonly path: string };
  readonly initialName: string;
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onPreview: (intent: AddMembershipPreviewRequest) => void;
  readonly onCancel: () => void;
}) {
  const controls = createModalControlRegistry();
  const [name, setName] = createSignal(props.initialName);
  const registerName = useModalControl("membership-add-name", controls);
  useModalControlTraversal(controls, props.onCancel);
  let nameInput: InputRenderable | undefined;
  onMount(() => queueMicrotask(() => nameInput?.focus()));
  return (
    <ModalShell>
      <ModalBody>
        <text>Add Membership</text>
        <text>{`Address: ${props.address.source}/${props.address.path}`}</text>
        <Input
          id="membership-add-name"
          ref={(value: InputRenderable) => {
            nameInput = value;
            registerName(value);
          }}
          focused
          value={name()}
          placeholder="Stable entry name"
          onInput={setName}
        />
        <text>Review this exact stable entry name with Core.</text>
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <box flexDirection="column" gap={1} flexShrink={0}>
          <ModalCommand
            id="membership-add-cancel"
            controls={controls}
            record={modalCommand("membership-add.cancel", "Cancel", "Discard draft")}
            execute={props.onCancel}
          />
          <ModalCommand
            id="membership-add-preview"
            intent="primary"
            controls={controls}
            record={modalCommand(
              "membership-add.preview",
              "Continue to confirmation",
              "Review the Core-authorized membership before applying",
              !props.pending && !!name().trim(),
              false,
              props.pending ? "Wait for the current review to settle" : "Enter a stable entry name",
            )}
            execute={() =>
              props.onPreview({
                kind: "add-to-collection",
                level: props.level,
                collection: props.collection,
                address: props.address,
                name: name().trim(),
              })
            }
          />
        </box>
      </ModalBody>
    </ModalShell>
  );
}

export function MembershipBatchDraftOverlay(props: {
  readonly level: "global" | "project" | "local";
  readonly collection: string;
  readonly additions: readonly {
    readonly name: string;
    readonly address: { readonly source: string; readonly path: string };
  }[];
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onChange: (index: number, name: string) => void;
  readonly onPreview: () => void;
  readonly onCancel: () => void;
}) {
  const controls = createModalControlRegistry();
  // Native inputs retain their edit buffer while the parent records each change in the session.
  const [names, setNames] = createSignal(props.additions.map((item) => item.name));
  const invalid = () => {
    const proposed = names().map((name) => name.trim());
    return !proposed.every(Boolean) || new Set(proposed).size !== proposed.length;
  };
  const error = () =>
    names().some((name) => !name.trim())
      ? "Each Membership needs a stable entry name before review."
      : new Set(names().map((name) => name.trim())).size !== props.additions.length
        ? "Duplicate entry names must be changed before review."
        : undefined;
  useModalControlTraversal(controls, props.onCancel);
  return (
    <ModalShell>
      <ModalBody>
        <text>{`Add to ${props.collection}`}</text>
        <Index each={props.additions}>
          {(item, index) => (
            <box flexDirection="column">
              <text>{`Address: ${item().address.source}/${item().address.path}`}</text>
              <Input
                id={`membership-batch-name-${index}`}
                ref={(value: InputRenderable) => {
                  useModalControl(`membership-batch-name-${index}`, controls)(value);
                }}
                focused={index === 0}
                value={names()[index]!}
                placeholder="Stable entry name"
                onInput={(name) => {
                  setNames((current) =>
                    current.map((value, currentIndex) => (currentIndex === index ? name : value)),
                  );
                  props.onChange(index, name);
                }}
              />
            </box>
          )}
        </Index>
        {error() && <text>{error()}</text>}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <box flexDirection="column" gap={1} flexShrink={0}>
          <ModalCommand
            id="membership-batch-cancel"
            controls={controls}
            record={modalCommand("membership-batch.cancel", "Cancel", "Discard draft")}
            execute={props.onCancel}
          />
          <ModalCommand
            id="membership-batch-review"
            intent="primary"
            controls={controls}
            record={modalCommand(
              "membership-batch.review",
              "Review",
              "Review one atomic batch",
              !props.pending && !invalid(),
              false,
              props.pending
                ? "Wait for the current review to settle"
                : invalid()
                  ? error()
                  : undefined,
            )}
            execute={props.onPreview}
          />
        </box>
      </ModalBody>
    </ModalShell>
  );
}

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
  const canContinue = () => props.executableCount > 0 && !props.pending;
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
                canContinue(),
                false,
                props.pending ? "Wait for the current review to settle" : undefined,
              )}
              execute={props.onContinue}
            />
          ) : (
            <text>No direct Membership can be removed; Cancel keeps the current selections.</text>
          )}
        </box>
        <text>Cancel is focused by default. Use ↓ to Continue.</text>
      </ModalBody>
    </ModalShell>
  );
}
