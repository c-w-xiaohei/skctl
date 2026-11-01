import { ScrollBoxRenderable, type BoxRenderable } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import type { CollectionView } from "@skctl/core";
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import type { ActionRecord } from "../actions";
import type { ExecutableCommand } from "../commands";
import { usePageCommands } from "../page-navigation";
import type { CommandRecord } from "../types";
import { SectionTabs } from "../components/section-tabs";
import { DataTable, type DataTableColumn } from "../ui/data-table";
import { Pane } from "../ui/pane";
import { useTheme } from "../ui/use-theme";
import type { CollectionTableRow } from "./collection-table";
import type { CollectionsPageProps } from "./page-props";
import { collectionMemberKey, collectionOriginKey } from "./state";
import {
  RelationshipInspector,
  collectionRelationKey,
  type CollectionMemberOriginRow,
  type CollectionRelationRow,
} from "./relationship-inspector";
import { collectionRelationRows, compactAddress, pathText } from "./relationship-model";
import { relationshipCommands } from "./relationship-commands";
import { Dialog, DialogContent } from "../ui/dialog";

function CurrentRowCommands(props: { readonly commands: readonly ExecutableCommand[] }) {
  usePageCommands(() => props.commands);
  return null;
}

export function CollectionDetail(
  props: Pick<
    CollectionsPageProps,
    | "collections"
    | "projection"
    | "focusRegistry"
    | "onTab"
    | "onInspectorFocus"
    | "onRelationship"
    | "onScroll"
    | "onToggleOrigins"
    | "onRemoveOrigins"
    | "registerCommand"
    | "executeCommand"
  > & {
    readonly collection: CollectionView;
    readonly issue?: string;
    readonly cycle?: boolean;
    readonly bind: Parameters<typeof RelationshipInspector>[0]["bind"];
    readonly commandZone: (id: string, record: CommandRecord, execute: () => void) => JSX.Element;
    readonly managedAction: (
      id: ActionRecord["id"],
      label?: string,
      onExecute?: () => void,
    ) => JSX.Element;
  },
) {
  // The page's keyed Collection mount owns this object's lifetime.
  const collection = props.collection;
  const terminal = useTerminalDimensions();
  const renderer = useRenderer();
  const tokens = useTheme();
  const selectedTab = () => props.collections.tab(collection.id);
  const [controlWidth, setControlWidth] = createSignal(0);
  const [adding, setAdding] = createSignal(false);
  let controls: BoxRenderable | undefined;
  let relationshipSelect: BoxRenderable | undefined;
  const retainScroll = (target: ScrollBoxRenderable, view: "description" | "settings") => {
    const surface = `collection:${collection.id}:${view}`;
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
  const memberRows = collection.members.map((member) => {
    const origins: CollectionMemberOriginRow[] = (
      member.paths.length ? member.paths : [undefined]
    ).map((path, index) => ({
      kind: "member" as const,
      name: member.name,
      address: member.address,
      origin: path ? pathText(path) : "Origin unavailable",
      description: `${member.address.source}/${member.address.path}\n${path ? pathText(path) : "Origin unavailable"}`,
      key: collectionOriginKey(collection.id, member, path, index),
      value: `${member.name}:${index}`,
      path,
    }));
    const summaries = [
      ...new Set(
        origins.map(({ path }) => {
          if (path?.kind === "repository-derived") return "Repository";
          if (path?.kind === "via-link")
            return `Included: ${path.links[0]?.linkedCollection ?? "Unknown"}`;
          return path ? pathText(path) : "Origin unavailable";
        }),
      ),
    ];
    const value =
      collection.members.filter((candidate) => candidate.name === member.name).length === 1
        ? `${member.name}:0`
        : collectionMemberKey(member);
    return {
      kind: "member" as const,
      name: member.name,
      address: member.address,
      origin:
        summaries.length === 0
          ? "Origin unavailable"
          : summaries.length === 1
            ? summaries[0]!
            : `${summaries.length} origins`,
      key: collectionMemberKey(member),
      value,
      origins,
    };
  });
  const memberOrigins = memberRows.flatMap((row) => row.origins);
  const relationRows = collectionRelationRows(collection.id, props.projection()!);
  const installedMember = (address: CollectionMemberOriginRow["address"]) =>
    props
      .projection()
      ?.installedSkills.find(
        (skill) => skill.address.source === address.source && skill.address.path === address.path,
      );
  const inspector = () => props.collections.inspector();
  const entryAddress = (row: {
    readonly name: string;
    readonly address: { readonly source: string; readonly path: string };
  }) => {
    const leaf = row.address.path.split("/").at(-1);
    const sameIdentity = memberRows.some(
      (candidate) =>
        candidate !== row &&
        candidate.name === row.name &&
        candidate.address.source === row.address.source &&
        candidate.address.path !== row.address.path,
    );
    return !sameIdentity && leaf === row.name
      ? row.address.source
      : sameIdentity
        ? `${row.address.source}/${row.address.path}`
        : compactAddress(row.address);
  };
  type ContentRow = CollectionTableRow<(typeof memberRows)[number] | CollectionRelationRow>;
  const relationRowsForTable = createMemo<readonly ContentRow[]>(() =>
    selectedTab() === "members"
      ? [
          ...memberRows.map(
            (row): ContentRow => ({
              key: row.key,
              value: row.value,
              domain: row,
              cells: [row.name, entryAddress(row), row.origin],
              destination: "Membership details",
            }),
          ),
          ...relationRows
            .filter((row) => row.kind === "collection-reference")
            .map(
              (row): ContentRow => ({
                key: collectionRelationKey(row),
                value: collectionRelationKey(row),
                domain: row,
                cells: [
                  row.intent?.kind === "collection-reference" ? row.intent.name : row.label,
                  row.target ?? "Unavailable",
                  "Reference",
                ],
                destination: "Collection details",
              }),
            ),
        ]
      : relationRows.map((row) => ({
          key: collectionRelationKey(row),
          value: collectionRelationKey(row),
          domain: row,
          cells: [
            row.label,
            row.kind === "collection-use"
              ? row.target
                ? `uses ${row.target}`
                : "active"
              : (row.target ?? ""),
            row.owner?.level ?? "Read-only",
            row.effect,
          ],
          destination: "Relationship details" as const,
        })),
  );
  const currentRow = () =>
    relationRowsForTable().find(
      (row) => row.value === props.collections.selectedRow(collection.id, selectedTab()),
    );
  const compactSelectionDescription = () => {
    const row = currentRow();
    if (!row) return undefined;
    if (row.domain.kind === "member")
      return installedMember(row.domain.address)?.description ?? "Skill description unavailable.";
    return row.domain.intent?.kind === "collection-reference"
      ? row.domain.intent.description
      : row.domain.effect;
  };
  const toggleSelectedEntryOrigins = (row: ContentRow) => {
    if (selectedTab() !== "members" || row.domain.kind !== "member") return false;
    props.onToggleOrigins?.(
      collection.id,
      row.domain.origins.map((origin) => origin.key),
    );
    return true;
  };
  const inspectRow = (row = currentRow()) => {
    if (!row) return;
    props.onRelationship(
      row.domain.kind === "member"
        ? { kind: "collection-membership-inspect", collection: collection.id, member: row.value }
        : { kind: "collection-relation-inspect", collection: collection.id, relation: row.value },
    );
  };
  const memberAvailable = (row: ContentRow) =>
    row.domain.kind !== "member" || installedMember(row.domain.address)?.owner.health === "healthy";
  const columns = (): readonly DataTableColumn<ContentRow>[] =>
    selectedTab() === "members"
      ? [
          {
            id: "name",
            header: "Name",
            minWidth: controlWidth() >= 38 ? 28 : 12,
            cell: (row) => row.cells[0] ?? "",
          },
          {
            id: "kind",
            header: "Type",
            width: 10,
            optional: true,
            cell: (row) => (row.domain.kind === "member" ? "Skill" : "Collection"),
          },
          {
            id: "target",
            header: "Source / target",
            minWidth: 12,
            maxWidth: 32,
            optional: true,
            cell: (row) => row.cells[1] ?? "",
          },
          {
            id: "origin",
            header: "Added through",
            minWidth: 10,
            maxWidth: 24,
            optional: true,
            cell: (row) => row.cells[2] ?? "",
          },
        ]
      : [
          { id: "name", header: "Relation", minWidth: 12, cell: (row) => row.cells[0] ?? "" },
          {
            id: "target",
            header: "Target",
            minWidth: 10,
            optional: true,
            cell: (row) => row.cells[1] ?? "",
          },
          {
            id: "owner",
            header: "Owner",
            minWidth: 8,
            maxWidth: 12,
            optional: true,
            cell: (row) => row.cells[2] ?? "",
          },
        ];
  const selectedOrigins = () => props.collections.selectedOrigins(collection.id);
  const checks = createMemo(() => {
    const selected = new Set(selectedOrigins());
    const checked = new Set<string>();
    const partial = new Set<string>();
    for (const row of memberRows) {
      const count = row.origins.filter((origin) => selected.has(origin.key)).length;
      if (count > 0) (count === row.origins.length ? checked : partial).add(row.value);
    }
    return { checked, partial };
  });
  const contentUnavailable = () => {
    const row = currentRow();
    if (row && !memberAvailable(row)) return "Installed Skill unavailable. Open Details.";
    if (row?.domain.kind === "collection-reference" && row.domain.targetAvailable === false)
      return "Referenced Collection unavailable";
    return undefined;
  };
  const commandsForRow = (row: ContentRow) =>
    relationshipCommands(
      collection.id,
      row.domain.kind === "member"
        ? {
            kind: "membership",
            member: { ...row.domain, available: memberAvailable(row) },
            origin: row.domain.origins.length === 1 ? row.domain.origins[0]?.path : undefined,
          }
        : { kind: "relation", relation: row.domain },
    );
  const currentCommands = (): readonly ExecutableCommand[] => {
    if (inspector() || props.collections.filter().open || selectedTab() !== "members") return [];
    const row = currentRow();
    if (!row) return [];
    // Reading has an exact address even when managing requires choosing an origin.
    const commands = commandsForRow(row)
      .filter(
        (command) =>
          row.domain.kind !== "member" ||
          row.domain.origins.length <= 1 ||
          command.id === "membership.open-skill",
      )
      .filter((command) => command.id !== "membership.remove")
      .map((command) => ({
        record: {
          ...command,
          destination: `${collection.id} / ${row.cells[0]}: ${command.destination}`,
        },
        execute: () => {
          if (!command.enabled || currentRow() !== row || inspector()) return;
          if (command.intent) props.onRelationship(command.intent);
        },
      }));
    if (
      row.domain.kind === "member" &&
      row.domain.origins.some(
        (origin) =>
          origin.path?.kind === "direct" && !!origin.path.owner && !origin.path.owner.contribution,
      )
    ) {
      commands.push({
        record: {
          id: "membership.remove",
          keys: ["enter"],
          verb: "Remove…",
          destination: collection.id,
          object: `${collection.id}:${row.domain.name}`,
          scopeText: "Current item. Choose the configuration to change in the removal dialog.",
          opens: "Removal preview",
          group: "member",
          scope: "page",
          enabled: true,
          danger: true,
        },
        execute: () => {
          if (currentRow() === row && !inspector() && row.domain.kind === "member")
            props.onRemoveOrigins?.(collection.id, row.domain.origins);
        },
      });
    }
    return commands;
  };
  return (
    <Pane
      id="collection-detail-pane"
      borderTitle={collection.id}
      borderBottomTitle={
        contentUnavailable() ?? (props.cycle ? "Reference cycle. See Instructions." : undefined)
      }
    >
      <>
        <CurrentRowCommands commands={currentCommands()} />
        <box height={1} flexShrink={0} flexDirection="row">
          <box flexGrow={1} flexBasis={0} minWidth={0}>
            <SectionTabs
              id="collection-tabs"
              options={[
                { label: "Contents", value: "members" },
                {
                  label: "Instructions",
                  value: "description",
                },
                { label: "Settings", value: "settings" },
              ]}
              value={selectedTab()}
              compact={terminal().width < 65}
              owner="inspector"
              focusRegistry={props.focusRegistry}
              onPrimaryPointerEntry={props.onInspectorFocus}
              onActivate={() =>
                props.focusRegistry?.applyFocus(
                  selectedTab() === "members" ? "collection-relationships" : "work-area",
                )
              }
              onNavigate={(value) => {
                const surface = `collection:${collection.id}:${selectedTab()}`;
                const selectedRow = props.collections.selectedRow(collection.id, selectedTab());
                props.collections.selectRow(collection.id, selectedTab(), selectedRow);
                const body = relationshipSelect?.findDescendantById(
                  "collection-relationships-body",
                );
                if (body instanceof ScrollBoxRenderable) props.onScroll?.(surface, body.scrollTop);
                props.onTab(collection.id, value);
              }}
            />
          </box>
        </box>
        <box
          id="collection-toolbar"
          width="100%"
          minWidth={0}
          flexDirection="row"
          flexWrap="wrap"
          flexShrink={0}
          gap={2}
          marginTop={terminal().height >= 24 ? 1 : 0}
          marginBottom={terminal().height >= 24 ? 1 : 0}
          ref={(value: BoxRenderable) => {
            controls = value;
            setControlWidth(value.width);
          }}
          onSizeChange={() => setControlWidth(controls?.width ?? 0)}
        >
          <box
            id="collection-content-controls-pane"
            minWidth={0}
            flexDirection="row"
            flexWrap="wrap"
            flexShrink={0}
            gap={1}
          >
            <Show when={selectedTab() === "members"}>
              {props.commandZone(
                "collection-add",
                {
                  id: "collection.add",
                  keys: ["enter"],
                  verb: "Add…",
                  destination: collection.id,
                  scope: "page",
                  enabled: true,
                  danger: false,
                },
                () => setAdding(true),
              )}
            </Show>
            <Show when={selectedTab() === "description"}>
              {props.managedAction("edit-collection-content", "Edit description & instructions…")}
            </Show>
            <Show when={selectedTab() === "settings"}>
              {props.managedAction("add-link", "Include Collection…")}
              {props.managedAction("import-collection", "Copy Skills…")}
            </Show>
          </box>
          <Show when={selectedTab() === "members" && currentRow()} keyed>
            {(row) => (
              <box flexDirection="column" flexShrink={0}>
                <box
                  id="collection-current-actions-pane"
                  minWidth={0}
                  flexDirection="row"
                  flexWrap="wrap"
                  flexShrink={0}
                  gap={1}
                >
                  {currentCommands()
                    .filter(
                      (command) =>
                        command.record.id === "membership.open-skill" ||
                        command.record.id === "relationship.open-collection",
                    )
                    .map((command) =>
                      props.commandZone(
                        `collection-current-${command.record.id}`,
                        { ...command.record, verb: row.domain.kind === "member" ? "Read" : "Open" },
                        command.execute,
                      ),
                    )}
                  {currentCommands()
                    .filter((command) => command.record.danger && command.record.enabled)
                    .map((command) =>
                      props.commandZone(
                        `collection-current-${command.record.id}`,
                        {
                          ...command.record,
                          verb: row.domain.kind === "member" ? "Remove…" : "Remove entry…",
                        },
                        command.execute,
                      ),
                    )}
                  <>
                    {props.commandZone(
                      "collection-current-details",
                      {
                        id: "collection.current.details",
                        keys: ["enter", "return"],
                        verb: "Details…",
                        destination: `${collection.id} / ${row.cells[0]}`,
                        object: `${collection.id} / ${row.cells[0]}`,
                        scopeText:
                          row.domain.kind === "member"
                            ? "How this Skill was added"
                            : "Collection entry details",
                        opens: "Details",
                        group: "member",
                        scope: "page",
                        enabled: true,
                        danger: false,
                      },
                      () => inspectRow(row),
                    )}
                  </>
                </box>
              </box>
            )}
          </Show>
        </box>
        <Show when={selectedTab() === "members" && selectedOrigins().length > 0}>
          <box id="collection-batch-pane" flexDirection="row" height={1} flexShrink={0}>
            <text flexGrow={1} minWidth={0} height={1} wrapMode="none">
              {checks().checked.size + checks().partial.size} items checked
            </text>
            {props.commandZone(
              "remove-from-collection",
              {
                id: "collection.remove-selected-origins",
                keys: ["enter", "return"],
                verb: "Review removal",
                destination: collection.id,
                object: collection.id,
                scopeText: `${checks().checked.size + checks().partial.size} items checked`,
                opens: "Removal review",
                group: "batch",
                scope: "page",
                enabled: true,
                danger: true,
              },
              () =>
                props.onRemoveOrigins?.(
                  collection.id,
                  memberOrigins.filter((row) =>
                    props.collections.selectedOrigins(collection.id).includes(row.key),
                  ),
                ),
            )}
          </box>
        </Show>
        <Show when={selectedTab() === "description"}>
          <scrollbox
            id="collection-description"
            flexGrow={1}
            minHeight={0}
            focusable
            ref={(value) => {
              props.bind("work-area", value);
              retainScroll(value, "description");
            }}
          >
            <Show when={props.issue}>
              <text wrapMode="word">{props.issue}</text>
            </Show>
            <text fg={tokens().colors.mutedForeground}>Description</text>
            <text wrapMode="word">{collection.description || "No description provided."}</text>
            <text fg={tokens().colors.mutedForeground}>Instructions</text>
            <text wrapMode="word">{collection.instructions || "No instructions provided."}</text>
          </scrollbox>
        </Show>
        <Show when={selectedTab() === "settings"}>
          <scrollbox
            id="collection-settings"
            flexGrow={1}
            minHeight={0}
            focusable
            ref={(value) => {
              props.bind("work-area", value);
              retainScroll(value, "settings");
            }}
          >
            {props.commandZone(
              "collection-rename",
              {
                id: "collection.rename",
                keys: ["enter", "return"],
                verb: "Rename…",
                destination: collection.id,
                scope: "page",
                enabled: true,
                danger: false,
              },
              () => props.onRelationship({ kind: "collection-rename", collection: collection.id }),
            )}
            <text>Configuration locations</text>
            <Show when={collection.repository.derived}>
              <text wrapMode="word">Repository-derived members remain owned by their Source.</text>
            </Show>
            <For each={collection.declared} fallback={<text>No Collection declaration.</text>}>
              {(owner) => (
                <box flexDirection="column" flexShrink={0}>
                  <text wrapMode="word">{`${owner.level}: ${owner.file}\n${owner.pointer}${owner.contribution ? "\nShared configuration (read-only)" : ""}`}</text>
                  {props.commandZone(
                    `collection-location-open-${owner.level}`,
                    {
                      id: `collection.location.open.${owner.level}.${owner.file}`,
                      keys: ["enter"],
                      verb: "Open configuration",
                      destination: owner.file,
                      scope: "page",
                      enabled: true,
                      danger: false,
                    },
                    () =>
                      props.onRelationship({
                        kind: "collection-open-config",
                        collection: collection.id,
                        owner,
                      }),
                  )}
                  <Show when={!owner.contribution}>
                    {props.commandZone(
                      `collection-remove-declaration-${encodeURIComponent(`${owner.level}:${owner.file}:${owner.pointer}`)}`,
                      {
                        id: `collection.remove-declaration.${encodeURIComponent(`${owner.level}:${owner.file}:${owner.pointer}`)}`,
                        keys: ["enter", "return"],
                        verb: "Remove declaration…",
                        destination: `${collection.id}: ${owner.level} ${owner.file} ${owner.pointer}`,
                        scope: "page",
                        enabled: true,
                        danger: true,
                      },
                      () =>
                        props.onRelationship({
                          kind: "collection-remove-declaration",
                          collection: collection.id,
                          owner,
                        }),
                    )}
                  </Show>
                </box>
              )}
            </For>
            <text>Agent catalog entry</text>
            <For
              each={
                props
                  .projection()
                  ?.configs.filter((config) => ["valid", "missing"].includes(config.file.status)) ??
                []
              }
            >
              {(config) => (
                <box flexDirection="column" flexShrink={0}>
                  <text>{`${config.level}: ${config.direct.collectionUse.some((entry) => entry.collection === collection.id) ? "Direct entry enabled" : "No direct entry"}`}</text>
                  <text wrapMode="word">{config.file.file}</text>
                  {props.commandZone(
                    `collection-use-${config.level}`,
                    {
                      id: `collection.use.${config.level}`,
                      keys: ["enter", "return"],
                      verb: `Edit ${config.level} catalog…`,
                      destination: `${config.level} Collection Use`,
                      scope: "page",
                      enabled: true,
                      danger: false,
                    },
                    () =>
                      props.onRelationship({ kind: "collection-use-level", level: config.level }),
                  )}
                </box>
              )}
            </For>
            <text>Included Collections</text>
            <For
              each={relationRows.filter((row) => row.kind === "collection-link")}
              fallback={<text>No included Collections.</text>}
            >
              {(row) => (
                <box flexDirection="column" flexShrink={0}>
                  <text wrapMode="word">{row.target}</text>
                  <text wrapMode="word">
                    {row.owner
                      ? `${row.owner.level}: ${row.owner.file}`
                      : "Configuration unavailable"}
                  </text>
                  <box flexDirection="row" flexWrap="wrap" gap={1}>
                    {props.commandZone(
                      `collection-included-open-${encodeURIComponent(collectionRelationKey(row))}`,
                      {
                        id: `collection.included.open.${collectionRelationKey(row)}`,
                        keys: ["enter"],
                        verb: "Open",
                        destination: row.target ?? "",
                        scope: "page",
                        enabled: !!row.target,
                        danger: false,
                      },
                      () =>
                        row.target &&
                        props.onRelationship({
                          kind: "collection-open-collection",
                          collection: collection.id,
                          target: row.target,
                        }),
                    )}
                    <For
                      each={relationshipCommands(collection.id, {
                        kind: "relation",
                        relation: row,
                      }).filter((command) => command.danger)}
                    >
                      {(command) =>
                        props.commandZone(
                          `collection-included-remove-${encodeURIComponent(collectionRelationKey(row))}`,
                          {
                            ...command,
                            id: `${command.id}.${collectionRelationKey(row)}`,
                            verb: "Stop including…",
                          },
                          () =>
                            command.enabled &&
                            command.intent &&
                            props.onRelationship(command.intent),
                        )
                      }
                    </For>
                  </box>
                </box>
              )}
            </For>
          </scrollbox>
        </Show>
        <Show when={selectedTab() === "members" && selectedTab()} keyed>
          {(view) => (
            <box
              id="collection-content-data-pane"
              width="100%"
              minWidth={0}
              flexDirection="column"
              flexGrow={1}
              minHeight={0}
            >
              <DataTable
                id="collection-relationships"
                rows={relationRowsForTable()}
                columns={columns()}
                rowKey={(row) => row.value}
                currentKey={props.collections.selectedRow(collection.id, view)}
                onCurrentChange={(value) => props.collections.selectRow(collection.id, view, value)}
                initialScrollTop={props.collections.scroll(`collection:${collection.id}:${view}`)}
                onScroll={(scroll) =>
                  props.onScroll?.(`collection:${collection.id}:${view}`, scroll)
                }
                selection={
                  view === "members"
                    ? {
                        get keys() {
                          return checks().checked;
                        },
                        get partialKeys() {
                          return checks().partial;
                        },
                        get showIndicators() {
                          return true;
                        },
                        canSelect: (row) => row.domain.kind === "member",
                        onToggle: toggleSelectedEntryOrigins,
                      }
                    : undefined
                }
                focusRegistry={props.focusRegistry}
                emptyText={
                  selectedTab() === "members"
                    ? "Add Skills or a Reference to this Collection."
                    : "No relationships in this Collection."
                }
                ref={(value) => {
                  relationshipSelect = value;
                  props.bind("collection-relationships", value);
                }}
                width="100%"
                flexGrow={1}
                onActivate={(option) => {
                  if (!memberAvailable(option)) return;
                  props.collections.selectRow(collection.id, view, option.value);
                  if (option.domain.kind === "member")
                    props.onRelationship({
                      kind: "collection-open-skill",
                      collection: collection.id,
                      address: option.domain.address,
                    });
                  else if (view === "members" && option.domain.kind === "collection-reference") {
                    if (option.domain.target && option.domain.targetAvailable !== false)
                      props.onRelationship({
                        kind: "collection-open-collection",
                        collection: collection.id,
                        target: option.domain.target,
                      });
                  } else inspectRow(option);
                }}
              />
            </box>
          )}
        </Show>
        <Show when={terminal().height > 18 && compactSelectionDescription()}>
          <text height={1} flexShrink={0} wrapMode="none" fg={tokens().colors.mutedForeground}>
            {compactSelectionDescription()}
          </text>
        </Show>
      </>
      <Show when={adding()}>
        <Dialog open onOpenChange={setAdding}>
          <DialogContent
            title="Add to Collection"
            width={Math.min(54, terminal().width - 4)}
            maxWidth={54}
            height={Math.min(11, terminal().height - 2)}
          >
            <box flexDirection="column">
              {props.managedAction("add-membership", "Add Skills…", () => setAdding(false))}
              <text>Choose installed Skills.</text>
              {props.managedAction("add-reference", "Add Collection entry…", () =>
                setAdding(false),
              )}
              <text>Open another Collection through an entry.</text>
              {props.managedAction("add-link", "Include Collection…", () => setAdding(false))}
              <text>Keep including its effective Skills.</text>
              {props.managedAction("import-collection", "Copy Skills…", () => setAdding(false))}
              <text>Copy current members once.</text>
            </box>
          </DialogContent>
        </Dialog>
      </Show>
      <RelationshipInspector
        collection={collection}
        memberOrigins={memberOrigins}
        relationRows={relationRows}
        memberAvailable={(address) => installedMember(address)?.owner.health === "healthy"}
        collections={props.collections}
        focusRegistry={props.focusRegistry}
        bind={props.bind}
        onRelationship={props.onRelationship}
        onScroll={props.onScroll}
        registerCommand={props.registerCommand}
        executeCommand={props.executeCommand}
      />
    </Pane>
  );
}
