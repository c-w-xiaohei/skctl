import { InputRenderable, SelectRenderable } from "@opentui/core";
import { createSignal, onMount } from "solid-js";
import type { CollectionReview } from "../session";
import {
  createModalControlRegistry,
  useModalControl,
  useModalControlTraversal,
} from "../modal-controls";
import { DataList } from "../ui/data-list";
import { Input } from "../ui/input";
import { ModalBody, ModalCommand, modalCommand, ModalShell } from "./modal";

type CollectionCreateLevelProps =
  | {
      readonly level: "global" | "project" | "local";
      readonly allowedLevels?: never;
    }
  | {
      readonly level?: never;
      readonly allowedLevels: readonly ("global" | "project" | "local")[];
    };

export function CollectionCreateOverlay(
  props: CollectionCreateLevelProps & {
    readonly collection: string;
    readonly configFile?: (level: "global" | "project" | "local") => string | undefined;
    readonly fixed?: boolean;
    readonly pending: boolean;
    readonly error?: { readonly code: string; readonly message: string };
    readonly onSubmit: (value: {
      readonly level: "global" | "project" | "local";
      readonly collection: string;
    }) => void;
    readonly onCancel: () => void;
  },
) {
  const controls = createModalControlRegistry();
  const allowedLevels = props.allowedLevels ?? [];
  const selectable = allowedLevels.length > 0;
  const initialLevel = props.level ?? allowedLevels[0]!;
  const [collection, setCollection] = createSignal(props.collection);
  const [level, setLevel] = createSignal(initialLevel);
  const registerLevel = useModalControl("collection-create-level", controls);
  const registerId = useModalControl("collection-create-id", controls);
  useModalControlTraversal(controls, props.onCancel);
  let levelChoice: SelectRenderable | undefined;
  let idInput: InputRenderable | undefined;
  onMount(() => queueMicrotask(() => (selectable ? levelChoice : idInput)?.focus()));
  return (
    <ModalShell>
      <ModalBody>
        <text>Create Collection</text>
        {selectable ? (
          <DataList
            id="collection-create-level"
            height={Math.min(allowedLevels.length * 2, 6)}
            flexShrink={0}
            ref={(value: SelectRenderable) => {
              levelChoice = value;
              registerLevel(value);
            }}
            focused={selectable}
            options={allowedLevels.map((value) => ({
              name: value[0]!.toUpperCase() + value.slice(1),
              description: `Create in ${value} configuration`,
              value,
            }))}
            showDescription
            selectedIndex={allowedLevels.indexOf(level())}
            onChange={(_index, option) =>
              option && setLevel(option.value as "global" | "project" | "local")
            }
            onSelect={(_index, option) =>
              option && setLevel(option.value as "global" | "project" | "local")
            }
          />
        ) : (
          <text>{`Level: ${props.level}`}</text>
        )}
        {props.configFile && (
          <text wrapMode="word">{`Target: ${props.configFile(level()) ?? level()}`}</text>
        )}
        {props.fixed ? (
          <text>{`Collection ID: ${collection()}`}</text>
        ) : (
          <Input
            id="collection-create-id"
            ref={(value: InputRenderable) => {
              idInput = value;
              registerId(value);
            }}
            focused={!selectable}
            value={collection()}
            placeholder="Collection ID"
            onInput={setCollection}
          />
        )}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <box flexDirection="column" gap={1} flexShrink={0}>
          <ModalCommand
            id="collection-create-cancel"
            controls={controls}
            record={modalCommand("collection-create.cancel", "Cancel", "Discard draft")}
            initialFocus={props.fixed && !selectable}
            execute={props.onCancel}
          />
          <ModalCommand
            id="collection-create-submit"
            intent="primary"
            controls={controls}
            record={modalCommand(
              "collection-create.submit",
              props.pending ? "Creating" : "Create",
              "Create this collection",
              !props.pending && !!collection().trim(),
              false,
              props.pending ? "Wait for creation to settle" : "Enter a Collection ID",
            )}
            execute={() => props.onSubmit({ level: level()!, collection: collection().trim() })}
          />
        </box>
        <text>↑↓ move between controls · Enter create · Esc discard draft</text>
      </ModalBody>
    </ModalShell>
  );
}

export function CollectionImportOverlay(props: {
  readonly level: "global" | "project" | "local";
  readonly from: string;
  readonly into: string;
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onPreview: (
    intent: Extract<CollectionReview["intent"], { readonly kind: "collection-import" }>,
  ) => void;
  readonly onCancel: () => void;
}) {
  const controls = createModalControlRegistry();
  const [from, setFrom] = createSignal(props.from);
  const [into, setInto] = createSignal(props.into);
  const registerFrom = useModalControl("collection-import-from", controls);
  const registerInto = useModalControl("collection-import-into", controls);
  useModalControlTraversal(controls, props.onCancel);
  return (
    <ModalShell>
      <ModalBody>
        <text>Import Collection</text>
        <Input
          id="collection-import-from"
          ref={registerFrom}
          focused
          value={from()}
          placeholder="From collection"
          onInput={setFrom}
        />
        <Input
          id="collection-import-into"
          ref={registerInto}
          focused={false}
          value={into()}
          placeholder="Into collection"
          onInput={setInto}
        />
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <box flexDirection="column" gap={1} flexShrink={0}>
          <ModalCommand
            id="collection-import-cancel"
            controls={controls}
            record={modalCommand("collection-import.cancel", "Cancel", "Discard draft")}
            execute={props.onCancel}
          />
          <ModalCommand
            id="collection-import-review"
            intent="primary"
            controls={controls}
            record={modalCommand(
              "collection-import.review",
              "Review Import",
              "Preview all-or-none import",
              !props.pending && !!from().trim() && !!into().trim(),
              false,
              props.pending ? "Wait for the current review to settle" : "Enter both collection IDs",
            )}
            execute={() =>
              props.onPreview({
                kind: "collection-import",
                level: props.level,
                from: from().trim(),
                into: into().trim(),
              })
            }
          />
        </box>
      </ModalBody>
    </ModalShell>
  );
}

export function ReferenceOverlay(props: {
  readonly level: "global" | "project" | "local";
  readonly expectedOwner?: import("@skctl/core").ConfigDeclarationOwner;
  readonly collection: string;
  readonly name: string;
  readonly target: string;
  readonly description: string;
  readonly remove: boolean;
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onPreview: (
    intent: Extract<
      CollectionReview["intent"],
      { readonly kind: "reference-add" | "reference-remove" }
    >,
  ) => void;
  readonly onCancel: () => void;
}) {
  const controls = createModalControlRegistry();
  const [name, setName] = createSignal(props.name);
  const [target, setTarget] = createSignal(props.target);
  const [description, setDescription] = createSignal(props.description);
  const registerName = useModalControl("reference-name", controls);
  const registerTarget = useModalControl("reference-target", controls);
  const registerDescription = useModalControl("reference-description", controls);
  useModalControlTraversal(controls, props.onCancel);
  const verb = props.remove ? "Remove Reference" : "Add Reference";
  return (
    <ModalShell>
      <ModalBody>
        <text>{verb}</text>
        <Input
          id="reference-name"
          ref={registerName}
          focused
          value={name()}
          placeholder="Reference name"
          onInput={setName}
        />
        <Input
          id="reference-target"
          ref={registerTarget}
          focused={false}
          value={target()}
          placeholder="Target collection"
          onInput={setTarget}
        />
        {!props.remove && (
          <Input
            id="reference-description"
            ref={registerDescription}
            focused={false}
            value={description()}
            placeholder="Description"
            onInput={setDescription}
          />
        )}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <box flexDirection="column" gap={1} flexShrink={0}>
          <ModalCommand
            id="reference-cancel"
            controls={controls}
            record={modalCommand("reference.cancel", "Cancel", "Discard draft")}
            execute={props.onCancel}
          />
          <ModalCommand
            id="reference-review"
            intent="primary"
            controls={controls}
            record={modalCommand(
              "reference.review",
              props.pending ? "Reviewing" : `Review ${verb}`,
              "Preview this reference",
              !props.pending && !!name().trim() && !!target().trim(),
              false,
              props.pending
                ? "Wait for the current review to settle"
                : "Enter a reference name and target",
            )}
            execute={() => {
              const shared = {
                level: props.level,
                collection: props.collection,
                name: name().trim(),
              };
              props.onPreview(
                props.remove
                  ? {
                      kind: "reference-remove",
                      ...shared,
                      ...(props.expectedOwner ? { expectedOwner: props.expectedOwner } : {}),
                      expected: { collection: target().trim(), description: description().trim() },
                    }
                  : {
                      kind: "reference-add",
                      ...shared,
                      ...(props.expectedOwner ? { expectedOwner: props.expectedOwner } : {}),
                      target: target().trim(),
                      description: description().trim(),
                    },
              );
            }}
          />
        </box>
      </ModalBody>
    </ModalShell>
  );
}

export function LinkChangeOverlay(props: {
  readonly level: "global" | "project" | "local";
  readonly expectedOwner?: import("@skctl/core").ConfigDeclarationOwner;
  readonly collection: string;
  readonly target: string;
  readonly linked: boolean;
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onPreview: (
    intent: Extract<CollectionReview["intent"], { readonly kind: "link-change" }>,
  ) => void;
  readonly onCancel: () => void;
}) {
  const controls = createModalControlRegistry();
  const [target, setTarget] = createSignal(props.target);
  const registerTarget = useModalControl("link-target", controls);
  useModalControlTraversal(controls, props.onCancel);
  const verb = props.linked ? "Add Link" : "Remove Link";
  return (
    <ModalShell>
      <ModalBody>
        <text>{verb}</text>
        <Input
          id="link-target"
          ref={registerTarget}
          focused
          value={target()}
          placeholder="Target collection"
          onInput={setTarget}
        />
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <box flexDirection="column" gap={1} flexShrink={0}>
          <ModalCommand
            id="link-cancel"
            controls={controls}
            record={modalCommand("link.cancel", "Cancel", "Discard draft")}
            execute={props.onCancel}
          />
          <ModalCommand
            id="link-review"
            intent="primary"
            controls={controls}
            record={modalCommand(
              "link.review",
              props.pending ? "Reviewing" : `Review ${verb}`,
              "Preview link paths",
              !props.pending && !!target().trim(),
              false,
              props.pending ? "Wait for the current review to settle" : "Enter a target collection",
            )}
            execute={() =>
              props.onPreview({
                kind: "link-change",
                level: props.level,
                ...(props.expectedOwner ? { expectedOwner: props.expectedOwner } : {}),
                collection: props.collection,
                target: target().trim(),
                linked: props.linked,
              })
            }
          />
        </box>
      </ModalBody>
    </ModalShell>
  );
}
