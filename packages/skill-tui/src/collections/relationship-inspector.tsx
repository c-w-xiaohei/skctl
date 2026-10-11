import {
  Renderable,
  ScrollBoxRenderable,
  SelectRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { Show } from "solid-js";
import type { CollectionView, ConfigDeclarationOwner } from "@skill-cli/core";
import type { MemberOriginPath } from "@skill-cli/core";
import { MetadataGrid } from "../ui/metadata-grid";
import { CommandControl } from "../command-control";
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
  readonly kind: "collection-use" | "collection-reference" | "collection-link";
  readonly label: string;
  readonly target?: string;
  readonly owner?: ConfigDeclarationOwner;
  readonly effect: string;
  readonly provenance?: string;
  readonly intent?: CollectionRelationshipIntent;
}
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
  const inspector = () => props.collections.inspector();
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
        intent: { kind: "collection-inspector-back", collection: props.collection.id },
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
            member,
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
              <text>{`Membership ${member.name}`}</text>
              <text>{`Collection ${props.collection.id}`}</text>
              <MetadataGrid
                fields={[
                  {
                    label: "Kind",
                    value: "Membership",
                    priority: 1,
                    wrap: "none",
                    narrow: "stack",
                  },
                  {
                    label: "Target",
                    value: compactAddress(member.address),
                    priority: 1,
                    wrap: "path",
                    narrow: "stack",
                  },
                  {
                    label: "Owner",
                    value:
                      selected?.path?.kind === "direct"
                        ? ownerWithProvenance(selected.path.owner, "Owner unavailable")
                        : (selected?.origin ?? "Owner unavailable"),
                    priority: 1,
                    wrap: "path",
                    narrow: "stack",
                  },
                  {
                    label: "Defined at",
                    value:
                      selected?.path?.kind === "direct" && selected.path.owner
                        ? ownerText(selected.path.owner)
                        : "Unavailable",
                    priority: 1,
                    wrap: "path",
                    narrow: "stack",
                  },
                  {
                    label: "Effect",
                    value: selected?.description ?? "Origin unavailable",
                    priority: 1,
                    wrap: "word",
                    narrow: "description",
                  },
                ]}
              />
              <text>Origin</text>
              <select
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
              <box flexDirection="column">
                {commands.map((record) => command(record))}
                {back()}
              </box>
            </scrollbox>
          );
        }
        const relation = props.relationRows[Number(current.relation.split(":")[1] ?? -1)];
        if (!relation)
          return (
            <box flexDirection="column">
              <text>Relation unavailable.</text>
              {back(true)}
            </box>
          );
        const commands = relationshipCommands(props.collection.id, { kind: "relation", relation });
        const title =
          relation.kind === "collection-use"
            ? `Collection Use ${props.collection.id}`
            : relation.kind === "collection-reference"
              ? `Reference ${relation.intent?.kind === "collection-reference" ? relation.intent.name : (relation.target ?? "unavailable")}`
              : `Link ${relation.target ?? "unavailable"}`;
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
            <text>{title}</text>
            <text>{`Collection ${props.collection.id}`}</text>
            <MetadataGrid
              fields={[
                {
                  label: "Kind",
                  value:
                    relation.kind === "collection-use"
                      ? "Collection Use"
                      : relation.kind === "collection-reference"
                        ? "Reference"
                        : "Link",
                  priority: 1,
                  wrap: "none",
                  narrow: "stack",
                },
                {
                  label: "Target",
                  value: relation.target ?? props.collection.id,
                  priority: 1,
                  wrap: "word",
                  narrow: "stack",
                },
                {
                  label: "Owner",
                  value: ownerWithProvenance(relation.owner, "Owner unavailable"),
                  priority: 1,
                  wrap: "path",
                  narrow: "stack",
                },
                {
                  label: "Defined at",
                  value: relation.owner ? ownerText(relation.owner) : "Unavailable",
                  priority: 1,
                  wrap: "path",
                  narrow: "stack",
                },
                {
                  label: "Effect",
                  value: relation.effect,
                  priority: 1,
                  wrap: "word",
                  narrow: "description",
                },
              ]}
            />
            <box flexDirection="column">
              {commands.map((record) => command(record))}
              {back()}
            </box>
          </scrollbox>
        );
      })()}
    </Show>
  );
}
