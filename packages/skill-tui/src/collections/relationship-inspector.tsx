import {
  Renderable,
  ScrollBoxRenderable,
  SelectRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { createEffect, createSignal, Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import type { CollectionView, ConfigDeclarationOwner } from "@skill-cli/core";
import type { MemberOriginPath } from "@skill-cli/core";
import { CommandControl } from "../command-control";
import { DataList } from "../ui/data-list";
import { collectionMemberKey, type CollectionsReadonly } from "./state";
import { relationshipCommands, type RelationshipCommand } from "./relationship-commands";
import type { FocusRegistry, FocusTarget } from "../focus";
import type { CommandExecution, CommandRegistration } from "../types";

export type CollectionRelationshipIntent =
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
const ownerWithProvenance = (owner: ConfigDeclarationOwner | undefined, fallback: string) =>
  owner
    ? `${ownerText(owner)}${owner.contribution ? ` · Config Source ${ownerText(owner.contribution.configSource)}` : ""}`
    : fallback;
const compactAddress = (address: { readonly source: string; readonly path: string }) =>
  `${address.source}/${address.path}`;

export function RelationshipInspector(props: {
  readonly collection: CollectionView;
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
  readonly registerCommand?: CommandRegistration;
  readonly executeCommand?: CommandExecution;
}) {
  const terminal = useTerminalDimensions();
  const inspector = () => props.collections.inspector();
  const [showActions, setShowActions] = createSignal(false);
  const [showDetails, setShowDetails] = createSignal(false);
  createEffect((previousKey?: string) => {
    const current = inspector();
    const key = current
      ? JSON.stringify(
          current.kind === "membership"
            ? [current.kind, current.collection, current.member]
            : [current.kind, current.collection, current.relation],
        )
      : undefined;
    if (previousKey !== key) {
      setShowActions(false);
      setShowDetails(false);
    }
    return key;
  });
  const targets: Renderable[] = [];
  const focusControl = (target: Renderable | undefined) => {
    const owner = target && props.focusRegistry?.ownerOf(target);
    if (owner) props.focusRegistry?.applyFocus(owner);
  };
  const mode = (target: Renderable, primary = false) => {
    const dispose = props.focusRegistry?.registerModeHandler(target, (key) => {
      const commands = targets.filter((candidate) => !candidate.isDestroyed && candidate.focusable);
      if (primary && (key.name === "right" || key.name === "enter")) {
        focusControl(commands[0]);
        return "consumed";
      }
      if (!primary && (key.name === "up" || key.name === "down")) {
        const index = commands.indexOf(target);
        if (key.name === "up" && index === 0) props.focusRegistry?.applyFocus("inspector");
        else
          focusControl(
            commands[
              Math.max(0, Math.min(commands.length - 1, index + (key.name === "up" ? -1 : 1)))
            ],
          );
        return "consumed";
      }
      return "declined";
    });
    target.once("destroyed", () => dispose?.());
  };
  const back = (primary = false) =>
    command(
      {
        id: "collection.inspector-back",
        verb: "Back",
        destination: "Entries / Relations",
        scope: "page",
        keys: ["enter", "return"],
        enabled: true,
        danger: false,
        intent: {
          kind: "collection-inspector-back",
          collection: props.collection.id,
        },
      },
      primary,
    );
  const execute = (record: RelationshipCommand) => {
    if (!record.enabled || !record.intent) return;
    props.onRelationship(record.intent);
  };
  const command = (record: RelationshipCommand, primary = false) => {
    const id = record.id;
    return (
      <CommandControl
        id={id}
        record={record}
        keyboard={!props.executeCommand}
        register={(target) => {
          props.bind(`command:${record.id}`, target);
          if (primary) props.bind("inspector", target);
          targets.push(target);
          target.once("destroyed", () => {
            const index = targets.indexOf(target);
            if (index >= 0) targets.splice(index, 1);
          });
          mode(target);
          return props.registerCommand?.(record, `command:${record.id}`, id, () => execute(record));
        }}
        execute={() => (props.executeCommand ? props.executeCommand(record.id) : execute(record))}
      />
    );
  };
  const toggle = (id: string, label: string, change: () => void) => (
    <CommandControl
      id={id}
      record={{
        id,
        verb: label,
        destination: "Membership details",
        scope: "page",
        keys: ["enter", "return"],
        enabled: true,
        danger: false,
      }}
      keyboard={!props.executeCommand}
      register={(target) => {
        props.bind(`command:${id}`, target);
        targets.push(target);
        target.once("destroyed", () => {
          const index = targets.indexOf(target);
          if (index >= 0) targets.splice(index, 1);
        });
        mode(target);
        return props.registerCommand?.(
          {
            id,
            verb: label,
            destination: "Membership details",
            scope: "page",
            keys: ["enter", "return"],
            enabled: true,
            danger: false,
          },
          `command:${id}`,
          id,
          change,
        );
      }}
      execute={() => (props.executeCommand ? props.executeCommand(id) : change())}
    />
  );
  return (
    <Show when={inspector()?.collection === props.collection.id}>
      {(() => {
        const current = inspector()!;
        if (current.kind === "membership") {
          const member = props.collection.members.find(
            (item) =>
              collectionMemberKey(item) === current.member || `${item.name}:0` === current.member,
          );
          if (!member)
            return (
              <box flexDirection="column">
                <text>Membership unavailable.</text>
                {back(true)}
              </box>
            );
          const origins = props.memberOrigins.filter(
            (row) =>
              row.name === member.name &&
              row.address.source === member.address.source &&
              row.address.path === member.address.path,
          );
          const selected = origins.find((origin) => origin.key === current.origin) ?? origins[0];
          const commands = relationshipCommands(props.collection.id, {
            kind: "membership",
            member: { ...member, available: props.memberAvailable(member.address) },
            origin: selected?.path,
          });
          return (
            <scrollbox
              flexGrow={1}
              minHeight={0}
              width="100%"
              id="collection-membership-inspector"
              ref={(target: ScrollBoxRenderable) => {
                props.bind("work-area", target);
                mode(target, true);
                if (!origins.length) props.bind("inspector", target);
              }}
            >
              <text wrapMode="word">
                {props.memberDescription(member.address) ?? "Skill description unavailable."}
              </text>
              <Show when={terminal().height > 16}>
                <text wrapMode="word">{`In ${props.collection.id} · ${selected?.origin ?? "Origin unavailable"}`}</text>
              </Show>
              <Show when={origins.length > 1}>
                <text>Origin</text>
                <DataList
                  id="collection-membership-origin"
                  height={Math.max(1, Math.min(origins.length, 4))}
                  flexShrink={0}
                  ref={(value: SelectRenderable) => {
                    props.bind("inspector", value);
                    mode(value, true);
                  }}
                  selectedIndex={Math.max(
                    0,
                    origins.findIndex((origin) => origin.key === current.origin),
                  )}
                  options={origins.map((origin) => ({
                    name: `${origin.origin}  ${origin.address.source}/${origin.address.path}`,
                    description: origin.description,
                    value: origin.key,
                  }))}
                  showDescription={false}
                  onChange={(index) => {
                    const origin = origins[index];
                    if (origin) props.collections.selectMembershipOrigin(origin.key);
                  }}
                  onSelect={(index) => {
                    const origin = origins[index];
                    if (origin) props.collections.selectMembershipOrigin(origin.key);
                  }}
                />
              </Show>
              {commands[0] && command(commands[0])}
              <Show when={commands.length > 1}>
                <Show when={commands.length > 1}>
                  {toggle("collection-membership-actions", "Actions", () =>
                    setShowActions(!showActions()),
                  )}
                </Show>
              </Show>
              {toggle("collection-membership-details", "Details", () =>
                setShowDetails(!showDetails()),
              )}
              <Show when={showActions()}>{commands.slice(1).map((record) => command(record))}</Show>
              <Show when={showDetails()}>
                <text>{`Target ${compactAddress(member.address)}`}</text>
                <text>
                  {selected?.path?.kind === "direct"
                    ? ownerWithProvenance(selected.path.owner, "Owner unavailable")
                    : (selected?.origin ?? "Owner unavailable")}
                </text>
              </Show>
              {back()}
            </scrollbox>
          );
        }
        const relation = props.relationRows.find(
          (item) => collectionRelationKey(item) === current.relation,
        );
        if (!relation)
          return (
            <box flexDirection="column">
              <text>Relation unavailable.</text>
              {back(true)}
            </box>
          );
        const commands = relationshipCommands(props.collection.id, {
          kind: "relation",
          relation,
        });
        return (
          <scrollbox
            flexGrow={1}
            minHeight={0}
            width="100%"
            id="collection-relation-inspector"
            ref={(target: ScrollBoxRenderable) => {
              props.bind("inspector", target);
              mode(target, true);
            }}
          >
            <text>
              {relation.intent?.kind === "collection-reference"
                ? relation.intent.description
                : relation.effect}
            </text>
            <text>{`Relation in ${props.collection.id}`}</text>
            {commands[0] && command(commands[0])}
            <Show when={commands.length > 1}>
              <Show when={commands.length > 1}>
                {toggle("collection-relation-actions", "Actions", () =>
                  setShowActions(!showActions()),
                )}
              </Show>
            </Show>
            {toggle("collection-relation-details", "Details", () => setShowDetails(!showDetails()))}
            <Show when={showActions()}>{commands.slice(1).map((record) => command(record))}</Show>
            <Show when={showDetails()}>
              <text>{`Target ${relation.target ?? props.collection.id}`}</text>
              <text>{ownerWithProvenance(relation.owner, "Owner unavailable")}</text>
            </Show>
            {back()}
          </scrollbox>
        );
      })()}
    </Show>
  );
}
