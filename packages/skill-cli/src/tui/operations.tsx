import type { ActionDescriptor } from "./actions";
import type { Destination } from "./types";
import type { SourceRemovalReview } from "./effects";
import type { DiscoveryReview, UpdateReview } from "./effects";
import type { InstalledSkillReview } from "./effects";
import type { CollectionReview } from "./effects";
import type { AddMembershipPreviewRequest } from "./effects";
import type { InstalledSkillSelectorViews } from "../core/api";
import type { ConfigDeclarationOwner } from "../core/api";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { createEffect, createSignal, onCleanup, onMount, type Setter } from "solid-js";
import { useKeyboard } from "@opentui/solid";

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
  let progress: SelectRenderable | undefined;
  onMount(() => queueMicrotask(() => progress?.focus()));
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
        <text>{`${rebind ? "Rebind" : "Uninstall"} Skill preview`}</text>
        <text>{`Installed Skill: ${props.request.address.source}/${props.request.address.path}`}</text>
        {rebind && <text>{`Replacement: ${props.request.owner}/${props.request.ownerPath}`}</text>}
        <text>{props.cancelling ? "Cancelling preview" : "Reviewing impact"}</text>
        <select
          id="installed-skill-preview-progress"
          ref={(value: SelectRenderable) => {
            progress = value;
          }}
          focused={true}
          showDescription={false}
          options={[
            {
              name: "Cancel",
              description: "Return to Details",
              value: "cancel",
            },
          ]}
          onSelect={props.onCancel}
        />
        <text>Escape Cancel</text>
      </box>
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
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
        <text>{`${rebind ? "Rebind" : "Uninstall"} Skill preview failed`}</text>
        <text>{`Installed Skill: ${props.request.address.source}/${props.request.address.path}`}</text>
        {rebind && <text>{`Replacement: ${props.request.owner}/${props.request.ownerPath}`}</text>}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        {props.cancelling && <text>Cancelling preview</text>}
        <select
          id="installed-skill-preview-failure"
          focused={true}
          selectedIndex={0}
          showDescription={false}
          options={
            props.pending
              ? [
                  {
                    name: "Cancelling",
                    description: "Wait for preview settlement",
                    value: "cancel",
                  },
                ]
              : [
                  {
                    name: "Cancel",
                    description: "Return to Details",
                    value: "cancel",
                  },
                  {
                    name: "Retry",
                    description: "Repeat this exact preview",
                    value: "retry",
                  },
                ]
          }
          onSelect={(_index, option) => {
            if (option?.value === "retry" && !props.pending) props.onRetry();
            else props.onCancel();
          }}
        />
        <text>Cancel is selected by default</text>
      </box>
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
  let choice: SelectRenderable | undefined;
  onMount(() => queueMicrotask(() => choice?.focus()));
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
        <text>{uninstall ? "Uninstall Skill" : "Rebind Skill"}</text>
        <text>{`Installed Skill: ${props.review.address.source}/${props.review.address.path}`}</text>
        {lines.map((line) => (
          <text>{line}</text>
        ))}
        {blocked && <text>Operation is blocked by current dependencies.</text>}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <select
          id="installed-skill-review"
          ref={(value: SelectRenderable) => {
            choice = value;
          }}
          focused={true}
          selectedIndex={0}
          showDescription={false}
          options={
            blocked
              ? uninstall
                ? [
                    ...directMemberships.map((owner, index) => ({
                      name: `Resolve References: ${owner.level} (${owner.pointer})`,
                      description: `Open ${owner.file} without changing it automatically`,
                      value: `resolve:${index}`,
                    })),
                    {
                      name: "Cancel",
                      description: "Return to Details",
                      value: "cancel",
                    },
                  ]
                : [
                    {
                      name: "Cancel",
                      description: "Return to Details",
                      value: "cancel",
                    },
                  ]
              : [
                  {
                    name: "Cancel",
                    description: "Keep this Installed Skill",
                    value: "cancel",
                  },
                  {
                    name: props.pending
                      ? "Applying"
                      : props.error
                        ? "Retry"
                        : uninstall
                          ? "Uninstall Skill"
                          : "Rebind Skill",
                    description: "Apply the reviewed operation",
                    value: "confirm",
                  },
                ]
          }
          onSelect={(_index, option) => {
            if (props.pending) return;
            if (option?.value === "confirm") props.onConfirm();
            else if (option?.value?.startsWith("resolve:")) {
              const owner = directMemberships[Number(option.value.slice(8))];
              if (owner) props.onResolveMembership(owner);
            } else props.onCancel();
          }}
        />
        <text>Cancel is selected by default</text>
      </box>
    </box>
  );
}

export function AgentPathsOverlay(props: {
  readonly views: InstalledSkillSelectorViews;
  readonly onSelect: (value: string) => void;
  readonly onClose: () => void;
}) {
  const options =
    props.views.status === "complete"
      ? props.views.values.flatMap(
          (view, index) =>
            [
              ...view.paths.flatMap((path, pathIndex) =>
                path.kind === "via-link"
                  ? path.links.map((link, linkIndex) => ({
                      name: `${view.selector} via Link ${link.collection}->${link.linkedCollection}${link.owner ? ` (${link.owner.level})` : ""}`,
                      description: "Open this exact Link owner",
                      value: `link:${index}:${pathIndex}:${linkIndex}`,
                    }))
                  : [
                      {
                        name:
                          path.kind === "direct"
                            ? `${view.selector} Membership ${path.collection}:${path.entryName}`
                            : `${view.selector} Repository-derived ${path.repository}`,
                        description: "Open the exact owning path",
                        value: `path:${index}:${pathIndex}`,
                      },
                    ],
              ),
              ...view.useOwners.map((owner, ownerIndex) => ({
                name: `${view.selector} Collection Use ${owner.level}`,
                description: owner.pointer,
                value: `use:${index}:${ownerIndex}`,
              })),
            ] as const,
        )
      : [];
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
        <text>For agents</text>
        <select
          id="agent-path-choice"
          focused={true}
          height={10}
          options={[
            ...options,
            { name: "Close", description: "Return to Details", value: "close" },
          ]}
          showDescription
          onSelect={(_index, option) =>
            option?.value === "close" ? props.onClose() : option && props.onSelect(option.value)
          }
        />
      </box>
    </box>
  );
}

export function RebindSourceOverlay(props: {
  readonly sources: readonly string[];
  readonly onSelect: (source: string, ownerPath: string) => void;
  readonly onClose: () => void;
}) {
  const [ownerPath, setOwnerPath] = createSignal("");
  const [owner, setOwner] = createSignal<string>();
  const [focus, setFocus] = createSignal<"source" | "path" | "review" | "cancel">("source");
  let sourceChoice: SelectRenderable | undefined;
  let pathInput: InputRenderable | undefined;
  let review: SelectRenderable | undefined;
  let cancel: SelectRenderable | undefined;
  const validPath = () => {
    const path = ownerPath().trim();
    return !!owner() && !!path && !path.startsWith("/") && !path.split("/").includes("..");
  };
  createEffect(() => {
    const control =
      focus() === "source"
        ? sourceChoice
        : focus() === "path"
          ? pathInput
          : focus() === "review"
            ? review
            : cancel;
    control?.focus();
  });
  useKeyboard((event) => {
    if (event.name.toLowerCase() !== "tab") return;
    const order = ["source", "path", "review", "cancel"] as const;
    const index = order.indexOf(focus());
    setFocus(order[(index + (event.shift ? -1 : 1) + order.length) % order.length]!);
    event.preventDefault();
    event.stopPropagation();
  });
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
        <text>Rebind Skill</text>
        <input
          id="rebind-owner-path"
          ref={(value: InputRenderable) => {
            pathInput = value;
          }}
          focused={focus() === "path"}
          placeholder="Replacement Source-root-relative Skill path"
          value={ownerPath()}
          onInput={setOwnerPath}
        />
        <select
          id="rebind-source-choice"
          ref={(value: SelectRenderable) => {
            sourceChoice = value;
          }}
          focused={focus() === "source"}
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
        <select
          id="rebind-preview"
          ref={(value: SelectRenderable) => {
            review = value;
          }}
          focused={focus() === "review"}
          options={[
            {
              name: "Review Rebind",
              description: "Preview identity proof",
              value: "review",
            },
          ]}
          showDescription={false}
          onSelect={() => {
            const path = ownerPath().trim();
            if (validPath()) props.onSelect(owner()!, path);
          }}
        />
        <select
          id="rebind-cancel"
          ref={(value: SelectRenderable) => {
            cancel = value;
          }}
          focused={focus() === "cancel"}
          options={[
            {
              name: "Cancel",
              description: "Return to Details",
              value: "cancel",
            },
          ]}
          showDescription={false}
          onSelect={props.onClose}
        />
        {!validPath() && <text>Enter a valid replacement Source-root-relative Skill path.</text>}
      </box>
    </box>
  );
}

export function CollectionHandoffOverlay(props: {
  readonly choices: readonly {
    readonly collection: string;
    readonly level?: "global" | "project" | "local";
  }[];
  readonly onSelect: (choice: {
    readonly collection: string;
    readonly level?: "global" | "project" | "local";
  }) => void;
  readonly onClose: () => void;
}) {
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
        <text>Add to collection</text>
        <select
          id="collection-handoff-choice"
          focused={true}
          showDescription
          options={[
            {
              name: "Cancel",
              description: "Return to Details",
              value: "cancel",
            },
            ...props.choices.map((choice, index) => ({
              name: `${choice.collection}${choice.level ? ` (${choice.level})` : ""}`,
              description: choice.level
                ? `Add to its ${choice.level} declaration`
                : "Create a direct contribution before adding",
              value: `${index}`,
            })),
          ]}
          onSelect={(_index, option) =>
            option?.value === "cancel"
              ? props.onClose()
              : option && props.onSelect(props.choices[Number(option.value)]!)
          }
        />
      </box>
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
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
        <text>Select Installed Skill</text>
        <select
          id="installed-skill-choice"
          focused={true}
          height={10}
          options={[
            {
              name: "Cancel",
              description: "Return to Collection",
              value: "cancel",
            },
            ...props.skills.map((skill, index) => ({
              name: `${skill.name}  ${skill.address.source}/${skill.address.path}`,
              description: skill.description,
              value: `${index}`,
            })),
          ]}
          showDescription
          onSelect={(_index, option) => {
            if (!option || option.value === "cancel") return props.onClose();
            const skill = props.skills[Number(option.value)];
            if (skill) props.onSelect(skill.address, skill.name);
          }}
        />
      </box>
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
    readonly pending: boolean;
    readonly error?: { readonly code: string; readonly message: string };
    readonly onSubmit: (value: {
      readonly level: "global" | "project" | "local";
      readonly collection: string;
    }) => void;
    readonly onCancel: () => void;
  },
) {
  const allowedLevels = props.allowedLevels ?? [];
  const selectable = allowedLevels.length > 0;
  const initialLevel = props.level ?? allowedLevels[0]!;
  const [collection, setCollection] = createSignal(props.collection);
  const [level, setLevel] = createSignal(initialLevel);
  const [focus, setFocus] = createSignal<"level" | "id" | "choice">(selectable ? "level" : "id");
  let levelChoice: SelectRenderable | undefined;
  let idInput: InputRenderable | undefined;
  let choice: SelectRenderable | undefined;
  createEffect(() =>
    (focus() === "level" ? levelChoice : focus() === "id" ? idInput : choice)?.focus(),
  );
  onMount(() => queueMicrotask(() => (selectable ? levelChoice : idInput)?.focus()));
  useKeyboard((event) => {
    if (event.name.toLowerCase() === "escape") return props.onCancel();
    if (event.name.toLowerCase() !== "tab") return;
    const order: readonly ("level" | "id" | "choice")[] = selectable
      ? ["level", "id", "choice"]
      : ["id", "choice"];
    const index = order.indexOf(focus());
    setFocus(order[(index + (event.shift ? -1 : 1) + order.length) % order.length]!);
    event.preventDefault();
    event.stopPropagation();
  });
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
        <text>Create Collection</text>
        {selectable ? (
          <select
            id="collection-create-level"
            ref={(value: SelectRenderable) => {
              levelChoice = value;
            }}
            focused={focus() === "level"}
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
        <input
          id="collection-create-id"
          ref={(value: InputRenderable) => {
            idInput = value;
          }}
          focused={focus() === "id"}
          value={collection()}
          placeholder="Collection ID"
          onInput={setCollection}
        />
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <select
          id="collection-create-choice"
          ref={(value: SelectRenderable) => {
            choice = value;
          }}
          focused={focus() === "choice"}
          selectedIndex={0}
          showDescription={false}
          options={[
            { name: "Cancel", description: "Discard draft", value: "cancel" },
            {
              name: props.pending ? "Creating" : "Create",
              description: "Create this collection",
              value: "submit",
            },
          ]}
          onSelect={(_index, option) => {
            if (option?.value === "cancel") props.onCancel();
            else if (!props.pending && collection().trim())
              props.onSubmit({
                level: level()!,
                collection: collection().trim(),
              });
          }}
        />
        <text>Cancel is selected by default</text>
      </box>
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
  const [name, setName] = createSignal(props.initialName);
  const [focus, setFocus] = createSignal<"name" | "choice">("name");
  let nameInput: InputRenderable | undefined;
  let choice: SelectRenderable | undefined;
  createEffect(() => (focus() === "name" ? nameInput : choice)?.focus());
  onMount(() => queueMicrotask(() => nameInput?.focus()));
  useKeyboard((event) => {
    if (event.name.toLowerCase() === "escape") return props.onCancel();
    if (event.name.toLowerCase() !== "tab") return;
    setFocus(focus() === "name" ? "choice" : "name");
    event.preventDefault();
    event.stopPropagation();
  });
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
        <text>Add Membership</text>
        <text>{`Address: ${props.address.source}/${props.address.path}`}</text>
        <input
          id="membership-add-name"
          ref={(value: InputRenderable) => {
            nameInput = value;
          }}
          focused={focus() === "name"}
          value={name()}
          placeholder="Stable entry name"
          onInput={setName}
        />
        <text>Review this exact stable entry name with Core.</text>
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <select
          id="membership-add-choice"
          ref={(value: SelectRenderable) => {
            choice = value;
          }}
          focused={focus() === "choice"}
          selectedIndex={0}
          showDescription={false}
          options={[
            { name: "Cancel", description: "Discard draft", value: "cancel" },
            {
              name: "Continue to confirmation",
              description: "Review the Core-authorized membership before applying",
              value: "confirm",
            },
          ]}
          onSelect={(_index, option) => {
            if (option?.value === "cancel") props.onCancel();
            else if (!props.pending && option?.value === "confirm")
              props.onPreview({
                kind: "add-to-collection",
                level: props.level,
                collection: props.collection,
                address: props.address,
                name: name().trim(),
              });
          }}
        />
      </box>
    </box>
  );
}

type SourceRegistrationFocus =
  | "level"
  | "kind"
  | "id"
  | "origin"
  | "owner"
  | "repository"
  | "ref"
  | "root"
  | "choice";

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
  const [level, setLevel] = createSignal(props.level ?? "project");
  const [kind, setKind] = createSignal<"local" | "git" | "github">("local");
  const [id, setId] = createSignal("");
  const [origin, setOrigin] = createSignal("");
  const [owner, setOwner] = createSignal("");
  const [repository, setRepository] = createSignal("");
  const [ref, setRef] = createSignal("main");
  const [root, setRoot] = createSignal("");
  const [focus, setFocus] = createSignal<SourceRegistrationFocus>(props.level ? "kind" : "level");
  const [levelChoice, setLevelChoice] = createSignal<SelectRenderable>();
  const [kindChoice, setKindChoice] = createSignal<SelectRenderable>();
  const [idInput, setIdInput] = createSignal<InputRenderable>();
  const [originInput, setOriginInput] = createSignal<InputRenderable>();
  const [ownerInput, setOwnerInput] = createSignal<InputRenderable>();
  const [repositoryInput, setRepositoryInput] = createSignal<InputRenderable>();
  const [refInput, setRefInput] = createSignal<InputRenderable>();
  const [rootInput, setRootInput] = createSignal<InputRenderable>();
  const [choice, setChoice] = createSignal<SelectRenderable>();
  const trackRef =
    <T extends object>(set: Setter<T | undefined>) =>
    (value: T) => {
      set(() => value);
      onCleanup(() => set(() => undefined));
    };
  const focusOrder = (): readonly SourceRegistrationFocus[] => [
    ...(props.level ? [] : (["level"] as const)),
    "kind",
    "id",
    ...(kind() === "github" ? (["owner", "repository"] as const) : (["origin"] as const)),
    ...(kind() !== "local" ? (["ref"] as const) : []),
    "root",
    "choice",
  ];
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
  createEffect(() => {
    const order = focusOrder();
    if (!order.includes(focus())) {
      setFocus("kind");
      return;
    }
    const control =
      focus() === "level"
        ? levelChoice()
        : focus() === "kind"
          ? kindChoice()
          : focus() === "id"
            ? idInput()
            : focus() === "origin"
              ? originInput()
              : focus() === "owner"
                ? ownerInput()
                : focus() === "repository"
                  ? repositoryInput()
                  : focus() === "ref"
                    ? refInput()
                    : focus() === "root"
                      ? rootInput()
                      : choice();
    control?.focus();
  });
  onMount(() => queueMicrotask(() => (props.level ? kindChoice() : levelChoice())?.focus()));
  useKeyboard((event) => {
    if (event.name.toLowerCase() === "escape") return props.onCancel();
    if (event.name.toLowerCase() !== "tab") return;
    const order = focusOrder();
    const index = order.indexOf(focus());
    setFocus(order[(index + (event.shift ? -1 : 1) + order.length) % order.length]!);
    event.preventDefault();
    event.stopPropagation();
  });
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
        <text>{`Add ${props.kind === "source" ? "Source" : "Config Source"}`}</text>
        {props.level ? (
          <text>{`Config level: ${props.level}`}</text>
        ) : (
          <select
            id="source-register-level"
            ref={trackRef(setLevelChoice)}
            focused={focus() === "level"}
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
        <select
          id="source-register-kind"
          ref={trackRef(setKindChoice)}
          focused={focus() === "kind"}
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
          showDescription
          onSelect={(_index, option) =>
            option && setKind(option.value as "local" | "git" | "github")
          }
        />
        <input
          id="source-register-id"
          ref={trackRef(setIdInput)}
          focused={focus() === "id"}
          value={id()}
          placeholder="Source ID"
          onInput={setId}
        />
        {kind() !== "github" && (
          <input
            id="source-register-origin"
            ref={trackRef(setOriginInput)}
            focused={focus() === "origin"}
            value={origin()}
            placeholder={kind() === "git" ? "Canonical remote URL" : "Configured local path"}
            onInput={setOrigin}
          />
        )}
        {kind() === "github" && (
          <>
            <input
              id="source-register-github-owner"
              ref={trackRef(setOwnerInput)}
              focused={focus() === "owner"}
              value={owner()}
              placeholder="GitHub owner"
              onInput={setOwner}
            />
            <input
              id="source-register-github-repository"
              ref={trackRef(setRepositoryInput)}
              focused={focus() === "repository"}
              value={repository()}
              placeholder="GitHub repository"
              onInput={setRepository}
            />
          </>
        )}
        {kind() !== "local" && (
          <input
            id="source-register-ref"
            ref={trackRef(setRefInput)}
            focused={focus() === "ref"}
            value={ref()}
            placeholder="Tracked ref"
            onInput={setRef}
          />
        )}
        <input
          id="source-register-root"
          ref={trackRef(setRootInput)}
          focused={focus() === "root"}
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
        <select
          id="source-register-choice"
          ref={trackRef(setChoice)}
          focused={focus() === "choice"}
          selectedIndex={0}
          showDescription={false}
          options={[
            { name: "Cancel", description: "Discard draft", value: "cancel" },
            {
              name: props.pending ? "Registering" : "Register",
              description: "Register this immutable binding",
              value: "submit",
            },
          ]}
          onSelect={(_index, option) => {
            if (option?.value === "cancel") props.onCancel();
            else if (option?.value === "submit" && !props.pending && valid())
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
              });
          }}
        />
        <text>Cancel is selected by default</text>
      </box>
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
  const [from, setFrom] = createSignal(props.from);
  const [into, setInto] = createSignal(props.into);
  const [focus, setFocus] = createSignal<"from" | "into" | "choice">("from");
  let fromInput: InputRenderable | undefined;
  let intoInput: InputRenderable | undefined;
  let choice: SelectRenderable | undefined;
  createEffect(() =>
    (focus() === "from" ? fromInput : focus() === "into" ? intoInput : choice)?.focus(),
  );
  onMount(() => queueMicrotask(() => fromInput?.focus()));
  useKeyboard((event) => {
    if (event.name.toLowerCase() === "escape") return props.onCancel();
    if (event.name.toLowerCase() !== "tab") return;
    const order = ["from", "into", "choice"] as const;
    const index = order.indexOf(focus());
    setFocus(order[(index + (event.shift ? -1 : 1) + order.length) % order.length]!);
    event.preventDefault();
    event.stopPropagation();
  });
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
        <text>Import Collection</text>
        <input
          id="collection-import-from"
          ref={(value: InputRenderable) => {
            fromInput = value;
          }}
          focused={focus() === "from"}
          value={from()}
          placeholder="From collection"
          onInput={setFrom}
        />
        <input
          id="collection-import-into"
          ref={(value: InputRenderable) => {
            intoInput = value;
          }}
          focused={focus() === "into"}
          value={into()}
          placeholder="Into collection"
          onInput={setInto}
        />
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <select
          id="collection-import-choice"
          ref={(value: SelectRenderable) => {
            choice = value;
          }}
          focused={focus() === "choice"}
          selectedIndex={0}
          showDescription={false}
          options={[
            { name: "Cancel", description: "Discard draft", value: "cancel" },
            {
              name: props.pending ? "Reviewing" : "Review Import",
              description: "Preview all-or-none import",
              value: "preview",
            },
          ]}
          onSelect={(_index, option) => {
            if (option?.value === "cancel") props.onCancel();
            else if (!props.pending && from().trim() && into().trim())
              props.onPreview({
                kind: "collection-import",
                level: props.level,
                from: from().trim(),
                into: into().trim(),
              });
          }}
        />
      </box>
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
  const [name, setName] = createSignal(props.name);
  const [target, setTarget] = createSignal(props.target);
  const [description, setDescription] = createSignal(props.description);
  const [focus, setFocus] = createSignal<"name" | "target" | "description" | "choice">("name");
  let nameInput: InputRenderable | undefined;
  let targetInput: InputRenderable | undefined;
  let descriptionInput: InputRenderable | undefined;
  let choice: SelectRenderable | undefined;
  createEffect(() =>
    (focus() === "name"
      ? nameInput
      : focus() === "target"
        ? targetInput
        : focus() === "description"
          ? descriptionInput
          : choice
    )?.focus(),
  );
  onMount(() => queueMicrotask(() => nameInput?.focus()));
  const moveFocus = (event: {
    readonly name: string;
    readonly shift?: boolean;
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => {
    if (event.name.toLowerCase() === "escape") return props.onCancel();
    if (event.name.toLowerCase() !== "tab") return;
    const order: readonly ("name" | "target" | "description" | "choice")[] = props.remove
      ? ["name", "target", "choice"]
      : ["name", "target", "description", "choice"];
    const index = order.indexOf(focus());
    setFocus(order[(index + (event.shift ? -1 : 1) + order.length) % order.length]!);
    event.preventDefault();
    event.stopPropagation();
  };
  useKeyboard((event) => {
    moveFocus(event);
  });
  const verb = props.remove ? "Remove Reference" : "Add Reference";
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
        <text>{verb}</text>
        <input
          id="reference-name"
          ref={(value: InputRenderable) => {
            nameInput = value;
          }}
          focused={focus() === "name"}
          value={name()}
          placeholder="Reference name"
          onInput={setName}
        />
        <input
          id="reference-target"
          ref={(value: InputRenderable) => {
            targetInput = value;
          }}
          focused={focus() === "target"}
          value={target()}
          placeholder="Target collection"
          onInput={setTarget}
        />
        {!props.remove && (
          <input
            id="reference-description"
            ref={(value: InputRenderable) => {
              descriptionInput = value;
            }}
            focused={focus() === "description"}
            value={description()}
            placeholder="Description"
            onInput={setDescription}
          />
        )}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <select
          id="reference-choice"
          ref={(value: SelectRenderable) => {
            choice = value;
          }}
          focused={focus() === "choice"}
          selectedIndex={0}
          showDescription={false}
          options={[
            { name: "Cancel", description: "Discard draft", value: "cancel" },
            {
              name: props.pending ? "Reviewing" : `Review ${verb}`,
              description: "Preview this reference",
              value: "preview",
            },
          ]}
          onSelect={(_index, option) => {
            if (option?.value === "cancel") props.onCancel();
            else if (!props.pending && name().trim() && target().trim())
              props.onPreview({
                kind: "reference",
                level: props.level,
                collection: props.collection,
                name: name().trim(),
                target: target().trim(),
                description: description().trim(),
                remove: props.remove,
              });
          }}
        />
      </box>
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
  const [target, setTarget] = createSignal(props.target);
  const [focus, setFocus] = createSignal<"target" | "choice">("target");
  let targetInput: InputRenderable | undefined;
  let choice: SelectRenderable | undefined;
  createEffect(() => (focus() === "target" ? targetInput : choice)?.focus());
  onMount(() => queueMicrotask(() => targetInput?.focus()));
  useKeyboard((event) => {
    if (event.name.toLowerCase() === "escape") return props.onCancel();
    if (event.name.toLowerCase() !== "tab") return;
    setFocus(focus() === "target" ? "choice" : "target");
    event.preventDefault();
    event.stopPropagation();
  });
  const verb = props.linked ? "Add Link" : "Remove Link";
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
        <text>{verb}</text>
        <input
          id="link-target"
          ref={(value: InputRenderable) => {
            targetInput = value;
          }}
          focused={focus() === "target"}
          value={target()}
          placeholder="Target collection"
          onInput={setTarget}
        />
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <select
          id="link-choice"
          ref={(value: SelectRenderable) => {
            choice = value;
          }}
          focused={focus() === "choice"}
          selectedIndex={0}
          showDescription={false}
          options={[
            { name: "Cancel", description: "Discard draft", value: "cancel" },
            {
              name: props.pending ? "Reviewing" : `Review ${verb}`,
              description: "Preview link paths",
              value: "preview",
            },
          ]}
          onSelect={(_index, option) => {
            if (option?.value === "cancel") props.onCancel();
            else if (!props.pending && target().trim())
              props.onPreview({
                kind: "link-change",
                level: props.level,
                collection: props.collection,
                target: target().trim(),
                linked: props.linked,
              });
          }}
        />
      </box>
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
  const [collections, setCollections] = createSignal(props.collections.join(","));
  const [focus, setFocus] = createSignal<"collections" | "choice">("collections");
  let collectionsInput: InputRenderable | undefined;
  let choice: SelectRenderable | undefined;
  createEffect(() => (focus() === "collections" ? collectionsInput : choice)?.focus());
  onMount(() => queueMicrotask(() => collectionsInput?.focus()));
  useKeyboard((event) => {
    if (event.name.toLowerCase() === "escape") return props.onCancel();
    if (event.name.toLowerCase() !== "tab") return;
    setFocus(focus() === "collections" ? "choice" : "collections");
    event.preventDefault();
    event.stopPropagation();
  });
  const values = () =>
    collections()
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" backgroundColor="#111111">
      <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
        <text>Set Collection Use</text>
        <input
          id="collection-use-values"
          ref={(value: InputRenderable) => {
            collectionsInput = value;
          }}
          focused={focus() === "collections"}
          value={collections()}
          placeholder="Collection IDs, comma separated"
          onInput={setCollections}
        />
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <select
          id="collection-use-choice"
          ref={(value: SelectRenderable) => {
            choice = value;
          }}
          focused={focus() === "choice"}
          selectedIndex={0}
          showDescription={false}
          options={[
            { name: "Cancel", description: "Discard draft", value: "cancel" },
            {
              name: props.pending ? "Reviewing" : "Review Collection Use",
              description: "Preview disclosure",
              value: "preview",
            },
          ]}
          onSelect={(_index, option) => {
            if (option?.value === "cancel") props.onCancel();
            else if (!props.pending)
              props.onPreview({
                kind: "collection-use",
                level: props.level,
                collections: values(),
              });
          }}
        />
      </box>
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
  let choice: SelectRenderable | undefined;
  onMount(() => queueMicrotask(() => choice?.focus()));
  const impact = props.review.impact;
  const verb =
    impact.kind === "membership-removal"
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
      <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
        <text>{verb}</text>
        {lines().map((line) => (
          <text>{line}</text>
        ))}
        {!impact.allowed && <text>Operation is blocked by current dependencies.</text>}
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <select
          id="collection-review-choice"
          ref={(value: SelectRenderable) => {
            choice = value;
          }}
          focused={true}
          selectedIndex={0}
          showDescription={false}
          options={
            impact.allowed
              ? [
                  {
                    name: "Cancel",
                    description: "Keep current configuration",
                    value: "cancel",
                  },
                  {
                    name: props.pending ? `${verb}...` : props.error ? `Retry ${verb}` : verb,
                    description: `Apply reviewed ${verb.toLowerCase()}`,
                    value: "confirm",
                  },
                ]
              : [
                  {
                    name: "Cancel",
                    description: "Return without mutation",
                    value: "cancel",
                  },
                ]
          }
          onSelect={(_index, option) => {
            if (option?.value === "cancel") props.onCancel();
            else if (!props.pending) props.onConfirm();
          }}
        />
        <text>Cancel is selected by default</text>
      </box>
    </box>
  );
}

export function ActionOverlay(props: {
  readonly title: "Actions" | "Palette";
  readonly actions: readonly ActionDescriptor[];
  readonly onSelect: (id: ActionDescriptor["id"] | Destination) => void;
  readonly onClose: () => void;
}) {
  return (
    <box
      id="source-selection-overlay"
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
      <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
        <text>{props.title}</text>
        <select
          id={props.title === "Palette" ? "palette-menu" : "source-action-menu"}
          focused={true}
          height={props.title === "Palette" ? 10 : Math.min(props.actions.length * 2, 14)}
          options={[
            ...(props.title === "Palette"
              ? (["workspace", "global", "project", "local"] as const).map((destination) => ({
                  name:
                    destination === "workspace"
                      ? "Workspace"
                      : destination[0]!.toUpperCase() + destination.slice(1),
                  description: "Open destination",
                  value: destination,
                }))
              : []),
            ...props.actions.map((action) => ({
              name: `${action.title}${action.enabled ? "" : " (unavailable)"}`,
              description: action.reason ?? action.description,
              value: action.id,
            })),
          ]}
          showDescription
          onSelect={(_index, option) => option && props.onSelect(option.value)}
        />
        <text>Escape Close</text>
      </box>
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
  const choices = () => [
    ...visibleCandidates.map((candidate) => ({
      name: `${candidate.selectable ? (props.selected.includes(candidate.path) ? "[x]" : "[ ]") : "[-]"} ${candidate.category} ${candidate.name}`,
      description: candidate.selectable
        ? candidate.description
        : `${candidate.description} (not selectable)`,
      value: candidate.path,
    })),
    { name: "Cancel", description: "Keep this selection", value: "cancel" },
    {
      name: `${props.pending ? "Applying" : discovery ? "Install" : "Update"} ${props.selected.length} Skills`,
      description:
        props.selected.length === 0
          ? "Select at least one eligible Skill"
          : "Apply selected Skills",
      value: "submit",
    },
  ];
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
      <box border borderStyle="rounded" margin={1} padding={1} flexDirection="column">
        <text>{discovery ? "Add Skills" : "Check Updates"}</text>
        <text>{`Source: ${props.review.observation.source}`}</text>
        {props.review.observation.exactRevision && (
          <text>{`Revision: ${props.review.observation.exactRevision}`}</text>
        )}
        <select
          id="source-operation-selection"
          focused={true}
          height={10}
          options={choices()}
          showDescription
          onSelect={(_index, option) => {
            const candidate = visibleCandidates.find((item) => item.path === option?.value);
            if (candidate?.selectable && !props.pending) props.onToggle(candidate.path);
            else if (option?.value === "cancel") props.onCancel();
            else if (option?.value === "submit" && !props.pending && props.selected.length > 0)
              props.onSubmit();
          }}
        />
        {props.error && <text>{`${props.error.code}: ${props.error.message}`}</text>}
        <text>
          {discovery
            ? "Install adds no Memberships or Agent disclosure"
            : "New roots install through Add Skills; removed roots are retained"}
        </text>
      </box>
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
      <box border borderStyle="rounded" margin={1} padding={1} flexDirection="column">
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
        <select
          id="source-observation-progress"
          focused={true}
          height={3}
          options={
            failed() && !props.cancelling
              ? [
                  {
                    name: "Retry",
                    description: "Observe this Source again",
                    value: "retry",
                  },
                  {
                    name: "Close",
                    description: "Return to the selected Source",
                    value: "close",
                  },
                ]
              : [
                  {
                    name: "Cancel",
                    description: "Request cancellation",
                    value: "cancel",
                  },
                ]
          }
          showDescription
          onSelect={(_index, option) => {
            if (option?.value === "retry") props.onRetry();
            else props.onClose();
          }}
        />
        <text>Escape Cancel</text>
      </box>
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
  const blocked = !props.review.impact.allowed;
  const options = blocked
    ? [
        ...props.review.impact.repairs.flatMap((repair) =>
          repair.actions.map((action) => ({
            name: `${action === "rebind" ? "Rebind" : "Uninstall"} ${repair.address.source}/${repair.address.path}`,
            description: `Open ${action} repair for ${repair.address.source}/${repair.address.path}`,
            value: JSON.stringify({ action, address: repair.address }),
          })),
        ),
        { name: "Cancel", description: "Close impact review", value: "cancel" },
      ]
    : [
        {
          name: "Cancel",
          description: "Keep this Source",
          value: "cancel" as const,
        },
        {
          name: props.pending ? "Removing..." : "Remove Source",
          description: "Remove the direct declaration",
          value: "confirm" as const,
        },
      ];
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
      <box border borderStyle="rounded" margin={2} padding={1} flexDirection="column">
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
        <select
          id="source-removal-choice"
          focused={true}
          height={4}
          selectedIndex={0}
          options={options}
          showDescription
          onSelect={(_index, option) => {
            const value = option?.value;
            if (value === "cancel") props.onCancel();
            else if (props.pending) return;
            else if (value === "confirm") props.onConfirm();
            else if (value) {
              const repair = JSON.parse(value) as {
                readonly action: "rebind" | "uninstall";
                readonly address: {
                  readonly source: string;
                  readonly path: string;
                };
              };
              if (repair.action === "rebind" || repair.action === "uninstall")
                props.onRepair(repair.action, repair.address);
            } else if (!props.pending) props.onConfirm();
          }}
        />
        <text>Cancel is selected by default</text>
      </box>
    </box>
  );
}
