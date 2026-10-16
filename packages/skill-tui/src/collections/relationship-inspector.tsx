import {
  Renderable,
  ScrollBoxRenderable,
  SelectRenderable,
  type BaseRenderable,
  type BoxRenderable,
} from "@opentui/core";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import type { CollectionView, ConfigDeclarationOwner } from "@skill-cli/core";
import type { MemberOriginPath } from "@skill-cli/core";
import { CommandControl } from "../command-control";
import { DataList } from "../ui/data-list";
import { collectionMemberKey, type CollectionsReadonly } from "./state";
import { relationshipCommands, type RelationshipCommand } from "./relationship-commands";
import type { FocusRegistry, FocusTarget } from "../focus";
import type { CommandExecution, CommandRegistration } from "../types";
import { usePageReturn } from "../page-navigation";
import { useTheme } from "../ui/use-theme";

export type CollectionRelationshipIntent =
  | { readonly kind: "collection-info"; readonly collection: string }
  | {
      readonly kind: "collection-membership-inspect";
      readonly collection: string;
      readonly member: string;
    }
  | {
      readonly kind: "collection-relation-inspect";
      readonly collection: string;
      readonly relation: string;
    }
  | { readonly kind: "collection-back"; readonly collection: string }
  | { readonly kind: "collection-inspector-back"; readonly collection: string }
  | {
      readonly kind: "collection-direct";
      readonly collection: string;
      readonly name: string;
      readonly address: { readonly source: string; readonly path: string };
      readonly owner: ConfigDeclarationOwner;
    }
  | {
      readonly kind: "collection-contribution";
      readonly collection: string;
      readonly owner: ConfigDeclarationOwner;
    }
  | {
      readonly kind: "collection-reference";
      readonly collection: string;
      readonly name: string;
      readonly target: string;
      readonly description: string;
      readonly owner: ConfigDeclarationOwner;
    }
  | {
      readonly kind: "collection-link";
      readonly collection: string;
      readonly target: string;
      readonly owner: ConfigDeclarationOwner;
    }
  | {
      readonly kind: "collection-producer";
      readonly collection: string;
      readonly address: { readonly source: string; readonly path: string };
    }
  | {
      readonly kind: "collection-use";
      readonly collection: string;
      readonly owner: ConfigDeclarationOwner;
    }
  | {
      readonly kind: "collection-use-edit";
      readonly collection: string;
      readonly owner: ConfigDeclarationOwner;
    }
  | {
      readonly kind: "collection-open-skill";
      readonly collection: string;
      readonly address: { readonly source: string; readonly path: string };
    }
  | {
      readonly kind: "collection-open-collection";
      readonly collection: string;
      readonly target: string;
    }
  | {
      readonly kind: "collection-open-config";
      readonly collection: string;
      readonly owner: ConfigDeclarationOwner;
      readonly relationship?: "membership" | "use" | "reference" | "link";
      readonly name?: string;
      readonly target?: string;
      readonly description?: string;
    }
  | {
      readonly kind: "collection-open-link";
      readonly collection: string;
      readonly target: string;
      readonly owner: ConfigDeclarationOwner;
    };

export interface CollectionRelationRow {
  /** Structural relationship identity; never a rendered row position. */
  readonly key?: string;
  readonly kind: "collection-use" | "collection-reference" | "collection-link";
  readonly label: string;
  readonly target?: string;
  readonly targetAvailable?: boolean;
  readonly owner?: ConfigDeclarationOwner;
  readonly effect: string;
  readonly provenance?: string;
  readonly intent?: CollectionRelationshipIntent;
}

export const collectionRelationKey = (relation: CollectionRelationRow): string =>
  relation.key ??
  JSON.stringify([
    relation.kind,
    relation.intent?.kind === "collection-reference" ? relation.intent.collection : undefined,
    relation.intent?.kind === "collection-reference" ? relation.intent.name : undefined,
    relation.target,
    relation.owner
      ? [
          relation.owner.level,
          relation.owner.file,
          relation.owner.pointer,
          relation.owner.namespace,
        ]
      : undefined,
  ]);
export interface CollectionMemberOriginRow {
  readonly kind: "member";
  readonly name: string;
  readonly address: { readonly source: string; readonly path: string };
  readonly origin: string;
  readonly description: string;
  readonly key: string;
  readonly value: string;
  readonly path?: MemberOriginPath;
  readonly intent?: CollectionRelationshipIntent;
}

const ownerText = (owner: ConfigDeclarationOwner) =>
  `${owner.level} ${owner.file} ${owner.pointer}`;
const compactAddress = (address: { readonly source: string; readonly path: string }) =>
  `${address.source}/${address.path}`;

export function RelationshipInspector(props: {
  readonly collection: CollectionView;
  readonly contextIssue?: string;
  readonly memberOrigins: readonly CollectionMemberOriginRow[];
  readonly relationRows: readonly CollectionRelationRow[];
  readonly memberDescription: (address: {
    readonly source: string;
    readonly path: string;
  }) => string | undefined;
  readonly memberAvailable: (address: {
    readonly source: string;
    readonly path: string;
  }) => boolean;
  readonly collections: CollectionsReadonly;
  readonly focusRegistry?: FocusRegistry;
  readonly bind: (
    owner: Parameters<FocusRegistry["register"]>[0],
    target: FocusTarget & Pick<BaseRenderable, "once" | "off">,
  ) => void;
  readonly onRelationship: (intent: CollectionRelationshipIntent) => void;
  readonly onScroll?: (surface: string, scroll: number) => void;
  readonly registerCommand?: CommandRegistration;
  readonly executeCommand?: CommandExecution;
}) {
  const terminal = useTerminalDimensions();
  const renderer = useRenderer();
  const tokens = useTheme();
  const retainScroll = (target: ScrollBoxRenderable, surface: string) => {
    let offset = props.collections.scroll(surface);
    let restored = false;
    const frame = () => {
      if (!restored) {
        target.scrollTop = offset;
        restored = true;
      }
      if (target.scrollTop !== offset) {
        offset = target.scrollTop;
        props.onScroll?.(surface, offset);
      }
    };
    renderer.on("frame", frame);
    target.once("destroyed", () => {
      renderer.off("frame", frame);
      if (restored) props.onScroll?.(surface, offset);
    });
  };
  const inspector = () => props.collections.inspector();
  const targets: Renderable[] = [];
  const focusControl = (target: Renderable | undefined) => {
    const owner = target && props.focusRegistry?.ownerOf(target);
    if (owner) props.focusRegistry?.applyFocus(owner);
  };
  const mode = (target: Renderable, primary = false) => {
    const dispose = props.focusRegistry?.registerModeHandler(target, (key) => {
      const commands = targets
        .filter((candidate) => !candidate.isDestroyed && candidate.focusable)
        .sort((left, right) => left.screenY - right.screenY || left.screenX - right.screenX);
      if (primary && key.name === "enter") {
        focusControl(commands[0]);
        return "consumed";
      }
      if (!primary && ["up", "down", "left", "right"].includes(key.name)) {
        const index = commands.indexOf(target);
        focusControl(
          commands[
            Math.max(
              0,
              Math.min(commands.length - 1, index + (["up", "left"].includes(key.name) ? -1 : 1)),
            )
          ],
        );
        return "consumed";
      }
      if (key.name === "left" || key.name === "right") return "consumed";
      return "declined";
    });
    target.once("destroyed", () => dispose?.());
  };
  const backRecord = (): RelationshipCommand => ({
    id: "collection.inspector-back",
    verb: "Back",
    destination:
      props.collections.tab(props.collection.id) === "relations" ? "Relations" : "Contents",
    scope: "page",
    keys: ["enter", "return"],
    enabled: true,
    danger: false,
    intent: { kind: "collection-inspector-back", collection: props.collection.id },
  });
  let surface: BoxRenderable | undefined;
  const [width, setWidth] = createSignal(0);
  const sharedReturn = usePageReturn(() => {
    if (inspector()?.collection !== props.collection.id) return undefined;
    const record = backRecord();
    return {
      record,
      anchor: () => surface,
      execute: () =>
        props.onRelationship({
          kind: "collection-inspector-back",
          collection: props.collection.id,
        }),
    };
  });
  const execute = (record: RelationshipCommand) => {
    if (!record.enabled || !record.intent) return;
    props.onRelationship(record.intent);
  };
  const compactVerb = (record: RelationshipCommand) => {
    if (width() >= 54) return record.verb;
    switch (record.id) {
      case "membership.open-owner":
      case "relationship.open-owner":
        return record.intent?.kind === "collection-open-link" ? "Open Link" : "Open Config";
      case "membership.open-link":
        return "Open Link";
      case "membership.open-source":
        return record.intent?.kind === "collection-contribution" ? "Config Source" : "Open Source";
      case "relationship.edit-use":
        return "Edit Use…";
      case "membership.remove":
        return "Remove Membership…";
      case "membership.unlink":
        return "Unlink Membership…";
      default:
        return record.verb;
    }
  };
  const InspectorCommand = (control: { readonly record: RelationshipCommand }) => {
    return (
      <CommandControl
        id={control.record.id}
        record={{ ...control.record, verb: compactVerb(control.record) }}
        showDisabledReason={false}
        keyboard={!props.executeCommand}
        register={(target) => {
          props.bind(`command:${control.record.id}`, target);
          targets.push(target);
          target.once("destroyed", () => {
            const index = targets.indexOf(target);
            if (index >= 0) targets.splice(index, 1);
          });
          mode(target);
          return props.registerCommand?.(
            control.record,
            `command:${control.record.id}`,
            control.record.id,
            () => execute(control.record),
          );
        }}
        execute={() =>
          props.executeCommand ? props.executeCommand(control.record.id) : execute(control.record)
        }
      />
    );
  };
  const Actions = (actions: { readonly commands: readonly RelationshipCommand[] }) => (
    <box id="collection-inspector-actions" flexDirection="column" gap={1} flexShrink={0}>
      <Show when={actions.commands.some((record) => !record.danger)}>
        <box
          id="collection-inspector-normal-actions"
          flexDirection="row"
          gap={1}
          height={1}
          flexShrink={0}
          overflow="hidden"
        >
          <For each={actions.commands.filter((record) => !record.danger)}>
            {(record) => <InspectorCommand record={record} />}
          </For>
        </box>
      </Show>
      <Show when={actions.commands.some((record) => record.danger)}>
        <box
          id="collection-inspector-danger-actions"
          flexDirection="row"
          gap={1}
          height={1}
          flexShrink={0}
          overflow="hidden"
        >
          <For each={actions.commands.filter((record) => record.danger)}>
            {(record) => <InspectorCommand record={record} />}
          </For>
        </box>
      </Show>
      <Show when={!sharedReturn}>
        <box height={1} flexShrink={0}>
          <InspectorCommand record={backRecord()} />
        </box>
      </Show>
    </box>
  );
  const Ownership = (owner: {
    readonly value?: ConfigDeclarationOwner;
    readonly fallback?: string;
  }) => (
    <box id="collection-inspector-ownership" flexDirection="column" flexShrink={0}>
      <text wrapMode="word">{`Owner  ${owner.value ? ownerText(owner.value) : (owner.fallback ?? "Owner unavailable")}`}</text>
      <Show when={owner.value?.contribution}>
        <text wrapMode="word">{`Config Source  ${ownerText(owner.value!.contribution!.configSource)}`}</text>
      </Show>
    </box>
  );
  const Unavailable = (actions: { readonly commands: readonly RelationshipCommand[] }) => (
    <For each={actions.commands.filter((record) => !record.enabled && record.disabledReason)}>
      {(record) => (
        <text
          wrapMode="word"
          fg={tokens().colors.mutedForeground}
        >{`${record.verb}: ${record.disabledReason}`}</text>
      )}
    </For>
  );
  const bindBody = (target: ScrollBoxRenderable, scroll: string) => {
    props.bind("inspector", target);
    props.bind("work-area", target);
    mode(target, true);
    retainScroll(target, scroll);
  };
  const Info = () => (
    <>
      <scrollbox
        id="collection-info"
        flexGrow={1}
        minHeight={1}
        focusable
        ref={(target) => bindBody(target, `collection:${props.collection.id}:about`)}
      >
        <Show when={props.contextIssue}>
          <text wrapMode="word">{props.contextIssue}</text>
        </Show>
        <text wrapMode="word">{props.collection.description || "No description provided."}</text>
      </scrollbox>
      <Actions commands={[]} />
    </>
  );
  const Missing = (missing: { readonly kind: string }) => (
    <>
      <scrollbox
        id="collection-inspector-unavailable"
        flexGrow={1}
        minHeight={1}
        focusable
        ref={(target) => {
          props.bind("inspector", target);
          mode(target, true);
        }}
      >
        <text>{missing.kind} unavailable.</text>
      </scrollbox>
      <Actions commands={[]} />
    </>
  );
  const Membership = () => {
    const member = createMemo(() => {
      const current = inspector();
      return current?.kind === "membership"
        ? props.collection.members.find(
            (item) =>
              collectionMemberKey(item) === current.member || `${item.name}:0` === current.member,
          )
        : undefined;
    });
    return (
      <Show when={member()} keyed fallback={<Missing kind="Membership" />}>
        {(member) => <MembershipDetails member={member} />}
      </Show>
    );
  };
  const MembershipDetails = (details: { readonly member: CollectionView["members"][number] }) => {
    const origins = createMemo(() =>
      props.memberOrigins.filter(
        (row) =>
          row.name === details.member.name &&
          row.address.source === details.member.address.source &&
          row.address.path === details.member.address.path,
      ),
    );
    const selected = () => {
      const current = inspector();
      return (
        origins().find(
          (origin) => origin.key === (current?.kind === "membership" ? current.origin : undefined),
        ) ?? origins()[0]
      );
    };
    const selectedOwner = () => {
      const path = selected()?.path;
      return path?.kind === "direct"
        ? path.owner
        : path?.kind === "via-link"
          ? path.links[0]?.owner
          : undefined;
    };
    const commands = createMemo(() =>
      relationshipCommands(props.collection.id, {
        kind: "membership",
        member: { ...details.member, available: props.memberAvailable(details.member.address) },
        origin: selected()?.path,
      }),
    );
    return (
      <>
        <Show when={origins().length > 1}>
          <DataList
            id="collection-membership-origin"
            height={terminal().height <= 16 ? 1 : Math.max(1, Math.min(origins().length, 4))}
            flexShrink={0}
            ref={(target: SelectRenderable) => {
              props.bind("inspector", target);
              mode(target, true);
            }}
            selectedIndex={Math.max(
              0,
              origins().findIndex((origin) => origin.key === selected()?.key),
            )}
            options={origins().map((origin) => ({
              name: `${origin.origin}  ${compactAddress(origin.address)}`,
              description: origin.description,
              value: origin.key,
            }))}
            showDescription={false}
            onChange={(index) => {
              const origin = origins()[index];
              if (origin) props.collections.selectMembershipOrigin(origin.key);
            }}
            onSelect={(index) => {
              const origin = origins()[index];
              if (origin) props.collections.selectMembershipOrigin(origin.key);
            }}
          />
        </Show>
        <scrollbox
          id="collection-membership-inspector"
          flexGrow={1}
          minHeight={1}
          width="100%"
          focusable
          ref={(target) => {
            props.bind("work-area", target);
            if (origins().length <= 1) props.bind("inspector", target);
            mode(target, true);
            const current = inspector();
            retainScroll(
              target,
              `collection:${props.collection.id}:membership:${current?.kind === "membership" ? current.member : ""}`,
            );
          }}
        >
          <box id="collection-inspector-object" flexDirection="column" flexShrink={0}>
            <text wrapMode="word">{`Target  ${compactAddress(details.member.address)}`}</text>
            <text wrapMode="word">
              {props.memberDescription(details.member.address) ?? "Skill description unavailable."}
            </text>
            <text wrapMode="word">{`In ${props.collection.id} · ${selected()?.origin ?? "Origin unavailable"}`}</text>
          </box>
          <Ownership value={selectedOwner()} fallback={selected()?.origin} />
          <Unavailable commands={commands()} />
        </scrollbox>
        <Actions commands={commands()} />
      </>
    );
  };
  const Relation = () => {
    const relation = createMemo(() => {
      const current = inspector();
      return current?.kind === "relation"
        ? props.relationRows.find((item) => collectionRelationKey(item) === current.relation)
        : undefined;
    });
    return (
      <Show when={relation()} keyed fallback={<Missing kind="Relation" />}>
        {(relation) => <RelationDetails relation={relation} />}
      </Show>
    );
  };
  const RelationDetails = (details: { readonly relation: CollectionRelationRow }) => {
    const commands = createMemo(() =>
      relationshipCommands(props.collection.id, { kind: "relation", relation: details.relation }),
    );
    return (
      <>
        <scrollbox
          id="collection-relation-inspector"
          flexGrow={1}
          minHeight={1}
          width="100%"
          focusable
          ref={(target) => {
            const current = inspector();
            bindBody(
              target,
              `collection:${props.collection.id}:relation:${current?.kind === "relation" ? current.relation : ""}`,
            );
          }}
        >
          <box id="collection-inspector-object" flexDirection="column" flexShrink={0}>
            <text wrapMode="word">{`Target  ${details.relation.target ?? props.collection.id}`}</text>
            <Show when={details.relation.intent?.kind === "collection-reference"}>
              <text wrapMode="word">
                {details.relation.intent?.kind === "collection-reference"
                  ? details.relation.intent.description
                  : ""}
              </text>
            </Show>
            <text wrapMode="word">{`Relation in ${props.collection.id} · ${details.relation.effect}`}</text>
          </box>
          <Ownership value={details.relation.owner} />
          <Unavailable commands={commands()} />
        </scrollbox>
        <Actions commands={commands()} />
      </>
    );
  };
  return (
    <Show when={inspector()?.collection === props.collection.id}>
      <box
        id="collection-inspector-surface"
        flexDirection="column"
        flexGrow={1}
        minHeight={0}
        minWidth={0}
        ref={(target) => {
          surface = target;
          setWidth(target.width);
        }}
        onSizeChange={() => setWidth(surface?.width ?? 0)}
      >
        <Switch>
          <Match when={inspector()?.kind === "collection"}>
            <Info />
          </Match>
          <Match when={inspector()?.kind === "membership"}>
            <Membership />
          </Match>
          <Match when={inspector()?.kind === "relation"}>
            <Relation />
          </Match>
        </Switch>
      </box>
    </Show>
  );
}
