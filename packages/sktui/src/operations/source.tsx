import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createSignal, Show, type JSX } from "solid-js";
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

/** Discovery, candidate review and installation occupy one stable task frame. */
export function SourceAcquisitionFrame(props: {
  readonly source: string;
  readonly observing?: boolean;
  readonly collection?: string;
  readonly children: JSX.Element;
}) {
  return (
    <ModalShell transparent>
      <ModalBody
        maxWidth={120}
        maxHeight={props.observing ? 10 : undefined}
        scroll={false}
        header={
          <>
            <text>Install Skills</text>
            <text height={1} wrapMode="none">{`Source: ${props.source}`}</text>
            <Show when={props.collection}>
              <text height={1} wrapMode="none">{`For Collection: ${props.collection}`}</text>
            </Show>
          </>
        }
      >
        {props.children}
      </ModalBody>
    </ModalShell>
  );
}

export function SourceSelectionOverlay(props: {
  readonly inline?: boolean;
  readonly collection?: string;
  readonly review: DiscoveryReview;
  readonly installed: ReadonlySet<string>;
  readonly selected: readonly string[];
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly pending: boolean;
  readonly cancelling?: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onToggle: (path: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly onBack?: () => void;
}) {
  const controls = createModalControlRegistry();
  const terminal = useTerminalDimensions();
  const renderer = useRenderer();
  const [showInstalled, setShowInstalled] = createSignal(false);
  const [currentPath, setCurrentPath] = createSignal<string>();
  const [reading, setReading] = createSignal(false);
  const wide = () => terminal().width >= 100;
  const candidates = () =>
    props.review.observation.candidates
      .filter((candidate) => showInstalled() || !props.installed.has(candidate.path))
      .filter((candidate) =>
        `${candidate.name} ${candidate.path} ${candidate.description}`
          .toLowerCase()
          .includes(props.query.trim().toLowerCase()),
      )
      .map((candidate) => ({
        ...candidate,
        selectable: !props.installed.has(candidate.path),
      }));
  const currentIndex = () =>
    Math.max(
      0,
      candidates().findIndex((item) => item.path === currentPath()),
    );
  const current = () => candidates()[currentIndex()];
  const hiddenChecks = () =>
    props.selected.filter((path) => !candidates().some((item) => item.path === path)).length;
  const back = () => {
    if (reading()) {
      setReading(false);
      queueMicrotask(() => renderer.root.findDescendantById("source-operation-selection")?.focus());
    } else (props.onBack ?? props.onCancel)();
  };
  const registerSearch = useModalControl(
    "source-operation-search",
    controls,
    10,
    () => wide() || !reading(),
  );
  const registerCandidates = useModalControl(
    "source-operation-selection",
    controls,
    20,
    () => wide() || !reading(),
  );
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
  useModalControlTraversal(controls, back);
  const choices = () =>
    candidates().map((candidate) => ({
      name: `${candidate.selectable ? (props.selected.includes(candidate.path) ? "[x]" : "[ ]") : "   "} ${candidate.name}${candidate.selectable ? "" : "  Installed"}`,
      description: "",
      value: candidate.path,
    }));
  return (
    <ModalShell transparent inline={props.inline}>
      <ModalBody
        controls={controls}
        scroll={false}
        inline={props.inline}
        maxWidth={props.inline ? undefined : 120}
        header={
          !props.inline && (
            <>
              <text height={1} wrapMode="none">
                Install Skills
              </text>
              <text height={1} wrapMode="none">{`Source: ${props.review.observation.source}`}</text>
              <Show when={props.collection}>
                <text height={1} wrapMode="none">{`For Collection: ${props.collection}`}</text>
              </Show>
            </>
          )
        }
        footer={
          <box flexDirection="row" flexWrap="wrap" gap={1}>
            {(props.onBack || reading()) && (
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
                execute={back}
              />
            )}
            <ModalCommand
              id="source-operation-submit"
              intent="primary"
              controls={controls}
              order={30}
              record={modalCommand(
                "source-operation.submit",
                `${props.pending ? "Installing" : "Install"} ${props.selected.length} ${props.selected.length === 1 ? "Skill" : "Skills"}`,
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
                props.cancelling ? "Stopping…" : props.pending ? "Stop" : "Cancel",
                props.pending ? "Request installation to stop" : "Return without installing",
                !props.cancelling,
              )}
              execute={props.onCancel}
            />
          </box>
        }
      >
        <Show when={wide() || !reading()}>
          <box flexDirection="row" flexShrink={0} gap={1}>
            <text>Search</text>
            <Input
              id="source-operation-search"
              ref={registerSearch}
              focused={false}
              flexGrow={1}
              value={props.query}
              onInput={(value) => {
                if (!props.pending) props.onQuery(value);
              }}
            />
            <ModalCommand
              id="source-operation-show-installed"
              controls={controls}
              order={15}
              record={modalCommand(
                "source-operation.show-installed",
                showInstalled() ? "Hide installed" : "Show installed",
                "Filter candidates",
                !props.pending,
              )}
              execute={() => setShowInstalled((value) => !value)}
            />
          </box>
        </Show>
        <box flexDirection="row" flexGrow={1} minHeight={0}>
          <box flexGrow={1} minWidth={0} visible={wide() || !reading()}>
            <DataList
              id="source-operation-selection"
              ref={registerCandidates}
              focused={true}
              flexGrow={1}
              minHeight={1}
              options={choices()}
              selectedIndex={currentIndex()}
              showDescription={false}
              onChange={(_index, option) => option && setCurrentPath(option.value)}
              onRowPress={(_event, row) => {
                if (row.x < 5) {
                  const candidate = candidates()[row.index];
                  if (candidate?.selectable && !props.pending) props.onToggle(candidate.path);
                  return true;
                }
                return false;
              }}
              onSelect={() => {
                if (!current()) return;
                if (!wide()) setReading(true);
                queueMicrotask(() =>
                  renderer.root.findDescendantById("source-operation-detail")?.focus(),
                );
              }}
            />
            {!candidates().length && (
              <text wrapMode="word">
                {props.query.trim()
                  ? "No matching Skills. Change the search to see other candidates."
                  : props.review.observation.candidates.length && !showInstalled()
                    ? "All Skills are installed. Choose Show installed to view them."
                    : "No Skills found in this Source. Check its address and Source root."}
              </text>
            )}
          </box>
          <Show when={(wide() || reading()) && current()}>
            <scrollbox
              id="source-operation-detail"
              focusable
              flexGrow={1}
              flexBasis={wide() && !reading() ? Math.floor(terminal().width * 0.4) : undefined}
              minWidth={0}
              scrollX={false}
              ref={useModalControl("source-operation-detail", controls, 25)}
            >
              <text wrapMode="word">
                <b>{current()?.name}</b>
              </text>
              <text wrapMode="word">
                {current()?.description || "This Skill has no description."}
              </text>
              <text wrapMode="word">{`Path: ${current()?.path}`}</text>
              <Show when={current() && !current()!.selectable}>
                <text>Installed. No installation needed.</text>
              </Show>
              <Show when={props.error}>
                <text wrapMode="word">{`Installation failed. ${props.error?.message}`}</text>
              </Show>
            </scrollbox>
          </Show>
        </box>
        <box flexDirection="row" flexShrink={0} gap={1}>
          <text>{`${props.selected.length} selected${hiddenChecks() ? ` (${hiddenChecks()} hidden)` : ""}`}</text>
          <Show when={props.selected.length}>
            <ModalCommand
              id="source-operation-clear"
              controls={controls}
              order={28}
              record={modalCommand(
                "source-operation.clear",
                "Clear",
                "Clear all checked Skills",
                !props.pending,
              )}
              execute={() => [...props.selected].forEach(props.onToggle)}
            />
          </Show>
        </box>
        {props.error && (
          <ModalCommand
            id="source-operation-error"
            controls={controls}
            order={29}
            record={modalCommand(
              "source-operation.error",
              "View installation error…",
              "Read failure details",
            )}
            execute={() => {
              setReading(true);
              queueMicrotask(() =>
                renderer.root.findDescendantById("source-operation-detail")?.focus(),
              );
            }}
          />
        )}
      </ModalBody>
    </ModalShell>
  );
}

export function SourceObservationOverlay(props: {
  readonly inline?: boolean;
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
    <ModalShell id="source-observation-overlay" transparent inline={props.inline}>
      <ModalBody
        controls={controls}
        inline={props.inline}
        maxWidth={props.inline ? undefined : 120}
        maxHeight={props.inline || props.error ? undefined : 9}
        header={
          !props.inline && (
            <>
              <text>
                {props.title === "Discovering Skills" ? "Install Skills" : "Observing Config"}
              </text>
              <text height={1} wrapMode="none">{`Source: ${props.source}`}</text>
            </>
          )
        }
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
              record={modalCommand(
                "source-observation.close",
                props.cancelling ? "Stopping…" : failed() ? "Cancel" : "Stop",
                "End this task",
                !props.cancelling,
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
                  "Find Skills in this Source again",
                )}
                execute={props.onRetry}
              />
            )}
          </box>
        }
      >
        <text wrapMode="word">
          {props.cancelling
            ? "Stopping. Waiting for the current operation to finish."
            : failed()
              ? props.title === "Discovering Skills"
                ? "Could not find Skills. Retry or return to your workspace."
                : "Could not read this Config. Retry or return to your workspace."
              : props.title === "Discovering Skills"
                ? "Finding Skills in this Source…"
                : "Reading Config declarations…"}
        </text>
        {props.error && <text wrapMode="word">{props.error.message}</text>}
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
