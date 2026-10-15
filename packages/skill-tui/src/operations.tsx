import type { Renderable } from "@opentui/core";
import type { CommandRecord } from "./types";
import type { SourceRemovalReview } from "./effects";
import type { DiscoveryReview, UpdateReview } from "./effects";
import type { InstalledSkillReview } from "./effects";
import type { CollectionReview } from "./effects";
import type { AddMembershipPreviewRequest } from "./effects";
import type { ConfigDeclarationOwner } from "@skill-cli/core";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { createEffect, createSignal, Index, onMount, type JSX } from "solid-js";
import { CommandControl } from "./command-control";
import { Input } from "./ui/input";
import { DataList } from "./ui/data-list";
import { useTerminalDimensions } from "@opentui/solid";
import {
  createModalControlRegistry,
  useModalControl,
  useModalControlTraversal,
} from "./modal-controls";

/** Keep the actual form/review content within the terminal's native scroll viewport. */
function ModalBody(props: {
  readonly children: JSX.Element;
  readonly controls?: ReturnType<typeof createModalControlRegistry>;
}) {
  const terminal = useTerminalDimensions();
  const register = useModalControl("modal-impact-content", props.controls);
  return (
    <scrollbox
      border
      borderStyle="rounded"
      margin={1}
      padding={1}
      height={Math.max(1, terminal().height - 2)}
      minHeight={0}
      scrollX={false}
      ref={props.controls ? register : undefined}
      contentOptions={{ flexDirection: "column", flexShrink: 0 }}
    >
      {props.children}
    </scrollbox>
  );
}

/** A modal command is a real focus target, never an option in a data Select. */
export function ModalCommand(props: {
  readonly id: string;
  readonly record: CommandRecord;
  readonly initialFocus?: boolean;
  readonly order?: number;
  readonly execute: () => void;
  readonly controls?: ReturnType<typeof createModalControlRegistry>;
}) {
  const register = useModalControl(
    props.id,
    props.controls,
    props.order,
    () => props.record.enabled,
  );
  let target: Renderable | undefined;
  let wasEnabled = props.record.enabled;
  createEffect(() => {
    const enabled = props.record.enabled;
    if (enabled && !wasEnabled && target) register(target);
    wasEnabled = enabled;
  });
  return (
    <CommandControl
      id={props.id}
      record={props.record}
      initialFocus={props.initialFocus}
      register={(value) => {
        target = value;
        if (props.record.enabled) register(value);
      }}
      execute={props.execute}
    />
  );
}

const modalCommand = (
  id: string,
  verb: string,
  destination: string,
  enabled = true,
  danger = false,
  disabledReason?: string,
): CommandRecord => ({
  id,
  keys: ["enter"],
  verb,
  destination,
  scope: "modal",
  enabled,
  danger,
  ...(disabledReason ? { disabledReason } : {}),
});

export type InstalledSkillPreviewRequest =
  | {
      readonly kind: "uninstall";
      readonly address: { readonly source: string; readonly path: string };
    }
  | {
      readonly kind: "rebind";
      readonly address: { readonly source: string; readonly path: string };
      readonly owner: string;
      readonly ownerPath: string;
    };

export function InstalledSkillPreviewOverlay(props: {
  readonly request: InstalledSkillPreviewRequest;
  readonly cancelling: boolean;
  readonly onCancel: () => void;
}) {
  const rebind = props.request.kind === "rebind";
  const controls = createModalControlRegistry();
  useModalControlTraversal(controls, props.onCancel);
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <ModalBody>
        <text>{`${rebind ? "Rebind" : "Uninstall"} Skill preview`}</text>
        <text>{`Installed Skill: ${props.request.address.source}/${props.request.address.path}`}</text>
        {rebind && <text>{`Replacement: ${props.request.owner}/${props.request.ownerPath}`}</text>}
        <text>{props.cancelling ? "Cancelling preview" : "Reviewing impact"}</text>
        <ModalCommand
          id="installed-skill-preview-progress"
          controls={controls}
          record={modalCommand("installed.preview.cancel", "Cancel", "Return to Details")}
          initialFocus
          execute={props.onCancel}
        />
        <text>Escape Cancel</text>
      </ModalBody>
    </box>
  );
}

export function InstalledSkillPreviewFailureOverlay(props: {
  readonly request: InstalledSkillPreviewRequest;
  readonly error?: { readonly code: string; readonly message: string };
  readonly pending: boolean;
  readonly cancelling: boolean;
  readonly onRetry: () => void;
  readonly onCancel: () => void;
}) {
  const rebind = props.request.kind === "rebind";
  const controls = createModalControlRegistry();
  useModalControlTraversal(controls, props.onCancel);
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <ModalBody>
        <text>{`${rebind ? "Rebind" : "Uninstall"} Skill preview failed`}</text>
        <text>{`Installed Skill: ${props.request.address.source}/${props.request.address.path}`}</text>
        {rebind && <text>{`Replacement: ${props.request.owner}/${props.request.ownerPath}`}</text>}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        {props.cancelling && <text>Cancelling preview</text>}
        <ModalCommand
          id="installed-skill-preview-failure-cancel"
          controls={controls}
          record={modalCommand("installed.preview.cancel", "Cancel", "Return to Details")}
          initialFocus
          execute={props.onCancel}
        />
        <ModalCommand
          id="installed-skill-preview-failure-retry"
          controls={controls}
          record={modalCommand(
            "installed.preview.retry",
            props.pending ? "Cancelling" : "Retry",
            "Repeat this exact preview",
            !props.pending,
            false,
            props.pending ? "Wait for preview settlement" : undefined,
          )}
          execute={props.onRetry}
        />
        <text>Cancel is selected by default</text>
      </ModalBody>
    </box>
  );
}

export function InstalledSkillReviewOverlay(props: {
  readonly review: InstalledSkillReview;
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onResolveMembership: (owner: ConfigDeclarationOwner) => void;
}) {
  const controls = createModalControlRegistry();
  useModalControlTraversal(controls, props.onCancel);
  const uninstall = props.review.kind === "uninstall";
  const blocked = !props.review.impact.allowed;
  const directMemberships = uninstall ? props.review.impact.directMemberships : [];
  const lines = uninstall
    ? [
        ...props.review.impact.directMemberships.map(
          (owner) => `Direct Membership: ${owner.level} (${owner.pointer})`,
        ),
        ...props.review.impact.disappearingSelectors.map((item) => `Disappears: ${item.selector}`),
        ...props.review.impact.retainedSelectors.map((item) => `Retained: ${item.selector}`),
      ]
    : [
        `Old owner: ${props.review.address.source}`,
        `New owner: ${props.review.owner}`,
        `New path: ${props.review.ownerPath}`,
        `Identity proof: ${props.review.impact.proof}`,
      ];
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <ModalBody controls={controls}>
        <text>{uninstall ? "Uninstall Skill" : "Rebind Skill"}</text>
        <text>{`Installed Skill: ${props.review.address.source}/${props.review.address.path}`}</text>
        {lines.map((line) => (
          <text>{line}</text>
        ))}
        {blocked && <text>Operation is blocked by current dependencies.</text>}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <ModalCommand
          id="installed-skill-review-cancel"
          controls={controls}
          record={modalCommand("installed.cancel", "Cancel", "Details")}
          initialFocus
          execute={props.onCancel}
        />
        {blocked &&
          directMemberships.map((owner, index) => (
            <ModalCommand
              id={`installed-skill-review-resolve-${index}`}
              controls={controls}
              record={modalCommand(
                `installed.resolve.${index}`,
                `Resolve References: ${owner.level} (${owner.pointer})`,
                owner.file,
              )}
              execute={() => props.onResolveMembership(owner)}
            />
          ))}
        {!blocked && (
          <ModalCommand
            id="installed-skill-review-confirm"
            controls={controls}
            record={modalCommand(
              "installed.confirm",
              props.pending
                ? "Applying"
                : props.error
                  ? "Retry"
                  : uninstall
                    ? "Uninstall Skill"
                    : "Rebind Skill",
              "Apply reviewed operation",
              !props.pending,
              true,
              props.pending ? "Wait for the current operation to settle" : undefined,
            )}
            execute={props.onConfirm}
          />
        )}
        <text>Cancel is selected by default</text>
      </ModalBody>
    </box>
  );
}

export function RebindSourceOverlay(props: {
  readonly sources: readonly string[];
  readonly onSelect: (source: string, ownerPath: string) => void;
  readonly onClose: () => void;
}) {
  const controls = createModalControlRegistry();
  const [ownerPath, setOwnerPath] = createSignal("");
  const [owner, setOwner] = createSignal<string>();
  const registerSource = useModalControl("rebind-source-choice", controls, 10);
  const registerPath = useModalControl("rebind-owner-path", controls, 20);
  useModalControlTraversal(controls, props.onClose);
  const validPath = () => {
    const path = ownerPath().trim();
    return !!owner() && !!path && !path.startsWith("/") && !path.split("/").includes("..");
  };
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <ModalBody>
        <text>Rebind Skill</text>
        <DataList
          id="rebind-source-choice"
          ref={(value: SelectRenderable) => {
            registerSource(value);
          }}
          focused
          options={props.sources.map((source) => ({
            name: source,
            description: "Prove this Source owns the same Installed Skill identity",
            value: source,
          }))}
          showDescription
          onSelect={(_index, option) => {
            if (option) setOwner(option.value);
          }}
        />
        <Input
          id="rebind-owner-path"
          ref={(value: InputRenderable) => {
            registerPath(value);
          }}
          focused={false}
          placeholder="Replacement Source-root-relative Skill path"
          value={ownerPath()}
          onInput={setOwnerPath}
        />
        <ModalCommand
          id="rebind-preview"
          order={30}
          controls={controls}
          record={modalCommand(
            "rebind.review",
            "Review Rebind",
            "Preview identity proof",
            validPath(),
            false,
            "Select a replacement Source and enter a valid Skill path",
          )}
          execute={() => props.onSelect(owner()!, ownerPath().trim())}
        />
        <ModalCommand
          id="rebind-cancel"
          order={40}
          controls={controls}
          record={modalCommand("rebind.cancel", "Cancel", "Return to Details")}
          execute={props.onClose}
        />
        {!validPath() && <text>Enter a valid replacement Source-root-relative Skill path.</text>}
      </ModalBody>
    </box>
  );
}

export function CollectionHandoffOverlay(props: {
  readonly choices: readonly {
    readonly collection: string;
    readonly fixed?: boolean;
    readonly level?: "global" | "project" | "local";
    readonly owner?: ConfigDeclarationOwner;
  }[];
  readonly onSelect: (choice: {
    readonly collection: string;
    readonly level?: "global" | "project" | "local";
    readonly owner?: ConfigDeclarationOwner;
  }) => void;
  readonly onClose: () => void;
}) {
  const controls = createModalControlRegistry();
  const registerChoice = useModalControl("collection-handoff-choice", controls);
  useModalControlTraversal(controls, props.onClose);
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <ModalBody>
        <text>Add to collection</text>
        <DataList
          id="collection-handoff-choice"
          focused={true}
          showDescription
          ref={registerChoice}
          options={props.choices.map((choice, index) => ({
            name: `${choice.collection}${choice.owner ? ` (${ownerLine(choice.owner)})` : choice.level ? ` (${choice.level})` : ""}`,
            description: choice.level
              ? `Add to its ${choice.level} declaration`
              : "Create a direct contribution before adding",
            value: `${index}`,
          }))}
          onSelect={(_index, option) =>
            option && props.onSelect(props.choices[Number(option.value)]!)
          }
        />
        <ModalCommand
          id="collection-handoff-cancel"
          controls={controls}
          record={modalCommand("collection-handoff.cancel", "Cancel", "Return to Details")}
          execute={props.onClose}
        />
      </ModalBody>
    </box>
  );
}

export function InstalledSkillChooserOverlay(props: {
  readonly skills: readonly {
    readonly address: { readonly source: string; readonly path: string };
    readonly name: string;
    readonly description: string;
  }[];
  readonly onSelect: (
    address: { readonly source: string; readonly path: string },
    name: string,
  ) => void;
  readonly onClose: () => void;
}) {
  const controls = createModalControlRegistry();
  const registerChoice = useModalControl("installed-skill-choice", controls);
  useModalControlTraversal(controls, props.onClose);
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <ModalBody>
        <text>Select Installed Skill</text>
        <DataList
          id="installed-skill-choice"
          focused={true}
          height={Math.max(1, Math.min(props.skills.length * 2, 6))}
          ref={registerChoice}
          options={props.skills.map((skill, index) => ({
            name: `${skill.name}  ${skill.address.source}/${skill.address.path}`,
            description: skill.description,
            value: `${index}`,
          }))}
          showDescription
          onSelect={(_index, option) => {
            if (!option) return;
            const skill = props.skills[Number(option.value)];
            if (skill) props.onSelect(skill.address, skill.name);
          }}
        />
        <ModalCommand
          id="installed-skill-choice-cancel"
          controls={controls}
          record={modalCommand("installed-skill-choice.cancel", "Cancel", "Return to Collection")}
          execute={props.onClose}
        />
      </ModalBody>
    </box>
  );
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
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
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
            onSelect={(_index, option) =>
              option && setLevel(option.value as "global" | "project" | "local")
            }
          />
        ) : (
          <text>{`Level: ${props.level}`}</text>
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
        <ModalCommand
          id="collection-create-cancel"
          controls={controls}
          record={modalCommand("collection-create.cancel", "Cancel", "Discard draft")}
          initialFocus={props.fixed && !selectable}
          execute={props.onCancel}
        />
        <ModalCommand
          id="collection-create-submit"
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
        <text>↑↓ move between controls · Enter create · Esc discard draft</text>
      </ModalBody>
    </box>
  );
}

const ownerLine = (owner: ConfigDeclarationOwner | undefined) =>
  owner ? `${owner.level}: ${owner.file} ${owner.pointer}` : "No direct editable owner";

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
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
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
        <ModalCommand
          id="membership-add-cancel"
          controls={controls}
          record={modalCommand("membership-add.cancel", "Cancel", "Discard draft")}
          execute={props.onCancel}
        />
        <ModalCommand
          id="membership-add-preview"
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
      </ModalBody>
    </box>
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
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
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
        <ModalCommand
          id="membership-batch-cancel"
          controls={controls}
          record={modalCommand("membership-batch.cancel", "Cancel", "Discard draft")}
          execute={props.onCancel}
        />
        <ModalCommand
          id="membership-batch-review"
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
      </ModalBody>
    </box>
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
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <ModalBody controls={controls}>
        <text>{`Remove from ${props.collection}`}</text>
        <text>{`${props.executableCount} direct Membership${props.executableCount === 1 ? "" : "s"} can be removed`}</text>
        {props.lines.map((line) => (
          <text>{line}</text>
        ))}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
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
              props.pending ? "Continue" : "Continue",
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
        <text>Cancel is focused by default. Use ↓ to Continue.</text>
      </ModalBody>
    </box>
  );
}

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
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <ModalBody>
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
        <Input
          id="source-register-id"
          ref={registerId}
          focused={false}
          value={id()}
          placeholder="Source ID"
          onInput={setId}
        />
        {kind() !== "github" && (
          <Input
            id="source-register-origin"
            ref={(value: InputRenderable) => {
              registerOrigin(value);
            }}
            focused={false}
            value={origin()}
            placeholder={kind() === "git" ? "Canonical remote URL" : "Configured local path"}
            onInput={setOrigin}
          />
        )}
        {kind() === "github" && (
          <>
            <Input
              id="source-register-github-owner"
              ref={(value: InputRenderable) => {
                registerOwner(value);
              }}
              focused={false}
              value={owner()}
              placeholder="GitHub owner"
              onInput={setOwner}
            />
            <Input
              id="source-register-github-repository"
              ref={(value: InputRenderable) => {
                registerRepository(value);
              }}
              focused={false}
              value={repository()}
              placeholder="GitHub repository"
              onInput={setRepository}
            />
          </>
        )}
        {kind() !== "local" && (
          <Input
            id="source-register-ref"
            ref={(value: InputRenderable) => {
              registerRef(value);
            }}
            focused={false}
            value={ref()}
            placeholder="Tracked ref"
            onInput={setRef}
          />
        )}
        <Input
          id="source-register-root"
          ref={(value: InputRenderable) => {
            registerRoot(value);
          }}
          focused={false}
          value={root()}
          placeholder="Source root"
          onInput={setRoot}
        />
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
        <ModalCommand
          id="source-register-choice"
          controls={controls}
          order={80}
          record={modalCommand("source-register.cancel", "Cancel", "Discard draft")}
          execute={props.onCancel}
        />
        <ModalCommand
          id="source-register-submit"
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
        <text>↑↓ move between controls · Enter select · Esc close</text>
      </ModalBody>
    </box>
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
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <ModalBody>
        <text>Import Collection</text>
        <Input
          id="collection-import-from"
          ref={(value: InputRenderable) => {
            registerFrom(value);
          }}
          focused
          value={from()}
          placeholder="From collection"
          onInput={setFrom}
        />
        <Input
          id="collection-import-into"
          ref={(value: InputRenderable) => {
            registerInto(value);
          }}
          focused={false}
          value={into()}
          placeholder="Into collection"
          onInput={setInto}
        />
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <ModalCommand
          id="collection-import-cancel"
          controls={controls}
          record={modalCommand("collection-import.cancel", "Cancel", "Discard draft")}
          execute={props.onCancel}
        />
        <ModalCommand
          id="collection-import-review"
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
      </ModalBody>
    </box>
  );
}

export function ReferenceOverlay(props: {
  readonly level: "global" | "project" | "local";
  readonly collection: string;
  readonly name: string;
  readonly target: string;
  readonly description: string;
  readonly remove: boolean;
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onPreview: (
    intent: Extract<CollectionReview["intent"], { readonly kind: "reference" }>,
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
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <ModalBody>
        <text>{verb}</text>
        <Input
          id="reference-name"
          ref={(value: InputRenderable) => {
            registerName(value);
          }}
          focused
          value={name()}
          placeholder="Reference name"
          onInput={setName}
        />
        <Input
          id="reference-target"
          ref={(value: InputRenderable) => {
            registerTarget(value);
          }}
          focused={false}
          value={target()}
          placeholder="Target collection"
          onInput={setTarget}
        />
        {!props.remove && (
          <Input
            id="reference-description"
            ref={(value: InputRenderable) => {
              registerDescription(value);
            }}
            focused={false}
            value={description()}
            placeholder="Description"
            onInput={setDescription}
          />
        )}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <ModalCommand
          id="reference-cancel"
          controls={controls}
          record={modalCommand("reference.cancel", "Cancel", "Discard draft")}
          execute={props.onCancel}
        />
        <ModalCommand
          id="reference-review"
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
          execute={() =>
            props.onPreview({
              kind: "reference",
              level: props.level,
              collection: props.collection,
              name: name().trim(),
              target: target().trim(),
              description: description().trim(),
              remove: props.remove,
            })
          }
        />
      </ModalBody>
    </box>
  );
}

export function LinkChangeOverlay(props: {
  readonly level: "global" | "project" | "local";
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
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <ModalBody>
        <text>{verb}</text>
        <Input
          id="link-target"
          ref={(value: InputRenderable) => {
            registerTarget(value);
          }}
          focused
          value={target()}
          placeholder="Target collection"
          onInput={setTarget}
        />
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <ModalCommand
          id="link-cancel"
          controls={controls}
          record={modalCommand("link.cancel", "Cancel", "Discard draft")}
          execute={props.onCancel}
        />
        <ModalCommand
          id="link-review"
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
              collection: props.collection,
              target: target().trim(),
              linked: props.linked,
            })
          }
        />
      </ModalBody>
    </box>
  );
}

export function CollectionUseOverlay(props: {
  readonly level: "global" | "project" | "local";
  readonly collections: readonly string[];
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onPreview: (
    intent: Extract<CollectionReview["intent"], { readonly kind: "collection-use" }>,
  ) => void;
  readonly onCancel: () => void;
}) {
  const controls = createModalControlRegistry();
  const [collections, setCollections] = createSignal(props.collections.join(","));
  const registerCollections = useModalControl("collection-use-values", controls);
  useModalControlTraversal(controls, props.onCancel);
  const values = () =>
    collections()
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <ModalBody>
        <text>Set Collection Use</text>
        <Input
          id="collection-use-values"
          ref={(value: InputRenderable) => {
            registerCollections(value);
          }}
          focused
          value={collections()}
          placeholder="Collection IDs, comma separated"
          onInput={setCollections}
        />
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <ModalCommand
          id="collection-use-cancel"
          controls={controls}
          record={modalCommand("collection-use.cancel", "Cancel", "Discard draft")}
          execute={props.onCancel}
        />
        <ModalCommand
          id="collection-use-review"
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
              collections: values(),
            })
          }
        />
      </ModalBody>
    </box>
  );
}

export function CollectionReviewOverlay(props: {
  readonly review: CollectionReview;
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const controls = createModalControlRegistry();
  useModalControlTraversal(controls, props.onCancel);
  const impact = props.review.impact;
  const destructive =
    props.review.kind === "membership-removal" ||
    props.review.kind === "collection-removal" ||
    (props.review.kind === "membership-batch" && props.review.impact.removals.length > 0) ||
    (props.review.kind === "reference" && props.review.intent.remove) ||
    (props.review.kind === "link-change" && !props.review.impact.linked);
  const verb =
    impact.kind === "membership-batch"
      ? impact.additions.length
        ? "Add to Collection"
        : "Remove from Collection"
      : impact.kind === "membership-removal"
        ? "Remove Membership"
        : impact.kind === "reference"
          ? props.review.kind === "reference" && props.review.intent.remove
            ? "Remove Reference"
            : "Add Reference"
          : impact.kind === "link-change"
            ? impact.linked
              ? "Add Link"
              : "Remove Link"
            : impact.kind === "collection-removal"
              ? "Remove Collection"
              : impact.kind === "add-to-collection"
                ? "Add Membership"
                : impact.kind === "collection-import"
                  ? "Import Collection"
                  : "Set Collection Use";
  const lines = () => {
    switch (impact.kind) {
      case "membership-batch":
        return [
          `Collection: ${impact.collection}`,
          `Owner: ${ownerLine(impact.decision.kind === "direct" ? impact.decision.owner : undefined)}`,
          ...impact.additions.map(
            (item) => `Add: ${item.name} ${item.address.source}/${item.address.path}`,
          ),
          ...impact.removals.map(
            (item) =>
              `Remove: ${item.name} ${item.expectedAddress.source}/${item.expectedAddress.path}`,
          ),
          ...impact.affected.map((item) => `Affected: ${item.selector}`),
          ...impact.blockers.map((item) => `Blocker: ${item.reason}`),
        ];
      case "add-to-collection":
        return [
          `Collection: ${impact.collection}`,
          `Address: ${impact.address.source}/${impact.address.path}`,
          `Decision: ${impact.decision.kind}`,
          ...impact.existing.map((item) => `Existing: ${item.name}`),
        ];
      case "membership-removal":
        return [
          `Collection: ${impact.collection}`,
          `Membership: ${impact.name}`,
          ...impact.disappearing.map((item) => `Disappears: ${item.selector}`),
          ...impact.retained.map((item) => `Retained: ${item.selector}`),
          ...impact.linkActions.map((item) => `Link alternative: ${ownerLine(item.owner)}`),
        ];
      case "collection-import":
        return [
          `From: ${impact.source}`,
          `Into: ${impact.destination}`,
          `Owner: ${ownerLine(impact.owner)}`,
          ...impact.additions.map((item) => `Add: ${item.name}`),
          ...impact.skipped.map((item) => `Skip: ${item.name}`),
          ...impact.conflicts.map((item) => `Conflict: ${item.reason}`),
        ];
      case "reference":
        return [
          `Collection: ${impact.collection}`,
          `Reference: ${impact.name} -> ${impact.referencedCollection}`,
          `Description: ${impact.description}`,
          "Exposure: none",
        ];
      case "link-change":
        return [
          `Link: ${impact.linked ? "add" : "remove"}`,
          `Collection: ${impact.collection} -> ${impact.target}`,
          ...impact.members.map((item) => `Resulting member: ${item.name}`),
          ...impact.disappearingSelectors.map((item) => `Disappears: ${item.selector}`),
          ...impact.retainedSelectors.map((item) => `Retained: ${item.selector}`),
          ...impact.blockers.map((item) => `Blocker: ${item.reason}`),
        ];
      case "collection-use":
        return [
          `Owner: ${ownerLine(impact.owner)}`,
          `Old: ${impact.oldCollections.join(", ")}`,
          `New: ${impact.newCollections.join(", ")}`,
          `Complete: ${impact.proposedComplete ? "yes" : "no"}`,
          ...impact.newlyExposed.map((item) => `Expose: ${item.selector}`),
          ...impact.removedAtOwner.map((item) => `Remove: ${item.selector}`),
          ...impact.alternateOwners.map((owner) => `Alternate owner: ${ownerLine(owner)}`),
        ];
      case "collection-removal":
        return [
          `Owner: ${ownerLine(impact.owner)}`,
          ...impact.disappearingSelectors.map((item) => `Disappears: ${item.selector}`),
          ...impact.retainedSelectors.map((item) => `Retained: ${item.selector}`),
          ...impact.blockers.map((item) => `Blocker: ${item.reason}`),
        ];
    }
  };
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <ModalBody controls={controls}>
        <text>{verb}</text>
        {lines().map((line) => (
          <text>{line}</text>
        ))}
        {!impact.allowed && <text>Operation is blocked by current dependencies.</text>}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <ModalCommand
          id="collection-review-choice"
          controls={controls}
          record={modalCommand("collection-review.cancel", "Cancel", "Keep current configuration")}
          initialFocus
          execute={props.onCancel}
        />
        {impact.allowed && (
          <ModalCommand
            id="collection-review-confirm"
            controls={controls}
            record={modalCommand(
              "collection-review.confirm",
              props.pending ? `${verb}...` : props.error ? `Retry ${verb}` : verb,
              `Apply reviewed ${verb.toLowerCase()}`,
              !props.pending,
              destructive,
              props.pending ? "Wait for the current operation to settle" : undefined,
            )}
            execute={props.onConfirm}
          />
        )}
        <text>Cancel is selected by default</text>
      </ModalBody>
    </box>
  );
}

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
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      backgroundColor="#111111"
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
        <ModalCommand
          id="source-operation-cancel"
          controls={controls}
          record={modalCommand("source-operation.cancel", "Cancel", "Keep this selection")}
          execute={props.onCancel}
        />
        <ModalCommand
          id="source-operation-submit"
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
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <text>
          {discovery
            ? "Install adds no Memberships or Agent disclosure"
            : "New roots install through Add Skills; removed roots are retained"}
        </text>
      </ModalBody>
    </box>
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
    <box
      id="source-observation-overlay"
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      backgroundColor="#111111"
    >
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
            record={modalCommand("source-observation.retry", "Retry", "Observe this Source again")}
            execute={props.onRetry}
          />
        )}
        <text>{failed() && !props.cancelling ? "Escape Close" : "Escape Cancel"}</text>
      </ModalBody>
    </box>
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
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      backgroundColor="#111111"
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
        <text>↑↓ move between controls · Enter select · Esc close</text>
        <text>Cancel is selected by default</text>
      </ModalBody>
    </box>
  );
}
