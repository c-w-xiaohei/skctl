import { SelectRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal } from "solid-js";
import type { CollectionReview } from "../effects";
import {
  createModalControlRegistry,
  useModalControl,
  useModalControlTraversal,
} from "../modal-controls";
import { DataList } from "../ui/data-list";
import { ModalBody, ModalCommand, modalCommand, ModalShell } from "./modal";

export function CollectionUseOverlay(props: {
  readonly level: "global" | "project" | "local";
  /** Exact direct Use at this host level, not effective roots or the cursor item. */
  readonly collections: readonly string[];
  readonly availableCollections: readonly { readonly id: string; readonly description?: string }[];
  readonly inventoryUnavailable?: boolean;
  readonly currentCollection?: string;
  readonly onCurrentChange?: (collection: string) => void;
  readonly onChange?: (collections: readonly string[]) => void;
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onPreview: (
    intent: Extract<CollectionReview["intent"], { readonly kind: "collection-use" }>,
  ) => void;
  readonly onCancel: () => void;
}) {
  const terminal = useTerminalDimensions();
  const controls = createModalControlRegistry();
  const initialCollections = [...props.collections];
  const retainedChoices = [
    ...new Set([
      ...initialCollections,
      ...(props.currentCollection ? [props.currentCollection] : []),
    ]),
  ];
  const [collections, setCollections] = createSignal(initialCollections);
  const [currentCollection, setCurrentCollection] = createSignal(
    props.currentCollection ?? props.availableCollections[0]?.id ?? initialCollections[0],
  );
  const registerCollections = useModalControl("collection-use-values", controls);
  useModalControlTraversal(controls, props.onCancel);
  // Keep unavailable current IDs in the choice list even after unchecking them,
  // so removal is deliberate and reversible within the draft.
  const choices = createMemo(() => [
    ...props.availableCollections.map((item) => ({ ...item, unavailable: false })),
    ...[
      ...new Set([
        ...retainedChoices,
        ...collections(),
        ...(currentCollection() ? [currentCollection()!] : []),
      ]),
    ]
      .filter((id) => !props.availableCollections.some((item) => item.id === id))
      .map((id) => ({ id, description: undefined, unavailable: true })),
  ]);
  const currentIndex = () =>
    Math.max(
      0,
      choices().findIndex((item) => item.id === currentCollection()),
    );
  const current = () => choices()[currentIndex()];
  const toggle = (id: string) => {
    if (props.pending) return;
    const values = collections();
    const next = values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
    setCollections(next);
    props.onChange?.(next);
  };
  let list: SelectRenderable | undefined;
  return (
    <ModalShell>
      <ModalBody controls={controls}>
        <text>Set Collection Use</text>
        <text>{`Config level: ${props.level} · ${collections().length} selected`}</text>
        <DataList
          id="collection-use-values"
          ref={(value: SelectRenderable) => {
            list = value;
            registerCollections(value);
          }}
          focused
          height={Math.max(1, Math.min(choices().length, 8, terminal().height - 12))}
          flexShrink={0}
          selectedIndex={currentIndex()}
          showDescription={false}
          keyBindings={[{ name: "space", action: "select-current" }]}
          options={choices().map((item) => ({
            name: `${collections().includes(item.id) ? "[x]" : "[ ]"} ${item.unavailable ? "Unavailable: " : ""}${item.id}`,
            description: item.description ?? "",
            value: item.id,
          }))}
          onChange={(_index, option) => {
            if (!option) return;
            setCurrentCollection(option.value);
            props.onCurrentChange?.(option.value);
          }}
          onSelect={(_index, option) => option && toggle(option.value)}
          onRowPress={(_event, hit) => {
            list?.setSelectedIndex(hit.index);
            // Only the explicit check gutter toggles. Ordinary row clicks move
            // the current choice without changing the checked mutation set.
            if (hit.x >= 3 && hit.x <= 5) {
              const item = choices()[hit.index];
              if (item) toggle(item.id);
            }
            return true;
          }}
        />
        {current() && <text wrapMode="word">{`Collection: ${current()!.id}`}</text>}
        {current()?.unavailable && (
          <text wrapMode="word">
            Unavailable in the effective Collections; uncheck to remove from this Use.
          </text>
        )}
        {current()?.description && (
          <text wrapMode="word" maxHeight={2}>
            {current()!.description}
          </text>
        )}
        {props.inventoryUnavailable && (
          <text wrapMode="word">
            Effective Collections unavailable. Core will validate the proposed Use.
          </text>
        )}
        {!choices().length && (
          <text>No available Collections. An empty Use can still be reviewed.</text>
        )}
        {!collections().length && (
          <text>No Collections selected — review writes an explicit empty Use.</text>
        )}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <box flexDirection="column" gap={1} flexShrink={0}>
          <ModalCommand
            id="collection-use-cancel"
            controls={controls}
            record={modalCommand("collection-use.cancel", "Cancel", "Discard draft")}
            execute={props.onCancel}
          />
          <ModalCommand
            id="collection-use-review"
            intent="primary"
            controls={controls}
            record={modalCommand(
              "collection-use.review",
              props.pending ? "Reviewing" : "Review Collection Use",
              "Preview disclosure",
              !props.pending,
              false,
              props.pending ? "Wait for the current review to settle" : undefined,
            )}
            execute={() =>
              props.onPreview({
                kind: "collection-use",
                level: props.level,
                collections: [...collections()],
              })
            }
          />
        </box>
      </ModalBody>
    </ModalShell>
  );
}
