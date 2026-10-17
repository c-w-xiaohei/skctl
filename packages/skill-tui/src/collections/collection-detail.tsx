import { ScrollBoxRenderable, type BoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import type { CollectionView } from "@skill-cli/core";
import { createMemo, createSignal, Show, type JSX } from "solid-js";
import type { ActionRecord } from "../actions";
import type { ExecutableCommand } from "../commands";
import { usePageCommands } from "../page-navigation";
import type { CommandRecord } from "../types";
import { SectionTabs } from "../components/section-tabs";
import { DataTable, type DataTableColumn, type DataTableAction } from "../ui/data-table";
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
    readonly managedAction: (id: ActionRecord["id"], label?: string) => JSX.Element;
  },
) {
  // The page's keyed Collection mount owns this object's lifetime.
  const collection = props.collection;
  const terminal = useTerminalDimensions();
  const tokens = useTheme();
  const selectedTab = () => props.collections.tab(collection.id);
  const [controlWidth, setControlWidth] = createSignal(0);
  let controls: BoxRenderable | undefined;
  let relationshipSelect: BoxRenderable | undefined;
  const memberRows = collection.members.map((member) => {
    const origins: CollectionMemberOriginRow[] = (
      member.paths.length ? member.paths : [undefined]
    ).map((path, index) => ({
      kind: "member" as const,
      name: member.name,
      address: member.address,
      origin: path ? pathText(path) : "Origin unavailable",
      description: `${member.address.source}/${member.address.path} · ${path ? pathText(path) : "Origin unavailable"}`,
      key: collectionOriginKey(collection.id, member, path, index),
      value: `${member.name}:${index}`,
      path,
    }));
    const summaries = [...new Set(origins.map((row) => row.origin))];
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
  const workAreaTitle = () => {
    const current = inspector();
    if (!current || current.collection !== collection.id) return "Collection details";
    if (current.kind === "collection") return collection.id;
    if (current.kind === "membership")
      return (
        collection.members.find(
          (member) =>
            collectionMemberKey(member) === current.member || `${member.name}:0` === current.member,
        )?.name ?? "Membership details"
      );
    return (
      relationRows.find((relation) => collectionRelationKey(relation) === current.relation)
        ?.label ?? "Relationship details"
    );
  };
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
    selectedTab() === "entries"
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
    ) ?? relationRowsForTable()[0];
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
    if (selectedTab() !== "entries" || row.domain.kind !== "member") return false;
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
    selectedTab() === "entries"
      ? [
          {
            id: "name",
            header: "Name",
            minWidth: controlWidth() >= 54 ? 24 : 12,
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
            header: "Origin",
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
    if (row && !memberAvailable(row)) return "Installed Skill unavailable · Manage for ownership";
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
  const rowActions = (row: ContentRow): readonly DataTableAction[] => [
    {
      key: "manage",
      record: {
        id: `collection.row.${encodeURIComponent(collection.id)}.${encodeURIComponent(row.value)}.manage`,
        keys: ["enter", "return"],
        scope: "page",
        enabled: true,
        danger: false,
        verb: "Manage…",
        destination: `${collection.id} / ${row.cells[0]}`,
      },
      execute: () => inspectRow(row),
    },
  ];
  const currentCommands = (): readonly ExecutableCommand[] => {
    if (inspector() || props.collections.filter().open) return [];
    const row = currentRow();
    if (!row) return [];
    // Reading has an exact address even when managing requires choosing an origin.
    return commandsForRow(row)
      .filter(
        (command) =>
          row.domain.kind !== "member" ||
          row.domain.origins.length <= 1 ||
          command.id === "membership.open-skill",
      )
      .map((command) => ({
        record: {
          ...command,
          destination: `${collection.id} / ${row.cells[0]} · ${command.destination}`,
        },
        execute: () => {
          if (!command.enabled || currentRow() !== row || inspector()) return;
          if (command.id === "membership.remove" && row.domain.kind === "member")
            props.onRemoveOrigins?.(collection.id, row.domain.origins);
          else if (command.intent) props.onRelationship(command.intent);
        },
      }));
  };
  return (
    <Pane
      id="collection-detail-pane"
      borderTitle={inspector() ? workAreaTitle() : collection.id}
      borderBottomTitle={
        contentUnavailable() ?? (props.cycle ? "Reference cycle · About for reason" : undefined)
      }
    >
      <Show when={!props.collections.inspector()}>
        <CurrentRowCommands commands={currentCommands()} />
        <box height={1} flexShrink={0} flexDirection="row">
          <box flexGrow={1} minWidth={0}>
            <SectionTabs
              id="collection-tabs"
              options={[
                { label: "Contents", value: "entries" },
                { label: "Relations", value: "relations" },
              ]}
              value={selectedTab()}
              owner="inspector"
              focusRegistry={props.focusRegistry}
              onPrimaryPointerEntry={props.onInspectorFocus}
              onActivate={() => props.focusRegistry?.applyFocus("collection-relationships")}
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
          {props.commandZone(
            "collection-about",
            {
              id: "collection.about",
              keys: ["enter", "return"],
              verb: "Info",
              destination: collection.id,
              scope: "page",
              enabled: true,
              danger: false,
            },
            () => props.onRelationship({ kind: "collection-info", collection: collection.id }),
          )}
        </box>
        <box
          id="collection-content-controls-pane"
          flexDirection="row"
          height={1}
          flexShrink={0}
          gap={1}
          ref={(value: BoxRenderable) => {
            controls = value;
            setControlWidth(value.width);
          }}
          onSizeChange={() => setControlWidth(controls?.width ?? 0)}
        >
          {props.managedAction("add-membership", "Add Skills…")}
          {props.managedAction("add-reference", "Add Reference…")}
          <Show when={controlWidth() >= 54}>
            {props.managedAction("add-link", "Link…")}
            {props.managedAction("import-collection", "Import…")}
          </Show>
        </box>
        <Show when={selectedOrigins().length > 0}>
          <box id="collection-batch-pane" flexDirection="row" height={1} flexShrink={0}>
            <text flexGrow={1} minWidth={0} height={1} wrapMode="none">
              {selectedOrigins().length} origins checked
            </text>
            {props.commandZone(
              "remove-from-collection",
              {
                id: "collection.remove-selected-origins",
                keys: ["enter", "return"],
                verb: "Review removal",
                destination: `${collection.id} · ${selectedOrigins().length} checked origins`,
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
        <Show when={selectedTab()} keyed>
          {(view) => (
            <box id="collection-content-data-pane" flexGrow={1} minHeight={0}>
              <DataTable
                id="collection-relationships"
                rows={relationRowsForTable()}
                columns={columns()}
                actions={{
                  width: 9,
                  compactWidth: 9,
                  items: rowActions,
                  registerCommand: props.registerCommand,
                }}
                rowKey={(row) => row.value}
                currentKey={props.collections.selectedRow(collection.id, view)}
                onCurrentChange={(value) => props.collections.selectRow(collection.id, view, value)}
                initialScrollTop={props.collections.scroll(`collection:${collection.id}:${view}`)}
                onScroll={(scroll) =>
                  props.onScroll?.(`collection:${collection.id}:${view}`, scroll)
                }
                selection={
                  view === "entries"
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
                  selectedTab() === "entries"
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
                  else if (view === "entries" && option.domain.kind === "collection-reference") {
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
      </Show>
      <RelationshipInspector
        collection={collection}
        contextIssue={props.issue}
        memberOrigins={memberOrigins}
        relationRows={relationRows}
        memberDescription={(address) => installedMember(address)?.description}
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
