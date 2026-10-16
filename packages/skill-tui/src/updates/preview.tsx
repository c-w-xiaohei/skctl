/** @jsxImportSource @opentui/solid */
import {
  DiffRenderable,
  parseColor,
  type ScrollBoxRenderable,
  type Renderable,
} from "@opentui/core";
import { extend, useRenderer, useTerminalDimensions } from "@opentui/solid";
import type { ManagementCapability, UpdateFileChange, UpdatePreview } from "@skill-cli/core";
import { createTwoFilesPatch } from "diff";
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { FocusRegistry } from "../focus";
import { isPlainNavKey, type NavKey } from "../navigation";
import { usePageReturn } from "../page-navigation";
import type { CommandRecord, CommandRegistration, DispatchResult, FocusOwner } from "../types";
import { Button } from "../ui/button";
import { DataList } from "../ui/data-list";
import { useTheme } from "../ui/use-theme";
import { tint } from "../ui/theme";

// Native Diff is built in, but 0.5.14 omits its Solid prop declaration.
// Use Solid's public extension API rather than casting the component props.
extend({ skill_update_diff: DiffRenderable });
declare module "@opentui/solid" {
  interface OpenTUIComponents {
    skill_update_diff: typeof DiffRenderable;
  }
}

export type UpdatePreviewRequest = Parameters<ManagementCapability["previewUpdate"]>[0];
export interface SkillUpdatePreviewProps {
  readonly request: UpdatePreviewRequest;
  readonly previewUpdate?: ManagementCapability["previewUpdate"];
  readonly unavailableReason?: string;
  readonly prefix: string;
  readonly focusRegistry?: FocusRegistry;
  readonly registerCommand?: CommandRegistration;
  readonly onBack: () => void;
}

/** One user-opened comparison owns its request, file cursor and cancellable read. */
export function SkillUpdatePreview(props: SkillUpdatePreviewProps) {
  const terminal = useTerminalDimensions(),
    theme = useTheme();
  const renderer = useRenderer();
  const [preview, setPreview] = createSignal<UpdatePreview>();
  const [error, setError] = createSignal(props.unavailableReason);
  const [loading, setLoading] = createSignal(!props.unavailableReason);
  const [index, setIndex] = createSignal(0);
  const controller = new AbortController();
  let live = true;
  let root: Renderable | undefined;
  let content: ScrollBoxRenderable | undefined;
  const id = (suffix: string) => `${props.prefix}-preview-${suffix}`;
  const files = () => {
    const value = preview();
    return value?.status === "ready" ? value.files : [];
  };
  const current = createMemo(() => files()[index()]);
  const removed = () => {
    const value = preview();
    return value?.status === "ready" && value.removed;
  };
  const wide = () => terminal().width >= 100;
  const close = () => {
    if (!live || controller.signal.aborted) return;
    controller.abort();
    props.onBack();
  };
  const backRecord = (): CommandRecord => ({
    id: `${props.prefix}.preview-back`,
    verb: "Back to updates",
    destination: `${props.request.source} · same Skill, filter and checked set`,
    keys: ["enter"],
    scope: "page",
    enabled: true,
    danger: false,
  });
  const sharedReturn = usePageReturn(() => ({
    record: backRecord(),
    anchor: () => root,
    execute: close,
  }));
  const localKey = (key: NavKey): DispatchResult => {
    if (!isPlainNavKey(key)) return "declined";
    if (key.name === "escape") {
      close();
      return "consumed";
    }
    return "declined";
  };
  const bind = (suffix: string, target: Renderable, handler = localKey) => {
    const owner: FocusOwner = `command:${props.prefix}.preview-${suffix}`;
    const unbind = props.focusRegistry?.register(owner, target);
    const mode = props.focusRegistry?.registerModeHandler(target, handler);
    onCleanup(() => {
      unbind?.();
      mode?.();
    });
  };
  onCleanup(() => {
    live = false;
    controller.abort();
  });
  onMount(async () => {
    if (props.unavailableReason) return;
    try {
      if (!props.previewUpdate) throw new Error("Update preview is unavailable");
      const result = await props.previewUpdate(props.request, { signal: controller.signal });
      if (
        result.value.address.source !== props.request.source ||
        result.value.address.path !== props.request.path ||
        (result.value.status === "ready" &&
          result.value.targetRevision !== props.request.exactRevision)
      )
        throw new Error("Preview returned a different Skill or target revision");
      if (live && !controller.signal.aborted) setPreview(result.value);
    } catch (error) {
      if (live && !controller.signal.aborted)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (live && !controller.signal.aborted) setLoading(false);
    }
  });
  createEffect(() => {
    if (sharedReturn) return;
    const dispose = props.registerCommand?.(
      { ...backRecord(), scope: "widget" },
      `command:${props.prefix}.preview-back`,
      id("back"),
      close,
    );
    onCleanup(() => dispose?.());
  });
  const patch = createMemo(() => {
    const file = current();
    if (file?.content.kind !== "text" || file.content.before === file.content.after)
      return undefined;
    return createTwoFilesPatch(
      `a/${file.path}`,
      `b/${file.path}`,
      file.content.before,
      file.content.after,
      undefined,
      undefined,
      { context: 3, maxEditLength: 20_000, timeout: 150 },
    );
  });
  const fileNote = (file: UpdateFileChange) => {
    if (file.content.kind === "unavailable")
      return file.content.reason === "binary"
        ? "Binary or non-UTF-8 file · text diff unavailable"
        : file.content.reason === "too-large"
          ? "File exceeds 1 MiB · text diff unavailable"
          : "4 MiB preview limit reached · text diff unavailable";
    if (file.content.before === file.content.after)
      return file.status === "added"
        ? "Empty file added"
        : file.status === "deleted"
          ? "Empty file deleted"
          : "Content unchanged";
    return "Diff is too complex for the bounded preview";
  };
  return (
    <box
      id={id("pane")}
      flexDirection="column"
      flexGrow={1}
      minHeight={0}
      focusable
      ref={(target) => {
        root = target;
        bind("pane", target);
        queueMicrotask(() => {
          if (live && !target.isDestroyed) target.focus();
        });
      }}
    >
      <box id={id("actions-pane")} height={1} flexShrink={0} flexDirection="row">
        <Show when={!sharedReturn}>
          <Button
            id={id("back")}
            label="Back"
            intent="neutral"
            height={1}
            flexShrink={0}
            onPress={close}
            ref={(target) => bind("back", target)}
          />
        </Show>
        <text
          height={1}
          flexGrow={1}
          minWidth={0}
          wrapMode="none"
          fg={theme().colors.mutedForeground}
        >
          {props.request.source}/{props.request.path || "."} · Changes
        </text>
      </box>
      <Show when={loading()}>
        <text height={1}>Loading checked revision…</text>
      </Show>
      <Show when={error()}>
        {(message) => (
          <text wrapMode="word" fg={theme().colors.warning}>
            {message()}
          </text>
        )}
      </Show>
      <Show when={preview()?.status === "unavailable"}>
        <text wrapMode="word">
          Local Skills use live files. No previous installed snapshot is retained, so a before/after
          diff is unavailable.
        </text>
      </Show>
      <Show when={preview()?.status === "ready"}>
        <text height={1} flexShrink={0} wrapMode="none" fg={theme().colors.mutedForeground}>
          Installed → {props.request.exactRevision?.slice(0, 12)} · {files().length} file
          {files().length === 1 ? "" : "s"}
        </text>
        <Show
          when={files().length}
          fallback={<text>No file changes at the checked revision.</text>}
        >
          <box flexDirection={wide() ? "row" : "column"} flexGrow={1} minHeight={0}>
            <box
              id={id("files-pane")}
              width={wide() ? 30 : "100%"}
              height={wide() ? "100%" : Math.min(terminal().height <= 18 ? 1 : 3, files().length)}
              flexShrink={0}
            >
              <DataList
                id={id("files")}
                width="100%"
                height="100%"
                showDescription={false}
                selectedIndex={index()}
                options={files().map((file) => ({
                  name: `${file.status === "added" ? "+" : file.status === "deleted" ? "-" : "~"} ${file.path}`,
                  description: "",
                  value: file.path,
                }))}
                onChange={(next) => {
                  setIndex(next);
                  content?.scrollTo(0);
                }}
                onSelect={() => content?.focus()}
                ref={(target) => {
                  bind("files", target, (key) => {
                    const result = localKey(key);
                    if (result !== "declined") return result;
                    if (isPlainNavKey(key) && key.name === "enter") {
                      content?.focus();
                      return "consumed";
                    }
                    return "declined";
                  });
                  queueMicrotask(() => {
                    if (live && !target.isDestroyed && renderer.currentFocusedRenderable === root)
                      target.focus();
                  });
                }}
              />
            </box>
            <box flexDirection="column" flexGrow={1} minHeight={0} minWidth={0}>
              <Show when={terminal().height > 18}>
                <text height={1} flexShrink={0} wrapMode="none">
                  {current()?.path}
                </text>
              </Show>
              <scrollbox
                id={id("content-pane")}
                flexGrow={1}
                minHeight={1}
                scrollX={false}
                focusable
                ref={(target) => {
                  content = target;
                  bind("content", target, (key) => {
                    const result = localKey(key);
                    if (result !== "declined") return result;
                    if (!isPlainNavKey(key)) return "declined";
                    if (key.name === "home") target.scrollTo(0);
                    else if (key.name === "end") target.scrollTo(target.scrollHeight);
                    else if (["up", "down", "page-up", "page-down"].includes(key.name))
                      target.scrollBy(
                        key.name === "up" || key.name === "page-up" ? -1 : 1,
                        key.name.startsWith("page-") ? "viewport" : "step",
                      );
                    else return "declined";
                    return "consumed";
                  });
                }}
              >
                <Show when={removed()}>
                  <text wrapMode="word" fg={theme().colors.warning}>
                    Removed upstream; installed kept.
                  </text>
                </Show>
                <Show when={current()} keyed>
                  {(file) => (
                    <>
                      <Show
                        when={
                          file.before &&
                          file.after &&
                          file.before.executable !== file.after.executable
                        }
                      >
                        <text height={1}>
                          Executable: {file.before?.executable ? "on" : "off"} →{" "}
                          {file.after?.executable ? "on" : "off"}
                        </text>
                      </Show>
                      <Show when={patch()} fallback={<text wrapMode="word">{fileNote(file)}</text>}>
                        {(value) => (
                          <skill_update_diff
                            id={id("diff")}
                            diff={value()}
                            view={wide() ? "split" : "unified"}
                            wrapMode="word"
                            showLineNumbers
                            flexShrink={0}
                            width="100%"
                            fg={parseColor(theme().colors.foreground)}
                            lineNumberFg={parseColor(theme().colors.mutedForeground)}
                            addedBg={tint(theme().colors.background, theme().colors.success, 0.15)}
                            removedBg={tint(
                              theme().colors.background,
                              theme().colors.destructive,
                              0.15,
                            )}
                            addedSignColor={parseColor(theme().colors.success)}
                            removedSignColor={parseColor(theme().colors.destructive)}
                          />
                        )}
                      </Show>
                    </>
                  )}
                </Show>
              </scrollbox>
            </box>
          </box>
        </Show>
      </Show>
    </box>
  );
}
