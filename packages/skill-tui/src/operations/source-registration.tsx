import { SelectRenderable } from "@opentui/core";
import { createSignal, onMount } from "solid-js";
import {
  createModalControlRegistry,
  useModalControl,
  useModalControlTraversal,
} from "../modal-controls";
import { DataList } from "../ui/data-list";
import { FormField } from "../ui/form";
import { Input } from "../ui/input";
import { ModalBody, ModalCommand, modalCommand, ModalShell } from "./modal";

export function SourceRegistrationOverlay(props: {
  readonly kind: "source" | "config-source";
  readonly level?: "global" | "project" | "local";
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onSubmit: (value: {
    readonly level: "global" | "project" | "local";
    readonly id: string;
    readonly binding:
      | { readonly kind: "local"; readonly path: string; readonly root: string }
      | {
          readonly kind: "git";
          readonly origin: string;
          readonly ref: string;
          readonly root: string;
        }
      | {
          readonly kind: "github";
          readonly owner: string;
          readonly repository: string;
          readonly origin: string;
          readonly ref: string;
          readonly root: string;
        };
  }) => void;
  readonly onCancel: () => void;
}) {
  const controls = createModalControlRegistry();
  const [level, setLevel] = createSignal(props.level ?? "project");
  const [kind, setKind] = createSignal<"local" | "git" | "github">("local");
  const [id, setId] = createSignal("");
  const [origin, setOrigin] = createSignal("");
  const [owner, setOwner] = createSignal("");
  const [repository, setRepository] = createSignal("");
  const [ref, setRef] = createSignal("main");
  const [root, setRoot] = createSignal("");
  const registerLevel = useModalControl("source-register-level", controls, 10);
  const registerKind = useModalControl("source-register-kind", controls, 20);
  const registerId = useModalControl("source-register-id", controls, 30);
  const registerOrigin = useModalControl("source-register-origin", controls, 40);
  const registerOwner = useModalControl("source-register-github-owner", controls, 40);
  const registerRepository = useModalControl("source-register-github-repository", controls, 50);
  const registerRef = useModalControl("source-register-ref", controls, 60);
  const registerRoot = useModalControl("source-register-root", controls, 70);
  let initialControl: SelectRenderable | undefined;
  onMount(() => queueMicrotask(() => initialControl?.focus()));
  const valid = () => {
    const sourceId = id().trim();
    const sourceOrigin = origin().trim();
    const sourceRoot = root().trim();
    return (
      !!sourceId &&
      (kind() === "github" ? !!owner().trim() && !!repository().trim() : !!sourceOrigin) &&
      !!sourceRoot &&
      (kind() === "local" ||
        ((kind() === "github" ||
          (/^https?:\/\//.test(sourceOrigin) && !sourceOrigin.includes("@"))) &&
          !!ref().trim()))
    );
  };
  useModalControlTraversal(controls, props.onCancel);
  return (
    <ModalShell>
      <ModalBody controls={controls}>
        <text>{`Add ${props.kind === "source" ? "Source" : "Config Source"}`}</text>
        {props.level ? (
          <text>{`Config level: ${props.level}`}</text>
        ) : (
          <DataList
            id="source-register-level"
            height={3}
            flexShrink={0}
            ref={(value: SelectRenderable) => {
              initialControl = value;
              registerLevel(value);
            }}
            focused={false}
            options={["global", "project", "local"].map((value) => ({
              name: value,
              description: "Config owner",
              value,
            }))}
            showDescription={false}
            onSelect={(_index, option) =>
              option && setLevel(option.value as "global" | "project" | "local")
            }
          />
        )}
        <DataList
          id="source-register-kind"
          height={3}
          flexShrink={0}
          ref={(value: SelectRenderable) => {
            if (props.level) initialControl = value;
            registerKind(value);
          }}
          focused={false}
          options={[
            {
              name: "Local",
              description: "Configured local path",
              value: "local",
            },
            {
              name: "Remote Git",
              description: "Canonical URL and tracked ref",
              value: "git",
            },
            {
              name: "GitHub",
              description: "Owner, repository, and tracked ref",
              value: "github",
            },
          ]}
          showDescription={false}
          onSelect={(_index, option) =>
            option && setKind(option.value as "local" | "git" | "github")
          }
        />
        <FormField label="Source ID" labelPosition="beside" labelWidth={12}>
          <Input
            id="source-register-id"
            ref={registerId}
            focused={false}
            value={id()}
            placeholder="Source ID"
            onInput={setId}
          />
        </FormField>
        {kind() !== "github" && (
          <FormField
            label={kind() === "git" ? "Git origin" : "Local path"}
            labelPosition="beside"
            labelWidth={12}
          >
            <Input
              id="source-register-origin"
              ref={registerOrigin}
              focused={false}
              value={origin()}
              placeholder={kind() === "git" ? "Canonical remote URL" : "Configured local path"}
              onInput={setOrigin}
            />
          </FormField>
        )}
        {kind() === "github" && (
          <>
            <FormField label="GitHub owner" labelPosition="beside" labelWidth={12}>
              <Input
                id="source-register-github-owner"
                ref={registerOwner}
                focused={false}
                value={owner()}
                placeholder="GitHub owner"
                onInput={setOwner}
              />
            </FormField>
            <FormField label="Repository" labelPosition="beside" labelWidth={12}>
              <Input
                id="source-register-github-repository"
                ref={registerRepository}
                focused={false}
                value={repository()}
                placeholder="GitHub repository"
                onInput={setRepository}
              />
            </FormField>
          </>
        )}
        {kind() !== "local" && (
          <FormField label="Tracked ref" labelPosition="beside" labelWidth={12}>
            <Input
              id="source-register-ref"
              ref={registerRef}
              focused={false}
              value={ref()}
              placeholder="Tracked ref"
              onInput={setRef}
            />
          </FormField>
        )}
        <FormField label="Source root" labelPosition="beside" labelWidth={12}>
          <Input
            id="source-register-root"
            ref={registerRoot}
            focused={false}
            value={root()}
            placeholder="Source root"
            onInput={setRoot}
          />
        </FormField>
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        {!valid() && (
          <text>
            {kind() === "github"
              ? "Enter an ID, GitHub owner, repository, ref, and source root."
              : kind() === "git"
                ? "Enter an ID, credential-free http(s) origin, ref, and source root."
                : "Enter an ID, configured local path, and source root."}
          </text>
        )}
        <box flexDirection="column" gap={1} flexShrink={0}>
          <ModalCommand
            id="source-register-choice"
            controls={controls}
            order={80}
            record={modalCommand("source-register.cancel", "Cancel", "Discard draft")}
            execute={props.onCancel}
          />
          <ModalCommand
            id="source-register-submit"
            intent="primary"
            controls={controls}
            order={90}
            record={modalCommand(
              "source-register.submit",
              props.pending ? "Registering" : "Register",
              "Register this immutable binding",
              !props.pending && valid(),
              false,
              props.pending
                ? "Wait for the current operation to settle"
                : "Complete the required source fields",
            )}
            execute={() =>
              props.onSubmit({
                level: level(),
                id: id().trim(),
                binding:
                  kind() === "github"
                    ? {
                        kind: "github",
                        owner: owner().trim(),
                        repository: repository().trim(),
                        origin: `https://github.com/${owner().trim()}/${repository().trim()}`,
                        ref: ref().trim(),
                        root: root().trim(),
                      }
                    : kind() === "git"
                      ? {
                          kind: "git",
                          origin: origin().trim(),
                          ref: ref().trim(),
                          root: root().trim(),
                        }
                      : {
                          kind: "local",
                          path: origin().trim(),
                          root: root().trim(),
                        },
              })
            }
          />
        </box>
        <text>↑↓ move between controls · Enter select · Esc close</text>
      </ModalBody>
    </ModalShell>
  );
}
