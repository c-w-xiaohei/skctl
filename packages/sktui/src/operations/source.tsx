import { useTerminalDimensions } from "@opentui/solid";
import { SelectRenderable } from "@opentui/core";
import { Input } from "../ui/input";
import type { DiscoveryReview, SourceRemovalReview } from "../session";
import {
  createModalControlRegistry,
  useModalControl,
  useModalControlTraversal,
} from "../modal-controls";
import { DataList } from "../ui/data-list";
import { ModalBody, ModalCommand, modalCommand, ModalShell } from "./modal";

export function SourceSelectionOverlay(props: {
  readonly collection?: string;
  readonly review: DiscoveryReview;
  readonly installed: ReadonlySet<string>;
  readonly selected: readonly string[];
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onToggle: (path: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly onBack?: () => void;
}) {
  const controls = createModalControlRegistry();
  const terminal = useTerminalDimensions();
  const candidates = () =>
    props.review.observation.candidates
      .filter((candidate) =>
        `${candidate.name} ${candidate.path} ${candidate.description}`
          .toLowerCase()
          .includes(props.query.trim().toLowerCase()),
      )
      .map((candidate) => ({
        ...candidate,
        selectable: !props.installed.has(candidate.path),
      }));
  const registerSearch = useModalControl("source-operation-search", controls, 10);
  const registerCandidates = useModalControl("source-operation-selection", controls, 20);
  controls.intercept((event, current) => {
    if (
      event.name !== "space" ||
      current?.id !== "source-operation-selection" ||
      !(current instanceof SelectRenderable)
    )
      return false;
    event.preventDefault();
    event.stopPropagation();
    const candidate = candidates()[current.getSelectedIndex()];
    if (candidate?.selectable && !props.pending) props.onToggle(candidate.path);
    return true;
  });
  useModalControlTraversal(controls, () => (props.onBack ?? props.onCancel)());
  const choices = () =>
    candidates().map((candidate) => ({
      name: `${candidate.selectable ? (props.selected.includes(candidate.path) ? "[x]" : "[ ]") : "[-]"} ${candidate.selectable ? "Available" : "Installed"} ${candidate.name}`,
      description: candidate.selectable
        ? candidate.description
        : `${candidate.description} (not selectable)`,
      value: candidate.path,
    }));
  return (
    <ModalShell
      onMouseDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      <ModalBody
        controls={controls}
        header={
          <>
            <text
              height={1}
              wrapMode="none"
            >{`Find Skills: ${props.review.observation.source}`}</text>
          </>
        }
        footer={
          <box flexDirection="row" flexWrap="wrap" gap={1}>
            {props.onBack && (
              <ModalCommand
                id="source-operation-back"
                controls={controls}
                order={35}
                record={modalCommand(
                  "source-operation.back",
                  "Back",
                  "Keep the Collection draft",
                  !props.pending,
                )}
                execute={props.onBack}
              />
            )}
            <ModalCommand
              id="source-operation-submit"
              intent="primary"
              controls={controls}
              order={30}
              record={modalCommand(
                "source-operation.submit",
                `${props.pending ? "Applying" : "Install"} ${props.selected.length} Skills`,
                "Apply selected Skills",
                !props.pending && props.selected.length > 0,
              )}
              execute={props.onSubmit}
            />
            <ModalCommand
              id="source-operation-cancel"
              controls={controls}
              order={40}
              record={modalCommand(
                "source-operation.cancel",
                "Cancel",
                "Return without installing",
              )}
              execute={props.onCancel}
            />
          </box>
        }
      >
        <Input
          id="source-operation-search"
          ref={registerSearch}
          focused={false}
          placeholder="Search Skills"
          value={props.query}
          onInput={props.onQuery}
        />
        <DataList
          id="source-operation-selection"
          ref={registerCandidates}
          focused={true}
          height={Math.max(1, Math.min(candidates().length * 2, terminal().height - 7))}
          flexShrink={0}
          options={choices()}
          showDescription
          onSelect={(_index, option) => {
            const candidate = candidates().find((item) => item.path === option?.value);
            if (candidate?.selectable && !props.pending) props.onToggle(candidate.path);
          }}
        />
        <text wrapMode="word">{`Source: ${props.review.observation.source}`}</text>
        {props.collection && <text wrapMode="word">{`For Collection: ${props.collection}`}</text>}
        <text>{`${props.selected.length} selected`}</text>
        {props.review.observation.exactRevision && (
          <text wrapMode="word">{`Revision: ${props.review.observation.exactRevision}`}</text>
        )}
        {!candidates().length && (
          <text wrapMode="word">
            {props.query.trim()
              ? "No matching Skills. Change the search to see other candidates."
              : "No Skills found in this Source. Check its address and Source root."}
          </text>
        )}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
      </ModalBody>
    </ModalShell>
  );
}

export function SourceObservationOverlay(props: {
  readonly title: "Discovering Skills" | "Observing Config";
  readonly source: string;
  readonly cancelling: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onRetry: () => void;
  readonly onBack?: () => void;
  readonly onClose: () => void;
}) {
  const controls = createModalControlRegistry();
  useModalControlTraversal(controls, () => (props.onBack ?? props.onClose)());
  const failed = () => !!props.error;
  return (
    <ModalShell id="source-observation-overlay">
      <ModalBody
        controls={controls}
        header={<text>{props.title}</text>}
        footer={
          <box flexDirection="row" flexWrap="wrap" gap={1}>
            {props.onBack && (
              <ModalCommand
                id="source-observation-back"
                controls={controls}
                record={modalCommand(
                  "source-observation.back",
                  "Back",
                  "Keep the Collection draft",
                  !props.cancelling,
                )}
                execute={props.onBack}
              />
            )}
            <ModalCommand
              id="source-observation-progress"
              controls={controls}
              record={modalCommand("source-observation.close", "Cancel", "End this task")}
              initialFocus
              execute={props.onClose}
            />
            {failed() && !props.cancelling && (
              <ModalCommand
                id="source-observation-retry"
                controls={controls}
                record={modalCommand(
                  "source-observation.retry",
                  "Retry",
                  "Observe this Source again",
                )}
                execute={props.onRetry}
              />
            )}
          </box>
        }
      >
        <text>{`Source: ${props.source}`}</text>
        <text>
          {props.cancelling
            ? "Cancelling observation"
            : failed()
              ? "Observation failed"
              : "Observing"}
        </text>
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        {failed() && props.title === "Discovering Skills" && (
          <text>Source remains registered. Retry discovery when ready.</text>
        )}
      </ModalBody>
    </ModalShell>
  );
}

export function SourceRemovalOverlay(props: {
  readonly review: SourceRemovalReview;
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onRepair: (
    action: "rebind" | "uninstall",
    address: { readonly source: string; readonly path: string },
  ) => void;
}) {
  const controls = createModalControlRegistry();
  useModalControlTraversal(controls, props.onCancel);
  const blocked = () => !props.review.impact.allowed;
  return (
    <ModalShell
      onMouseDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      <ModalBody
        controls={controls}
        header={
          <text height={1} wrapMode="none">
            {blocked() ? "Remove Source: impact review" : "Remove Source"}
          </text>
        }
        footer={
          <box flexDirection="row" gap={1} flexShrink={0}>
            <ModalCommand
              id="source-removal-choice"
              controls={controls}
              record={modalCommand("source-removal.cancel", "Cancel", "Keep this Source")}
              initialFocus
              execute={props.onCancel}
            />
            {!blocked() && (
              <ModalCommand
                id="source-removal-confirm"
                intent="primary"
                controls={controls}
                record={modalCommand(
                  "source-removal.confirm",
                  props.pending ? "Removing..." : "Remove Source",
                  "Remove the direct declaration",
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
        <text>{`Source: ${props.review.intent.source}`}</text>
        <text>{`Config: ${props.review.intent.owner.level} (${props.review.intent.owner.file})`}</text>
        {blocked() ? (
          <>
            <text>Removal is blocked by installed Skills:</text>
            {props.review.impact.installed.map((address) => (
              <text>{`${address.source}/${address.path}`}</text>
            ))}
          </>
        ) : (
          <text>Remove this direct Source declaration?</text>
        )}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <box flexDirection="column" gap={1} flexShrink={0}>
          {blocked() &&
            props.review.impact.repairs.flatMap((repair, index) =>
              repair.actions.map((action) => (
                <ModalCommand
                  id={`source-removal-repair-${index}-${action}`}
                  controls={controls}
                  record={modalCommand(
                    `source-removal.repair.${index}.${action}`,
                    `${action === "rebind" ? "Rebind" : "Uninstall"} ${repair.address.source}/${repair.address.path}`,
                    `Open ${action} repair`,
                  )}
                  execute={() => props.onRepair(action, repair.address)}
                />
              )),
            )}
        </box>
      </ModalBody>
    </ModalShell>
  );
}
