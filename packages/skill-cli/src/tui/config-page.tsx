import { SelectRenderable } from "@opentui/core";
import { createEffect } from "solid-js";
import type { ConfigLevelView } from "../core/api";
import type { ActionDescriptor } from "./actions";
import type { ConfigSection, Destination, TuiState } from "./model";
import type { ConfigDeclarationOwner, SourceBindingView } from "../core/api";

export function ConfigPage(props: {
  readonly state: TuiState;
  readonly destination: Exclude<Destination, "workspace">;
  readonly actions: readonly ActionDescriptor[];
  readonly onSelect: (source: string) => void;
  readonly onActions: () => void;
  readonly onSection: (section: ConfigSection) => void;
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
    props.state.workspace?.configs.find((item) => item.level === props.destination);
  const section = () => props.state.memory[props.destination].section;
  const value = () => config();
  const selection = () => props.state.memory[props.destination].selection[section()];
  const handoffText = () => {
    const handoff = props.state.handoff;
    if (!handoff || handoff.kind === "agent-producer" || handoff.owner.level !== props.destination)
      return undefined;
    const owner = `${handoff.owner.file} ${handoff.owner.pointer}`;
    const configSourceOwner = handoff.owner.contribution?.configSource ?? handoff.owner;
    const configSource = () =>
      props.state.workspace?.configs
        .find((config) => config.level === configSourceOwner.level)
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
      return owner
        ? `Source declaration  ${source.id}\nOwner  ${owner.file} ${owner.pointer}`
        : undefined;
    }
    if (section() === "config-sources") {
      if (props.state.handoff?.kind === "source-contribution") return undefined;
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
  let configSourceBrowser: SelectRenderable | undefined;
  let collectionBrowser: SelectRenderable | undefined;
  let agentUseBrowser: SelectRenderable | undefined;
  let sectionBrowser: SelectRenderable | undefined;
  let sourceBrowser: SelectRenderable | undefined;
  let contributionBrowser: SelectRenderable | undefined;
  createEffect(() => {
    if (section() !== "sources" || selection()) return;
    const first = [...(value()?.direct.sources ?? []), ...(value()?.contributed.sources ?? [])][0];
    if (first) props.onSelect(first.id);
  });
  createEffect(() => {
    if (props.state.overlay) return;
    if (
      props.state.focus === "local-nav" ||
      (props.state.focus === "browser" && section() === "integrations")
    )
      sectionBrowser?.focus();
    else if (props.state.focus === "browser" && section() === "sources") sourceBrowser?.focus();
    else if (props.state.focus === "browser" && section() === "config-sources")
      configSourceBrowser?.focus();
    else if (props.state.focus === "config-source-contributions") contributionBrowser?.focus();
    else if (props.state.focus === "browser" && section() === "collections")
      collectionBrowser?.focus();
    else if (props.state.focus === "browser" && section() === "for-agents")
      agentUseBrowser?.focus();
  });
  const selectedConfigSource = () =>
    value()?.direct.configSources.find((item) => item.owner.pointer === selection());
  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1}>
      <text>
        {value()?.file.file ?? "Config"} {value()?.file.status ?? "missing"}
      </text>
      {!props.state.overlay && (
        <select
          id="config-section-browser"
          ref={(item: SelectRenderable) => {
            sectionBrowser = item;
          }}
          focused
          height={1}
          options={[
            { name: "Sources", description: "Browse Sources", value: "sources" },
            {
              name: "Config Sources",
              description: "Browse Config Sources",
              value: "config-sources",
            },
            { name: "Collections", description: "Browse Collections", value: "collections" },
            { name: "For agents", description: "Browse Collection Use", value: "for-agents" },
            { name: "Integrations", description: "Browse integrations", value: "integrations" },
          ]}
          selectedIndex={[
            "sources",
            "config-sources",
            "collections",
            "for-agents",
            "integrations",
          ].indexOf(section())}
          showDescription={false}
          onSelect={(_index, option) => {
            const value = option?.value;
            if (
              value === "sources" ||
              value === "config-sources" ||
              value === "collections" ||
              value === "for-agents" ||
              value === "integrations"
            )
              props.onSection(value);
          }}
        />
      )}
      <text>{`Section: ${section()}`}</text>
      {handoffText() && <text selectable>{handoffText()}</text>}
      {!handoffText() && sourceText() && <text selectable>{sourceText()}</text>}
      <scrollbox flexGrow={1}>
        {section() === "sources" && (
          <>
            <select
              id="config-source-browser"
              ref={(item: SelectRenderable) => {
                sourceBrowser = item;
                if (!props.state.overlay && props.state.focus === "browser") item.focus();
              }}
              focused={!props.state.overlay && props.state.focus === "browser"}
              height={10}
              options={[
                ...(value()?.direct.sources ?? []).map((item) => ({
                  name: `${item.id} Direct Source`,
                  description: item.origin,
                  value: item.id,
                })),
                ...(value()?.contributed.sources ?? []).map((item) => ({
                  name: `${item.id} via Config Source`,
                  description: item.origin,
                  value: item.id,
                })),
              ]}
              selectedIndex={Math.max(
                0,
                [
                  ...(value()?.direct.sources ?? []),
                  ...(value()?.contributed.sources ?? []),
                ].findIndex((item) => item.id === selection()),
              )}
              showDescription={false}
              onChange={(index) => {
                const items = [
                  ...(value()?.direct.sources ?? []),
                  ...(value()?.contributed.sources ?? []),
                ];
                props.onSelect(items[index]!.id);
              }}
              onSelect={() => props.onActions()}
            />
            {!value()?.direct.sources.length && !value()?.contributed.sources.length && (
              <box flexDirection="column" paddingTop={1}>
                <text>No Sources yet</text>
                <text>Add a Source, then Discover and Install Skills.</text>
                <select
                  focused={!props.state.overlay && props.state.focus === "browser"}
                  options={[{ name: "Add Source", description: "Register a Source", value: "add" }]}
                  showDescription={false}
                  onSelect={props.onActions}
                />
              </box>
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
                configSourceBrowser = item;
                if (!props.state.overlay && props.state.focus === "browser") item.focus();
              }}
              focused={!props.state.overlay && props.state.focus === "browser"}
              height={10}
              options={(value()?.direct.configSources ?? []).map((item) => ({
                name: item.id,
                description: `${item.owner.file} ${item.owner.pointer}`,
                value: item.owner.pointer,
              }))}
              selectedIndex={Math.max(
                0,
                (value()?.direct.configSources ?? []).findIndex(
                  (item) => item.owner.pointer === selection(),
                ),
              )}
              showDescription
              onChange={(index) => {
                const item = value()?.direct.configSources[index];
                if (item) props.onSelect(item.owner.pointer);
              }}
            />
            {!value()?.direct.configSources.length && (
              <box flexDirection="column" paddingTop={1}>
                <text>No Config Sources yet</text>
                <text>Register a reusable Config Source for this level.</text>
                <select
                  focused={!props.state.overlay && props.state.focus === "browser"}
                  options={[
                    {
                      name: "Add Config Source",
                      description: "Register a Config Source",
                      value: "add",
                    },
                  ]}
                  showDescription={false}
                  onSelect={props.onActions}
                />
              </box>
            )}
            {selectedConfigSource() && (
              <select
                id="config-source-contributions"
                ref={(item: SelectRenderable) => {
                  contributionBrowser = item;
                }}
                focused={
                  !props.state.overlay && props.state.focus === "config-source-contributions"
                }
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
                showDescription
                onSelect={(_index, option) => {
                  const current = selectedConfigSource();
                  if (!current || !option) return;
                  const [kind, index] = option.value.split(":");
                  if (kind === "source") {
                    const source = current.contributed.sources[Number(index)];
                    if (source)
                      props.onContribution({ kind: "source", source, owner: current.owner });
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
        {section() === "sources" && <text>Enter Actions</text>}
        {section() === "collections" && (
          <>
            <select
              id="config-collection-browser"
              ref={(item: SelectRenderable) => {
                collectionBrowser = item;
                if (!props.state.overlay && props.state.focus === "browser") item.focus();
              }}
              focused={!props.state.overlay && props.state.focus === "browser"}
              height={10}
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
              selectedIndex={Math.max(
                0,
                [
                  ...(value()?.direct.collections ?? []).map((item) => item.id),
                  ...(value()?.contributed.collections ?? []),
                ].indexOf(selection() ?? ""),
              )}
              showDescription
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
              <box flexDirection="column" paddingTop={1}>
                <text>No Collections yet</text>
                <text>Collections group Skills for reuse and agent disclosure.</text>
                <select
                  focused={!props.state.overlay && props.state.focus === "browser"}
                  options={[
                    { name: "New Collection", description: "Create a Collection", value: "new" },
                  ]}
                  showDescription={false}
                  onSelect={props.onActions}
                />
              </box>
            )}
          </>
        )}
        {section() === "for-agents" && (
          <box flexDirection="column">
            <text>For agents exposes selected Collections to Managed OpenCode.</text>
            <select
              id="config-agent-use-browser"
              ref={(item: SelectRenderable) => {
                agentUseBrowser = item;
                if (!props.state.overlay && props.state.focus === "browser") item.focus();
              }}
              focused={!props.state.overlay && props.state.focus === "browser"}
              height={10}
              options={(value()?.direct.collectionUse ?? []).map((item) => ({
                name: item.collection,
                description: `${item.owner.file} ${item.owner.pointer}`,
                value: item.collection,
              }))}
              selectedIndex={Math.max(
                0,
                (value()?.direct.collectionUse ?? []).findIndex(
                  (item) => item.collection === selection(),
                ),
              )}
              showDescription
              onChange={(index) => {
                const item = value()?.direct.collectionUse[index];
                if (item) props.onSelect(item.collection);
              }}
              onSelect={() => props.onActions()}
            />
          </box>
        )}
        {section() === "for-agents" && (
          <text selectable>
            {props.state.workspace?.effective.status === "complete" &&
            props.state.workspace.effective.agent.status === "available"
              ? `Complete disclosure. Managed OpenCode: ${props.state.workspace.effective.managed ? "enabled" : "disabled"}`
              : `Unavailable: ${(props.state.workspace?.effective.agent.reasons ?? []).map((item) => item.message).join("; ") || "Collection Use is incomplete or managed OpenCode is not enabled"}`}
          </text>
        )}
        {section() === "integrations" && (
          <>
            <text>Integrations connect this Config to agent hosts.</text>
            {(value()?.direct.integrations ?? []).map((integration) => (
              <text
                selectable
              >{`Managed OpenCode  ${integration.owner.file} ${integration.owner.pointer}`}</text>
            ))}
            <text selectable>
              {props.state.workspace?.effective.status === "complete" &&
              props.state.workspace.effective.agent.status === "available"
                ? `Managed OpenCode catalog: ${props.state.workspace.effective.agent.catalog.map((item) => `${item.selector}${item.aliases.length ? ` (${item.aliases.join(", ")})` : ""}`).join(", ") || "empty"}`
                : `Managed OpenCode unavailable: ${(props.state.workspace?.effective.agent.reasons ?? []).map((item) => item.message).join("; ") || "no complete Collection Use"}`}
            </text>
            {!value()?.direct.integrations.length && <text>Enter Enable Managed OpenCode</text>}
          </>
        )}
      </scrollbox>
    </box>
  );
}
