import { InputRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { createSignal, onMount, Show } from "solid-js";
import {
  createModalControlRegistry,
  useModalControl,
  useModalControlTraversal,
} from "../modal-controls";
import { DataList } from "../ui/data-list";
import { FormField } from "../ui/form";
import { Input } from "../ui/input";
import { ModalBody, ModalCommand, modalCommand, ModalShell } from "./modal";
import type { ConfigLevel, RegisterSourceRequest } from "@skctl/core";

export interface SourceRegistrationDraft {
  readonly origin: string;
  readonly id: string;
  readonly editedId: boolean;
  readonly ref: string;
  readonly root: string;
  readonly advanced: boolean;
}

export function SourceRegistrationOverlay(props: {
  readonly kind: "source" | "config-source";
  readonly level?: ConfigLevel;
  readonly configFile?: (level: ConfigLevel) => string | undefined;
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onSubmit: (value: RegisterSourceRequest, discover: boolean) => void;
  readonly onCancel: () => void;
  readonly initialDraft?: SourceRegistrationDraft;
  readonly onBack?: (draft: SourceRegistrationDraft) => void;
}) {
  const controls = createModalControlRegistry();
  const renderer = useRenderer();
  const levels = (["global", "project", "local"] as const).filter(
    (level) => !props.configFile || props.configFile(level),
  );
  const [level, setLevel] = createSignal(
    props.level ?? (levels.includes("project") ? "project" : levels[0]!),
  );
  const [origin, setOrigin] = createSignal(props.initialDraft?.origin ?? "");
  const [id, setId] = createSignal(props.initialDraft?.id ?? "");
  const [editedId, setEditedId] = createSignal(props.initialDraft?.editedId ?? false);
  const [ref, setRef] = createSignal(props.initialDraft?.ref ?? "HEAD");
  const [root, setRoot] = createSignal(props.initialDraft?.root ?? "");
  const [advanced, setAdvanced] = createSignal(props.initialDraft?.advanced ?? false);
  const back = () =>
    props.onBack
      ? props.onBack({
          origin: origin(),
          id: id(),
          editedId: editedId(),
          ref: ref(),
          root: root(),
          advanced: advanced(),
        })
      : props.onCancel();
  const registerOrigin = useModalControl("source-register-origin", controls, 10);
  const registerId = useModalControl("source-register-id", controls, 20);
  const registerLevel = useModalControl("source-register-level", controls, 30);
  const registerRef = useModalControl("source-register-ref", controls, 50);
  const registerRoot = useModalControl("source-register-root", controls, 60);
  let initial: InputRenderable | undefined;
  onMount(() => queueMicrotask(() => initial?.focus()));
  useModalControlTraversal(controls, back);
  const remote = () => /^https?:\/\//i.test(origin().trim());
  const binding = (): RegisterSourceRequest["binding"] | undefined => {
    const address = origin().trim();
    if (!address) return;
    if (!remote()) {
      if (address.includes("://") || address.startsWith("git@")) return;
      return { kind: "local", path: address, root: root().trim() };
    }
    try {
      const url = new URL(address);
      if (url.username || url.password || url.search || url.hash || !ref().trim()) return;
      const path = url.pathname
        .replace(/\/$/, "")
        .replace(/\.git$/, "")
        .split("/")
        .filter(Boolean);
      return url.hostname === "github.com" && path.length === 2
        ? {
            kind: "github",
            owner: path[0]!,
            repository: path[1]!,
            origin: `${url.protocol}//${url.host}/${path.join("/")}`,
            ref: ref().trim(),
            root: root().trim(),
          }
        : { kind: "git", origin: address, ref: ref().trim(), root: root().trim() };
    } catch {
      return;
    }
  };
  const valid = () => !!id().trim() && !!binding();
  const submit = (discover: boolean) => {
    const value = binding();
    if (!props.pending && id().trim() && value)
      props.onSubmit({ level: level(), id: id().trim(), binding: value }, discover);
  };
  return (
    <ModalShell>
      <ModalBody
        controls={controls}
        header={<text>{`Add ${props.kind === "source" ? "Source" : "Config Source"}`}</text>}
        footer={
          <box flexDirection="row" flexWrap="wrap" gap={1}>
            {props.onBack && (
              <ModalCommand
                id="source-register-back"
                controls={controls}
                order={65}
                record={modalCommand(
                  "source-register.back",
                  "Back",
                  "Keep selected Skills",
                  !props.pending,
                )}
                execute={back}
              />
            )}
            <ModalCommand
              id="source-register-submit"
              intent="primary"
              controls={controls}
              order={70}
              record={modalCommand(
                "source-register.submit",
                props.pending
                  ? "Adding…"
                  : props.kind === "source"
                    ? "Add and find Skills"
                    : "Add Config Source",
                "Save Source",
                !props.pending && valid(),
              )}
              execute={() => submit(props.kind === "source")}
            />
            <Show when={props.kind === "source"}>
              <ModalCommand
                id="source-register-only"
                controls={controls}
                order={80}
                record={modalCommand(
                  "source-register.only",
                  "Add only",
                  "Save without discovery",
                  !props.pending && valid(),
                )}
                execute={() => submit(false)}
              />
            </Show>
            <ModalCommand
              id="source-register-choice"
              controls={controls}
              order={90}
              record={modalCommand("source-register.cancel", "Cancel", "Discard draft")}
              execute={props.onCancel}
            />
          </box>
        }
      >
        <FormField label="Address" labelPosition="beside" labelWidth={12}>
          <Input
            id="source-register-origin"
            ref={(target) => {
              initial = target;
              registerOrigin(target);
            }}
            focused={false}
            value={origin()}
            placeholder="Repository URL or local path"
            onInput={(value) => {
              setOrigin(value);
              if (!editedId())
                setId(
                  value
                    .trim()
                    .replace(/\/+$/, "")
                    .split("/")
                    .at(-1)
                    ?.replace(/\.git$/, "")
                    .replace(/[^a-zA-Z0-9_-]/g, "-") ?? "",
                );
            }}
          />
        </FormField>
        <FormField label="Source ID" labelPosition="beside" labelWidth={12}>
          <Input
            id="source-register-id"
            ref={registerId}
            focused={false}
            value={id()}
            placeholder="Source ID"
            onInput={(value) => {
              if (renderer.currentFocusedRenderable?.id === "source-register-id") setEditedId(true);
              setId(value);
            }}
          />
        </FormField>
        <text>{`Type: ${binding()?.kind ?? (remote() ? "Remote Git" : "Local directory")}`}</text>
        <Show when={!props.level}>
          <DataList
            id="source-register-level"
            ref={registerLevel}
            height={levels.length}
            flexShrink={0}
            focused={false}
            options={levels.map((value) => ({ name: value, description: "Save location", value }))}
            showDescription={false}
            selectedIndex={levels.indexOf(level())}
            onChange={(_index, option) => option && setLevel(option.value as ConfigLevel)}
          />
        </Show>
        <text wrapMode="word">{`Save to ${level()}: ${props.configFile?.(level()) ?? level()} (created on Add if missing)`}</text>
        <ModalCommand
          id="source-register-advanced"
          controls={controls}
          order={40}
          record={modalCommand(
            "source-register.advanced",
            advanced() ? "Hide advanced options" : "Advanced options",
            "Tracked ref and Source root",
          )}
          execute={() => setAdvanced((value) => !value)}
        />
        <Show when={advanced()}>
          <Show when={remote()}>
            <FormField label="Tracked ref" labelPosition="beside" labelWidth={12}>
              <Input
                id="source-register-ref"
                ref={registerRef}
                focused={false}
                value={ref()}
                placeholder="HEAD (remote default branch)"
                onInput={setRef}
              />
            </FormField>
          </Show>
          <FormField label="Source root" labelPosition="beside" labelWidth={12}>
            <Input
              id="source-register-root"
              ref={registerRoot}
              focused={false}
              value={root()}
              placeholder="Origin root (leave empty)"
              onInput={setRoot}
            />
          </FormField>
        </Show>
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        {!valid() && (
          <text wrapMode="word">
            Enter a Source ID and local path or credential-free HTTP(S) repository URL.
          </text>
        )}
        <text>Tab switch controls · Enter activate · Esc cancel</text>
      </ModalBody>
    </ModalShell>
  );
}
