import { InputRenderable, SelectRenderable } from "@opentui/core";
import { createSignal, onMount } from "solid-js";
import type { CollectionReview } from "../session";
import type {
  ConfigDeclarationOwner,
  CreateCollectionRequest,
  SetCollectionContentRequest,
} from "@skctl/core";
import {
  createModalControlRegistry,
  useModalControl,
  useModalControlTraversal,
} from "../modal-controls";
import { DataList } from "../ui/data-list";
import { Input } from "../ui/input";
import { ModalBody, ModalCommand, modalCommand, ModalShell } from "./modal";

export function CollectionRenameOverlay(props: {
  readonly collection: string;
  readonly target: string;
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onChange: (target: string) => void;
  readonly onPreview: () => void;
  readonly onCancel: () => void;
}) {
  const controls = createModalControlRegistry();
  useModalControlTraversal(controls, props.onCancel);
  return (
    <ModalShell>
      <ModalBody
        controls={controls}
        header={<text>{`Rename ${props.collection}`}</text>}
        footer={
          <box flexDirection="row" gap={1}>
            <ModalCommand
              id="collection-rename-preview"
              controls={controls}
              order={20}
              intent="primary"
              record={modalCommand(
                "collection-rename.preview",
                "Preview",
                props.collection,
                !props.pending && !!props.target.trim() && props.target.trim() !== props.collection,
              )}
              execute={props.onPreview}
            />
            <ModalCommand
              id="collection-rename-cancel"
              controls={controls}
              order={30}
              record={modalCommand("collection-rename.cancel", "Cancel", "Discard draft")}
              execute={props.onCancel}
            />
          </box>
        }
      >
        <text>New Collection ID</text>
        <Input
          id="collection-rename-target"
          ref={useModalControl("collection-rename-target", controls, 10)}
          focused
          value={props.target}
          onInput={props.onChange}
        />
        {props.error && (
          <text wrapMode="word">{`${props.error.code}: ${props.error.message}`}</text>
        )}
      </ModalBody>
    </ModalShell>
  );
}

export function CollectionContentOverlay(props: {
  readonly collection: string;
  readonly owner: ConfigDeclarationOwner;
  readonly owners?: readonly ConfigDeclarationOwner[];
  readonly description?: string;
  readonly instructions?: string;
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onSave: (request: SetCollectionContentRequest) => void;
  readonly onCancel: () => void;
}) {
  const controls = createModalControlRegistry();
  const [owner, setOwner] = createSignal(props.owner);
  const [description, setDescription] = createSignal(props.description ?? "");
  const [changedDescription, setChangedDescription] = createSignal(false);
  const [changedInstructions, setChangedInstructions] = createSignal(false);
  let instructions: import("@opentui/core").TextareaRenderable | undefined;
  useModalControlTraversal(controls, props.onCancel);
  return (
    <ModalShell>
      <ModalBody
        controls={controls}
        header={<text>{`Edit ${props.collection}`}</text>}
        footer={
          <box flexDirection="row" gap={1} flexWrap="wrap">
            <ModalCommand
              id="collection-content-save"
              controls={controls}
              order={30}
              intent="primary"
              record={modalCommand(
                "collection-content.save",
                props.pending ? "Saving…" : "Save",
                "Collection description and instructions",
                !props.pending && (changedDescription() || changedInstructions()),
              )}
              execute={() =>
                props.onSave({
                  level: owner().level,
                  collection: props.collection,
                  expectedOwner: owner(),
                  ...(changedDescription() ? { description: description() || null } : {}),
                  ...(changedInstructions()
                    ? { instructions: instructions?.plainText || null }
                    : {}),
                })
              }
            />
            <ModalCommand
              id="collection-content-cancel"
              controls={controls}
              order={40}
              record={modalCommand("collection-content.cancel", "Cancel", "Discard edits")}
              execute={props.onCancel}
            />
          </box>
        }
      >
        {(props.owners?.length ?? 0) > 1 && (
          <DataList
            id="collection-content-owner"
            height={props.owners!.length}
            ref={useModalControl("collection-content-owner", controls, 0)}
            focused={false}
            showDescription={false}
            options={props.owners!.map((value) => ({
              name: `${value.level}: ${value.file}`,
              description: "Save location",
              value,
            }))}
            onChange={(_index, option) => option && setOwner(option.value)}
          />
        )}
        <text wrapMode="word">{`Save to ${owner().level}: ${owner().file}`}</text>
        <text>Description</text>
        <Input
          id="collection-content-description"
          ref={useModalControl("collection-content-description", controls, 10)}
          focused
          value={description()}
          onInput={(value) => {
            setDescription(value);
            setChangedDescription(value !== (props.description ?? ""));
          }}
        />
        <text>Instructions</text>
        <text wrapMode="word">
          Current effective content; only edited fields are written to this location.
        </text>
        <textarea
          id="collection-content-instructions"
          height={8}
          initialValue={props.instructions ?? ""}
          onContentChange={() =>
            setChangedInstructions(instructions?.plainText !== (props.instructions ?? ""))
          }
          ref={(target) => {
            instructions = target;
            useModalControl("collection-content-instructions", controls, 20)(target);
          }}
        />
        {props.error && (
          <text wrapMode="word">{`${props.error.code}: ${props.error.message}`}</text>
        )}
      </ModalBody>
    </ModalShell>
  );
}

export interface CollectionCreateDraft {
  readonly collection: string;
  readonly description: string;
  readonly level: "global" | "project" | "local";
}

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
    readonly initialDraft?: CollectionCreateDraft;
    readonly onBack?: (draft: CollectionCreateDraft) => void;
    readonly configFile?: (level: "global" | "project" | "local") => string | undefined;
    readonly fixed?: boolean;
    readonly pending: boolean;
    readonly error?: { readonly code: string; readonly message: string };
    readonly onSubmit: (value: CreateCollectionRequest) => void;
    readonly onCancel: () => void;
  },
) {
  const controls = createModalControlRegistry();
  const allowedLevels = props.allowedLevels ?? [];
  const selectable = allowedLevels.length > 0;
  const initialLevel =
    props.level ??
    (props.initialDraft && allowedLevels.includes(props.initialDraft.level)
      ? props.initialDraft.level
      : allowedLevels.includes("project")
        ? "project"
        : allowedLevels[0]!);
  const [collection, setCollection] = createSignal(
    props.fixed ? props.collection : (props.initialDraft?.collection ?? props.collection),
  );
  const [description, setDescription] = createSignal(props.initialDraft?.description ?? "");
  const [level, setLevel] = createSignal(initialLevel);
  const registerLevel = useModalControl("collection-create-level", controls, 10);
  const registerId = useModalControl("collection-create-id", controls, 20);
  const back = () =>
    props.onBack
      ? props.onBack({ collection: collection(), description: description(), level: level() })
      : props.onCancel();
  useModalControlTraversal(controls, back);
  let levelChoice: SelectRenderable | undefined;
  let idInput: InputRenderable | undefined;
  onMount(() => queueMicrotask(() => (selectable ? levelChoice : idInput)?.focus()));
  return (
    <ModalShell>
      <ModalBody
        controls={controls}
        header={<text>Create Collection</text>}
        footer={
          <box flexDirection="row" gap={1} flexWrap="wrap">
            {props.onBack && (
              <ModalCommand
                id="collection-create-back"
                controls={controls}
                order={35}
                record={modalCommand(
                  "collection-create.back",
                  "Back",
                  "Keep creation draft",
                  !props.pending,
                )}
                execute={back}
              />
            )}
            <ModalCommand
              id="collection-create-submit"
              intent="primary"
              controls={controls}
              order={40}
              record={modalCommand(
                "collection-create.submit",
                props.pending ? "Creating" : "Create",
                "Create this collection",
                !props.pending && !!collection().trim(),
                false,
                props.pending ? "Wait for creation to settle" : "Enter a Collection ID",
              )}
              execute={() =>
                props.onSubmit({
                  level: level()!,
                  collection: collection().trim(),
                  ...(description().trim() ? { description: description().trim() } : {}),
                })
              }
            />
            <ModalCommand
              id="collection-create-cancel"
              controls={controls}
              order={50}
              record={modalCommand("collection-create.cancel", "Cancel", "Discard draft")}
              initialFocus={props.fixed && !selectable}
              execute={props.onCancel}
            />
          </box>
        }
      >
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
        <text>Description (optional)</text>
        <Input
          id="collection-create-description"
          ref={useModalControl("collection-create-description", controls, 30)}
          value={description()}
          onInput={setDescription}
        />
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <text>{`Tab switches controls. Enter activates. Esc ${props.onBack ? "goes back" : "discards the draft"}.`}</text>
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
      <ModalBody
        controls={controls}
        header={<text>Copy Skills from Collection</text>}
        footer={
          <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
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
                "Preview copy",
                "Preview all-or-none import",
                !props.pending && !!from().trim() && !!into().trim(),
                false,
                props.pending
                  ? "Wait for the current review to settle"
                  : "Enter both collection IDs",
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
        }
      >
        <text>{`Save to ${props.level}`}</text>
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
  const verb = props.remove ? "Remove Collection entry" : "Add Collection entry";
  return (
    <ModalShell>
      <ModalBody
        controls={controls}
        header={<text>{verb}</text>}
        footer={
          <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
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
                props.pending ? "Reviewing" : "Preview",
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
                        expected: {
                          collection: target().trim(),
                          description: description().trim(),
                        },
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
        }
      >
        <text>{`Collection: ${props.collection}\nConfiguration: ${props.level}`}</text>
        <Input
          id="reference-name"
          ref={registerName}
          focused
          value={name()}
          placeholder="Entry name"
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
  const verb = props.linked ? "Include Collection" : "Stop including Collection";
  return (
    <ModalShell>
      <ModalBody
        controls={controls}
        header={<text>{verb}</text>}
        footer={
          <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
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
                props.pending ? "Reviewing" : "Preview",
                "Preview link paths",
                !props.pending && !!target().trim(),
                false,
                props.pending
                  ? "Wait for the current review to settle"
                  : "Enter a target collection",
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
        }
      >
        <text>{`Collection: ${props.collection}\nConfiguration: ${props.level}`}</text>
        <Input
          id="link-target"
          ref={registerTarget}
          focused
          value={target()}
          placeholder="Target collection"
          onInput={setTarget}
        />
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
      </ModalBody>
    </ModalShell>
  );
}
