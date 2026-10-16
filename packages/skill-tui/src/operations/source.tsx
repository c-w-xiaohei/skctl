import { useTerminalDimensions } from "@opentui/solid";
import type { DiscoveryReview, SourceRemovalReview, UpdateReview } from "../effects";
import {
  createModalControlRegistry,
  useModalControl,
  useModalControlTraversal,
} from "../modal-controls";
import { DataList } from "../ui/data-list";
import { ModalBody, ModalCommand, modalCommand, ModalShell } from "./modal";

export function SourceSelectionOverlay(props: {
  readonly review: DiscoveryReview | UpdateReview;
  readonly installed: ReadonlySet<string>;
  readonly selected: readonly string[];
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onToggle: (path: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}) {
  const controls = createModalControlRegistry();
  const terminal = useTerminalDimensions();
  const discovery = props.review.kind === "discovery";
  const candidates =
    props.review.kind === "discovery"
      ? props.review.observation.candidates.map((candidate) => ({
          ...candidate,
          category: "Available",
          selectable: !props.installed.has(candidate.path),
        }))
      : [
          ...props.review.observation.changed.map((candidate) => ({
            ...candidate,
            category: "Changed",
            selectable: true,
          })),
          ...props.review.observation.added.map((candidate) => ({
            ...candidate,
            category: "New",
            selectable: false,
          })),
          ...props.review.observation.removed.map((candidate) => ({
            ...candidate,
            category: "Removed",
            selectable: false,
          })),
          ...props.review.observation.unchanged.map((candidate) => ({
            ...candidate,
            category: "Unchanged",
            selectable: false,
          })),
        ];
  const selectedPath = props.review.kind === "update" ? props.review.selectedPath : undefined;
  const visibleCandidates = selectedPath
    ? candidates.filter((candidate) => candidate.path === selectedPath)
    : candidates;
  const registerCandidates = useModalControl("source-operation-selection", controls);
  useModalControlTraversal(controls, props.onCancel);
  const choices = () =>
    visibleCandidates.map((candidate) => ({
      name: `${candidate.selectable ? (props.selected.includes(candidate.path) ? "[x]" : "[ ]") : "[-]"} ${candidate.category} ${candidate.name}`,
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
      <ModalBody>
        <text>{discovery ? "Add Skills" : "Check Updates"}</text>
        <text>{`Source: ${props.review.observation.source}`}</text>
        {props.review.observation.exactRevision && (
          <text>{`Revision: ${props.review.observation.exactRevision}`}</text>
        )}
        <DataList
          id="source-operation-selection"
          ref={registerCandidates}
          focused={true}
          height={Math.max(1, Math.min(visibleCandidates.length * 2, terminal().height - 12))}
          options={choices()}
          showDescription
          onSelect={(_index, option) => {
            const candidate = visibleCandidates.find((item) => item.path === option?.value);
            if (candidate?.selectable && !props.pending) props.onToggle(candidate.path);
          }}
        />
        <box flexDirection="column" gap={1} flexShrink={0}>
          <ModalCommand
            id="source-operation-cancel"
            controls={controls}
            record={modalCommand("source-operation.cancel", "Cancel", "Keep this selection")}
            execute={props.onCancel}
          />
          <ModalCommand
            id="source-operation-submit"
            intent="primary"
            controls={controls}
            record={modalCommand(
              "source-operation.submit",
              `${props.pending ? "Applying" : discovery ? "Install" : "Update"} ${props.selected.length} Skills`,
              "Apply selected Skills",
              !props.pending && props.selected.length > 0,
              false,
              props.pending
                ? "Wait for the current operation to settle"
                : "Select at least one eligible Skill",
            )}
            execute={props.onSubmit}
          />
        </box>
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <text>
          {discovery
            ? "Install adds no Memberships or Agent disclosure"
            : "New roots install through Add Skills; removed roots are retained"}
        </text>
      </ModalBody>
    </ModalShell>
  );
}

export function SourceObservationOverlay(props: {
  readonly title: "Discovering Skills" | "Checking Updates" | "Observing Config";
  readonly source: string;
  readonly cancelling: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onRetry: () => void;
  readonly onClose: () => void;
}) {
  const controls = createModalControlRegistry();
  useModalControlTraversal(controls, props.onClose);
  const failed = () => !!props.error;
  return (
    <ModalShell id="source-observation-overlay">
      <ModalBody>
        <text>{props.title}</text>
        <text>{`Source: ${props.source}`}</text>
        <text>
          {props.cancelling
            ? "Cancelling observation"
            : failed()
              ? "Observation failed"
              : "Observing"}
        </text>
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <box flexDirection="column" gap={1} flexShrink={0}>
          <ModalCommand
            id="source-observation-progress"
            controls={controls}
            record={modalCommand(
              "source-observation.close",
              failed() && !props.cancelling ? "Close" : "Cancel",
              "Selected Source",
            )}
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
        <text>{failed() && !props.cancelling ? "Escape Close" : "Escape Cancel"}</text>
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
  const blocked = !props.review.impact.allowed;
  return (
    <ModalShell
      onMouseDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      <ModalBody controls={controls}>
        <text>{blocked ? "Remove Source: impact review" : "Remove Source"}</text>
        <text>{`Source: ${props.review.intent.source}`}</text>
        <text>{`Config: ${props.review.intent.owner.level} (${props.review.intent.owner.file})`}</text>
        {blocked ? (
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
          <ModalCommand
            id="source-removal-choice"
            controls={controls}
            record={modalCommand("source-removal.cancel", "Cancel", "Keep this Source")}
            initialFocus
            execute={props.onCancel}
          />
          {blocked ? (
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
            )
          ) : (
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
        <text>↑↓ move between controls · Enter select · Esc close</text>
        <text>Cancel is selected by default</text>
      </ModalBody>
    </ModalShell>
  );
}
