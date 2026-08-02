import { SelectRenderable, type BaseRenderable } from "@opentui/core";
import { onCleanup, Show } from "solid-js";
import type { ConfigLevelView, ManagementProjection } from "../core/api";
import type { ActionDescriptor } from "./actions";
import type { ConfigSection, Destination, RouteHandoff } from "./types";
import type { ConfigReadonly } from "./config/state";
import type { ConfigDeclarationOwner, SourceBindingView } from "../core/api";
import { SectionTabs } from "./components/section-tabs";
import { EmptyState } from "./presentation";
import type { FocusRegistry, FocusTarget } from "./focus";

type ConfigActionId =
  | "add-source"
  | "add-config-source"
  | "new-collection"
  | "set-collection-use"
  | "enable-managed-opencode"
  | "disable-managed-opencode";

export function ConfigPage(props: {
  readonly config: ConfigReadonly;
  readonly overlay?: () => boolean;
  readonly narrow?: boolean;
  readonly wide?: boolean;
  readonly handoff?: RouteHandoff;
  readonly projection: () => ManagementProjection | undefined;
  readonly focusRegistry?: FocusRegistry;
  readonly destination: Exclude<Destination, "workspace">;
  readonly actions: readonly ActionDescriptor[];
  readonly onSelect: (source: string) => void;
  readonly onActions: () => void;
  readonly onAction: (id: ConfigActionId) => void;
  readonly onSection: (section: ConfigSection) => void;
  readonly onLocalNavFocus?: () => void;
  readonly onContribution: (
    value:
      | {
          readonly kind: "source";
          readonly source: SourceBindingView;
          readonly owner: ConfigDeclarationOwner;
        }
      | {
          readonly kind: "collection";
          readonly collection: string;
          readonly owner: ConfigDeclarationOwner;
        },
  ) => void;
}) {
  const config = (): ConfigLevelView | undefined =>
    props.projection()?.configs.find((item) => item.level === props.destination);
  const section = () => props.config.section(props.destination);
  const value = () => config();
  const selection = () => props.config.selection(props.destination, section() as ConfigSection);
  const handoffText = () => {
    const handoff = props.handoff;
    if (!handoff || handoff.kind === "agent-producer" || handoff.owner.level !== props.destination)
      return undefined;
    const owner = `${handoff.owner.file} ${handoff.owner.pointer}`;
    const configSourceOwner = handoff.owner.contribution?.configSource ?? handoff.owner;
    const configSource = () =>
      props
        .projection()
        ?.configs.find((config) => config.level === configSourceOwner.level)
        ?.direct.configSources.find(
          (item) =>
            item.owner.file === configSourceOwner.file &&
            item.owner.pointer === configSourceOwner.pointer,
        );
    const configSourceFacts = () => {
      const source = configSource();
      if (!source) return "Config Source  Unavailable";
      const binding =
        source.binding.kind === "local"
          ? `Binding kind  local\nLocal path  ${source.binding.path}\nSource Root  ${source.binding.root}`
          : `Binding kind  ${source.binding.kind}\nCanonical Origin  ${source.binding.origin}\nSource Root  ${source.binding.root}\nTracked ref  ${source.binding.ref}`;
      return `Config Source  ${source.id}\n${source.adoption.status === "adopted" ? `Applied commit  ${source.adoption.commit}` : `Adoption  ${source.adoption.status}`}\n${binding}`;
    };
    if (handoff.kind === "source-declaration")
      return `Source declaration  ${handoff.source.id}\nOwner  ${owner}\nBinding kind  ${handoff.source.kind}\nCanonical Origin  ${handoff.source.origin}\nSource Root  ${handoff.source.root}${handoff.source.ref ? `\nTracked ref  ${handoff.source.ref}` : ""}`;
    if (handoff.kind === "source-contribution")
      return `Config Source host  ${owner}\nContributed Source  ${handoff.source.id}\nContributed declaration  ${handoff.source.contribution?.declaration.pointer ?? "Unavailable"}\n${configSourceFacts()}`;
    if (handoff.kind === "collection-membership")
      return `Collection handoff  ${handoff.address.source}/${handoff.address.path}\nCollection  ${handoff.collection}\nOwner  ${owner}`;
    if (handoff.kind === "agent-membership")
      return handoff.owner.contribution
        ? `Agent Membership handoff  ${handoff.collection}:${handoff.entry}\nConfig Source host  ${handoff.owner.contribution.configSource.file} ${handoff.owner.contribution.configSource.pointer}\nContributed declaration  ${handoff.owner.contribution.declaration.pointer ?? "Unavailable"}\n${configSourceFacts()}`
        : `Agent Membership handoff  ${handoff.collection}:${handoff.entry}\nOwner  ${owner}`;
    if (handoff.kind === "agent-link")
      return handoff.owner.contribution
        ? `Agent Link handoff  ${handoff.collection}->${handoff.linkedCollection}\nConfig Source host  ${handoff.owner.contribution.configSource.file} ${handoff.owner.contribution.configSource.pointer}\nContributed declaration  ${handoff.owner.contribution.declaration.pointer ?? "Unavailable"}\n${configSourceFacts()}`
        : `Agent Link handoff  ${handoff.collection}->${handoff.linkedCollection}\nOwner  ${owner}`;
    if (handoff.kind === "agent-use")
      return `Agent Collection Use handoff  ${handoff.collection}\nOwner  ${owner}`;
    if (handoff.kind === "uninstall-membership")
      return `Uninstall Membership handoff  ${handoff.address.source}/${handoff.address.path}\nCollection  ${handoff.collection ?? "Unavailable"}${handoff.entry ? `\nEntry  ${handoff.entry}` : ""}\nOwner  ${owner}\nEdit this exact Membership owner to resolve the blocker.`;
    return undefined;
  };
  const sourceText = () => {
    if (section() === "sources") {
      const source = [
        ...(value()?.direct.sources ?? []),
        ...(value()?.contributed.sources ?? []),
      ].find((item) => item.id === selection());
      if (!source) return undefined;
      const owner =
        source.contribution?.configSource ??
        value()?.direct.sources.find((item) => item.id === source.id)?.ref.owner;
      const provenance = source.contribution ? "Config Source" : "Direct";
      const trackedRef = typeof source.ref === "string" ? source.ref : source.ref?.id;
      return `Selected Source  ${source.id}\nBinding kind  ${source.kind}\nCanonical Origin  ${source.origin}\nSource Root  ${source.root}${trackedRef ? `\nTracked ref  ${trackedRef}` : ""}\nProvenance  ${provenance}${owner ? `\n${source.contribution ? "Config Source owner" : "Owner"}  ${owner.level} ${owner.file} ${owner.pointer}` : ""}`;
    }
    if (section() === "config-sources") {
      if (props.handoff?.kind === "source-contribution") return undefined;
      const source = value()?.direct.configSources.find(
        (item) => item.owner.pointer === selection(),
      );
      if (!source) return undefined;
      const binding =
        source.binding.kind === "local"
          ? `Binding kind  local\nLocal path  ${source.binding.path}\nSource Root  ${source.binding.root}`
          : `Binding kind  ${source.binding.kind}\nCanonical Origin  ${source.binding.origin}\nSource Root  ${source.binding.root}\nTracked ref  ${source.binding.ref}`;
      const adoption =
        source.adoption.status === "adopted"
          ? `Applied commit  ${source.adoption.commit}`
          : `Adoption  ${source.adoption.status}`;
      return `Selected > ${source.id}\nConfig Source  ${source.id}\nOwner  ${source.owner.file} ${source.owner.pointer}\n${binding}\n${adoption}`;
    }
    return undefined;
  };
  const declarationText = () => {
    if (section() === "collections") {
      const collection = (value()?.direct.collections ?? []).find(
        (item) => item.id === selection(),
      );
      return collection
        ? `Selected Collection  ${collection.id}\nOwner  ${collection.owner.file} ${collection.owner.pointer}`
        : undefined;
    }
    if (section() === "for-agents") {
      const use = (value()?.direct.collectionUse ?? []).find(
        (item) => item.collection === selection(),
      );
      return use
        ? `Selected Collection Use  ${use.collection}\nOwner  ${use.owner.file} ${use.owner.pointer}`
        : undefined;
    }
    return undefined;
  };
  const bindings = new Map<string, () => void>();
  const bind = (
    owner: Parameters<FocusRegistry["register"]>[0],
    target: FocusTarget & Pick<BaseRenderable, "once" | "off">,
  ) => {
    bindings.get(owner)?.();
    if (!props.focusRegistry) return;
    const dispose = props.focusRegistry.register(owner, target);
    const release = () => dispose();
    target.once("destroyed", release);
    bindings.set(owner, () => {
      target.off("destroyed", release);
      dispose();
    });
  };
  onCleanup(() => bindings.forEach((dispose) => dispose()));
  const selectedConfigSource = () =>
    value()?.direct.configSources.find((item) => item.owner.pointer === selection());
  const sectionIntro = () => {
    if (section() === "sources")
      return "Sources declared at this level. Skills are discovered and installed from Sources.";
    if (section() === "config-sources")
      return "Config Sources are reusable Configs adopted at this level; they contribute read-only Sources and Collections.";
    if (section() === "collections")
      return "Collections group Skills for reuse and agent disclosure at this level.";
    if (section() === "for-agents")
      return "For agents selects the Collections this Config discloses to agent hosts.";
    return "Integrations connect this Config to agent hosts.";
  };
  return (
    <box flexDirection={props.wide ? "row" : "column"} flexGrow={1} paddingLeft={1}>
      <Show when={!props.overlay?.()}>
        <SectionTabs
          id="config-section-browser"
          options={[
            { label: "Sources", compactLabel: "Sources", value: "sources" },
            {
              label: "Config Sources",
              compactLabel: "Config",
              value: "config-sources",
            },
            { label: "Collections", compactLabel: "Coll", value: "collections" },
            { label: "For agents", compactLabel: "Agents", value: "for-agents" },
            { label: "Integrations", compactLabel: "Int", value: "integrations" },
          ]}
          value={section() as ConfigSection}
          owner="local-nav"
          focusRegistry={props.focusRegistry}
          compact={props.narrow === true}
          label={props.wide ? "Navigation" : "Section"}
          vertical={props.wide}
          panelId={props.wide ? "config-navigation-panel" : undefined}
          onPrimaryPointerEntry={props.onLocalNavFocus}
          onNavigate={props.onSection}
        />
      </Show>
      <box
        id={props.wide ? "config-browser-panel" : undefined}
        flexDirection="column"
        flexGrow={1}
        border={props.wide}
      >
        <text>
          {props.wide ? "Browser · " : ""}
          {value()?.file.file ?? "Config"} {value()?.file.status ?? "missing"}
        </text>
        <Show
          when={handoffText()}
          fallback={
            <Show when={sourceText() ?? declarationText()}>
              {(text) => (
                <box flexDirection="column" flexShrink={0}>
                  {text()
                    .split("\n")
                    .map((line) => (
                      <text height={1} selectable>
                        {line}
                      </text>
                    ))}
                </box>
              )}
            </Show>
          }
        >
          {(text) => (
            <box flexDirection="column" paddingTop={1}>
              {text()
                .split("\n")
                .map((line) => (
                  <text height={1} selectable>
                    {line}
                  </text>
                ))}
            </box>
          )}
        </Show>
        <scrollbox flexGrow={1}>
          <text height={1}>{sectionIntro()}</text>
          {section() === "sources" && (
            <>
              <select
                id="config-source-browser"
                ref={(item: SelectRenderable) => {
                  bind("browser", item);
                }}
                flexGrow={1}
                options={[
                  ...(value()?.direct.sources ?? []).map((item) => ({
                    name: `${item.id} · ${item.kind}`,
                    description: `${item.origin} · ${item.root} · Direct`,
                    value: item.id,
                  })),
                  ...(value()?.contributed.sources ?? []).map((item) => ({
                    name: `${item.id} · ${item.kind}`,
                    description: `${item.origin} · ${item.root} · Config Source`,
                    value: item.id,
                  })),
                ]}
                selectedIndex={
                  selection()
                    ? [
                        ...(value()?.direct.sources ?? []),
                        ...(value()?.contributed.sources ?? []),
                      ].findIndex((item) => item.id === selection())
                    : undefined
                }
                showDescription={false}
                showSelectionIndicator
                showScrollIndicator
                onChange={(index) => {
                  const items = [
                    ...(value()?.direct.sources ?? []),
                    ...(value()?.contributed.sources ?? []),
                  ];
                  props.onSelect(items[index]!.id);
                }}
                onSelect={(index) => {
                  const items = [
                    ...(value()?.direct.sources ?? []),
                    ...(value()?.contributed.sources ?? []),
                  ];
                  props.onSelect(items[index]!.id);
                  props.onActions();
                }}
              />
              {!value()?.direct.sources.length && !value()?.contributed.sources.length && (
                <EmptyState
                  title="No Sources yet"
                  lines={["Add a Source at this level, then Discover and Install Skills."]}
                  action={{
                    id: "config-empty-add-source",
                    name: "Add Source",
                    description: "Register a Source at this level",
                    registerRef: (item) => item && bind("browser", item),
                    onSelect: () => props.onAction("add-source"),
                  }}
                  hint="Enter Actions → Add Source"
                />
              )}
            </>
          )}
          {section() === "config-sources" && (
            <>
              {(value()?.direct.configSources ?? []).map((item) => (
                <text>{`${item.owner.pointer === selection() ? "> " : "  "}${item.id}`}</text>
              ))}
              <select
                id="config-config-source-browser"
                ref={(item: SelectRenderable) => {
                  bind("browser", item);
                }}
                flexGrow={1}
                options={(value()?.direct.configSources ?? []).map((item) => ({
                  name: `${item.id} · ${item.binding.kind}`,
                  description: `${item.owner.file} ${item.owner.pointer}`,
                  value: item.owner.pointer,
                }))}
                selectedIndex={
                  selection()
                    ? (value()?.direct.configSources ?? []).findIndex(
                        (item) => item.owner.pointer === selection(),
                      )
                    : undefined
                }
                showDescription={false}
                showSelectionIndicator
                showScrollIndicator
                onChange={(index) => {
                  const item = value()?.direct.configSources[index];
                  if (item) props.onSelect(item.owner.pointer);
                }}
              />
              {!value()?.direct.configSources.length && (
                <EmptyState
                  title="No Config Sources yet"
                  lines={["Register a reusable Config Source for this level."]}
                  action={{
                    id: "config-empty-add-config-source",
                    name: "Add Config Source",
                    description: "Register a Config Source",
                    registerRef: (item) => item && bind("browser", item),
                    onSelect: () => props.onAction("add-config-source"),
                  }}
                  hint="Enter Actions → Add Config Source"
                />
              )}
              {selectedConfigSource() && (
                <select
                  id="config-source-contributions"
                  ref={(item: SelectRenderable) => {
                    bind("config-source-contributions", item);
                  }}
                  height={10}
                  options={[
                    ...selectedConfigSource()!.contributed.sources.map((source, index) => ({
                      name: `Source  ${source.id}`,
                      description: "Contributed read-only Source",
                      value: `source:${index}`,
                    })),
                    ...selectedConfigSource()!.contributed.collections.map((collection, index) => ({
                      name: `Collection  ${collection.id}`,
                      description: "Contributed read-only Collection",
                      value: `collection:${index}`,
                    })),
                  ]}
                  showDescription={false}
                  showSelectionIndicator
                  showScrollIndicator
                  onSelect={(_index, option) => {
                    const current = selectedConfigSource();
                    if (!current || !option) return;
                    const [kind, index] = option.value.split(":");
                    if (kind === "source") {
                      const source = current.contributed.sources[Number(index)];
                      if (source)
                        props.onContribution({
                          kind: "source",
                          source,
                          owner: current.owner,
                        });
                    } else {
                      const collection = current.contributed.collections[Number(index)];
                      if (collection)
                        props.onContribution({
                          kind: "collection",
                          collection: collection.id,
                          owner: collection.owner,
                        });
                    }
                  }}
                />
              )}
            </>
          )}
          {section() === "collections" && (
            <>
              <select
                id="config-collection-browser"
                ref={(item: SelectRenderable) => {
                  bind("browser", item);
                }}
                flexGrow={1}
                options={[
                  ...(value()?.direct.collections ?? []).map((item) => ({
                    name: `${item.id} (${item.owner.level})`,
                    description: `${item.owner.file} ${item.owner.pointer}`,
                    value: item.id,
                  })),
                  ...(value()?.contributed.collections ?? []).map((item) => ({
                    name: `${item} (Config Source)`,
                    description: "Contributed Collection",
                    value: item,
                  })),
                ]}
                selectedIndex={
                  selection()
                    ? [
                        ...(value()?.direct.collections ?? []).map((item) => item.id),
                        ...(value()?.contributed.collections ?? []),
                      ].indexOf(selection()!)
                    : undefined
                }
                showDescription={false}
                showSelectionIndicator
                showScrollIndicator
                onChange={(index) => {
                  const collections = [
                    ...(value()?.direct.collections ?? []).map((item) => item.id),
                    ...(value()?.contributed.collections ?? []),
                  ];
                  const collection = collections[index];
                  if (collection) props.onSelect(collection);
                }}
                onSelect={() => props.onActions()}
              />
              {!value()?.direct.collections.length && !value()?.contributed.collections.length && (
                <EmptyState
                  title="No Collections yet"
                  lines={["Collections group Skills for reuse and agent disclosure."]}
                  action={{
                    id: "config-empty-new-collection",
                    name: "New Collection",
                    description: "Create a Collection",
                    registerRef: (item) => item && bind("browser", item),
                    onSelect: () => props.onAction("new-collection"),
                  }}
                  hint="Enter Actions → New Collection"
                />
              )}
            </>
          )}
          {section() === "for-agents" && (
            <box flexDirection="column">
              <select
                id="config-agent-use-browser"
                ref={(item: SelectRenderable) => {
                  bind("browser", item);
                }}
                flexGrow={1}
                options={(value()?.direct.collectionUse ?? []).map((item) => ({
                  name: item.collection,
                  description: `${item.owner.file} ${item.owner.pointer}`,
                  value: item.collection,
                }))}
                selectedIndex={
                  selection()
                    ? (value()?.direct.collectionUse ?? []).findIndex(
                        (item) => item.collection === selection(),
                      )
                    : undefined
                }
                showDescription={false}
                showSelectionIndicator
                showScrollIndicator
                onChange={(index) => {
                  const item = value()?.direct.collectionUse[index];
                  if (item) props.onSelect(item.collection);
                }}
                onSelect={() => props.onActions()}
              />
              {!value()?.direct.collectionUse.length && (
                <EmptyState
                  title="No Collections exposed yet"
                  lines={[
                    "Collection Use selects which Collections agents can see.",
                    ...(!value()?.direct.collections.length &&
                    !value()?.contributed.collections.length
                      ? ["Create a Collection first (Collections section)."]
                      : []),
                  ]}
                  action={
                    value()?.direct.collections.length || value()?.contributed.collections.length
                      ? {
                          id: "config-empty-set-collection-use",
                          name: "Set Collection Use",
                          description: "Choose the Collections this Config discloses",
                          registerRef: (item) => item && bind("browser", item),
                          onSelect: () => props.onAction("set-collection-use"),
                        }
                      : undefined
                  }
                  hint={
                    value()?.direct.collections.length || value()?.contributed.collections.length
                      ? "Enter Actions → Set Collection Use"
                      : undefined
                  }
                />
              )}
            </box>
          )}
          {section() === "for-agents" && (
            <text selectable>
              {(() => {
                const workspace = props.projection();
                return workspace?.effective.status === "complete" &&
                  workspace.effective.agent.status === "available"
                  ? `Complete disclosure. Managed OpenCode: ${workspace.effective.managed ? "enabled" : "disabled"}`
                  : `Unavailable: ${(workspace?.effective.agent.reasons ?? []).map((item) => item.message).join("; ") || "Collection Use is incomplete or managed OpenCode is not enabled"}`;
              })()}
            </text>
          )}
          {section() === "integrations" && (
            <>
              {(value()?.direct.integrations ?? []).map((integration) => (
                <text
                  selectable
                >{`Managed OpenCode  ${integration.owner.file} ${integration.owner.pointer}`}</text>
              ))}
              <text selectable>
                {props.projection()?.effective.status === "complete" &&
                props.projection()!.effective.agent.status === "available"
                  ? `Managed OpenCode catalog: ${
                      props
                        .projection()!
                        .effective.agent.catalog.map((item) => item.selector)
                        .join(", ") || "empty"
                    }`
                  : `Managed OpenCode unavailable: ${(props.projection()?.effective.agent.reasons ?? []).map((item) => item.message).join("; ") || "no complete Collection Use"}`}
              </text>
              <select
                id="config-integrations-actions"
                ref={(item: SelectRenderable) => {
                  bind("browser", item);
                }}
                height={1}
                options={[
                  {
                    name: "Actions",
                    description: "Enable or disable managed OpenCode",
                    value: "actions",
                  },
                ]}
                showDescription={false}
                onSelect={() => {
                  const action = props.actions.find(
                    (
                      item,
                    ): item is ActionDescriptor & {
                      readonly id: "enable-managed-opencode" | "disable-managed-opencode";
                    } =>
                      item.id === "enable-managed-opencode" ||
                      item.id === "disable-managed-opencode",
                  );
                  if (action) props.onAction(action.id);
                }}
              />
              {!value()?.direct.integrations.length && (
                <text>No integrations yet. Enter Actions → Enable Managed OpenCode.</text>
              )}
            </>
          )}
        </scrollbox>
      </box>
    </box>
  );
}
