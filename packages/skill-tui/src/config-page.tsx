import {
  ScrollBoxRenderable,
  SelectRenderable,
  type BaseRenderable,
  type Renderable,
} from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { ConfigLevelView, ManagementProjection } from "@skill-cli/core";
import type { ActionRecord } from "./actions";
import type {
  CommandExecution,
  CommandRecord,
  CommandRegistration,
  ConfigSection,
  Destination,
  LayoutMode,
  FocusOwner,
  RouteHandoff,
} from "./types";
import type { ConfigReadonly } from "./config/state";
import type { ConfigDeclarationOwner, SourceBindingView } from "@skill-cli/core";
import type { FocusRegistry, FocusTarget } from "./focus";
import type { NavKey } from "./navigation";
import { configIntegrationRows } from "./config/state";
import { CommandControl } from "./command-control";
import { usePageReturn } from "./page-navigation";
import { DataList } from "./ui/data-list";
import { Pane } from "./ui/pane";
import { useTheme } from "./ui/use-theme";
import { MetadataGrid, type MetadataField } from "./ui/metadata-grid";

type ConfigActionId =
  | "add-source"
  | "add-config-source"
  | "new-collection"
  | "set-collection-use"
  | "enable-managed-opencode"
  | "disable-managed-opencode"
  | "config-observe"
  | "config-forget"
  | "config-remove"
  | "check-updates"
  | "add-skills"
  | "remove-source";

type ConfigSource = ConfigLevelView["direct"]["configSources"][number];

type DetailFact = readonly [label: string, value: string];
const factsText = (facts: readonly DetailFact[]) =>
  facts.map(([label, value]) => `${label}  ${value}`).join("\n");
const bindingFacts = (
  binding: ConfigSource["binding"] | Pick<SourceBindingView, "kind" | "origin" | "root" | "ref">,
): readonly DetailFact[] => [
  ["Binding kind", binding.kind],
  "path" in binding ? ["Local path", binding.path] : ["Canonical Origin", binding.origin],
  ["Source Root", binding.root],
  ...("ref" in binding && binding.ref !== undefined ? [["Tracked ref", binding.ref] as const] : []),
];
const configSourceDetails = (source: ConfigSource) => ({
  binding: bindingFacts(source.binding),
  adoption: [
    ["Adoption", source.adoption.status],
    ...(source.adoption.status === "adopted"
      ? [["Applied commit", source.adoption.commit] as const]
      : []),
  ] satisfies DetailFact[],
});

export function ConfigPage(props: {
  readonly config: ConfigReadonly;
  readonly overlay?: () => boolean;
  readonly mode?: LayoutMode;
  readonly registerCommand?: CommandRegistration;
  readonly executeCommand?: CommandExecution;
  readonly handoff?: RouteHandoff;
  readonly projection: () => ManagementProjection | undefined;
  readonly focusRegistry?: FocusRegistry;
  readonly destination: Exclude<Destination, "workspace">;
  readonly actions: readonly ActionRecord[];
  readonly onSelect: (source: string) => void;
  readonly onAction: (id: ConfigActionId) => void;
  readonly onOpenConfigSourceInspector?: () => void;
  readonly onBackConfigSourceInspector?: () => void;
  readonly onBackIntegrationSurface?: () => void;
  readonly onIntegrationOwner?: (owner: ConfigDeclarationOwner) => void;
  readonly onCollectionOwner?: (collection: string, owner: ConfigDeclarationOwner) => void;
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
  const renderer = useRenderer();
  const terminal = useTerminalDimensions();
  const tokens = useTheme();
  const [pageRoot, setPageRoot] = createSignal<Renderable>();
  const compactSourceLayout = () =>
    terminal().height <= 18 &&
    props.mode !== "wide" &&
    (section() === "sources" || section() === "config-sources");
  let workScroll: ScrollBoxRenderable | undefined;
  const revealWorkCommand = (target: Renderable) => {
    queueMicrotask(() => {
      const scroll = workScroll;
      if (!scroll || scroll.isDestroyed || target.isDestroyed) return;
      const top = scroll.screenY;
      const bottom = top + scroll.height;
      if (target.screenY < top)
        scroll.scrollTop = Math.max(0, scroll.scrollTop - (top - target.screenY));
      else if (target.screenY + target.height > bottom)
        scroll.scrollTop += target.screenY + target.height - bottom;
      renderer.requestRender();
    });
  };
  const revealBrowser = (target: SelectRenderable) => {
    const onFocus = () => revealWorkCommand(target);
    target.on("focused", onFocus);
    target.once("destroyed", () => target.off("focused", onFocus));
  };
  const config = (): ConfigLevelView | undefined =>
    props.projection()?.configs.find((item) => item.level === props.destination);
  const section = () => props.config.section(props.destination);
  const value = () => config();
  const sourceItems = () => [
    ...(value()?.direct.sources ?? []),
    ...(value()?.contributed.sources ?? []),
  ];
  const selectedSourceId = () => selection() ?? sourceItems()[0]?.id;
  const selectedSource = () => sourceItems().find((item) => item.id === selectedSourceId());
  const fileProblem = () => {
    const file = value()?.file;
    return file && file.status !== "valid" && file.status !== "missing" ? file : undefined;
  };
  const selection = () => props.config.selection(props.destination, section() as ConfigSection);
  const backIntegrationSurface = () => {
    if (props.onBackIntegrationSurface) props.onBackIntegrationSurface();
    else props.config.backIntegrationSurface(props.destination);
  };
  const backConfigSource = () => {
    if (props.onBackConfigSourceInspector) props.onBackConfigSourceInspector();
    else props.config.backConfigSourceSurface(props.destination);
  };
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
      const facts = configSourceDetails(source);
      return `Config Source  ${source.id}\n${factsText(facts.adoption.slice(-1))}\n${factsText(facts.binding)}`;
    };
    if (handoff.kind === "source-declaration")
      return `Source declaration  ${handoff.source.id}\nOwner  ${owner}\n${factsText(bindingFacts({ ...handoff.source, ref: handoff.source.ref || undefined }))}`;
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
    if (handoff.kind === "config-integration")
      return `Managed OpenCode integration\nOwner  ${owner}\nRead-only owner context. Edit the owning Config directly.`;
    if (handoff.kind === "uninstall-membership")
      return `Uninstall Membership handoff  ${handoff.address.source}/${handoff.address.path}\nCollection  ${handoff.collection ?? "Unavailable"}${handoff.entry ? `\nEntry  ${handoff.entry}` : ""}\nOwner  ${owner}\nEdit this exact Membership owner to resolve the blocker.`;
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
    const disposeMode = props.focusRegistry.registerModeHandler(target, (key) =>
      handleModeKey(owner, target, key),
    );
    const release = () => {
      disposeMode();
      dispose();
    };
    target.once("destroyed", release);
    bindings.set(owner, () => {
      target.off("destroyed", release);
      release();
    });
  };
  onCleanup(() => bindings.forEach((dispose) => dispose()));
  const selectedConfigSource = () =>
    value()?.direct.configSources.find((item) => item.owner.pointer === selection()) ??
    (compactSourceLayout() ? value()?.direct.configSources[0] : undefined);
  const selectedConfigSourceDetails = createMemo(() => {
    const source = selectedConfigSource();
    return source ? { source, ...configSourceDetails(source) } : undefined;
  });
  const integrationRows = () => configIntegrationRows(props.projection(), value());
  const selectedIntegration = () => integrationRows().find((row) => row.key === selection());
  const integrationStatus = () => props.projection()?.effective.agent.status;
  const integrationReasons = () => props.projection()?.effective.agent.reasons ?? [];
  const integrationCatalog = () => props.projection()?.effective.agent.catalog ?? [];
  // Select mutates its native index before notifying Solid. Keep the controlled
  // index in this mounted page so a config snapshot repaint cannot restore the
  // previous row between ArrowDown and Enter.
  const [catalogSelectedIndex, setCatalogSelectedIndex] = createSignal(0);
  let integrationCatalogBrowser: SelectRenderable | undefined;
  const selectedCatalogEntry = () =>
    integrationCatalog().find(
      (entry) => entry.selector === props.config.integrationCatalogSelection(props.destination),
    );
  const sharedReturn = usePageReturn(() => {
    if (fileProblem() || !props.projection()) return undefined;
    // Owner/selection changes invalidate the previous layer's registered instance.
    void selection();
    void props.config.integrationCatalogSelection(props.destination);
    const sourceInspector =
      section() === "config-sources" &&
      props.config.configSourceSurface(props.destination) === "inspector" &&
      !!selectedConfigSource();
    const integrationSurface = props.config.integrationSurface(props.destination);
    const integrationInspector = section() === "integrations" && integrationSurface !== "list";
    if (!sourceInspector && !integrationInspector) return undefined;
    const catalogEntry = integrationInspector && integrationSurface === "catalog-entry";
    const record: CommandRecord = {
      id: sourceInspector
        ? "config.source.back"
        : catalogEntry
          ? "config.catalog.back"
          : "config.integration.back",
      verb: sourceInspector
        ? "Back to Config Sources"
        : catalogEntry
          ? "Back to Integration"
          : "Back to Integrations",
      destination: sourceInspector
        ? "Config Sources"
        : catalogEntry
          ? "Integration inspector"
          : "Integrations",
      scope: "page",
      keys: ["enter", "return"],
      enabled: true,
      danger: false,
    };
    return {
      record,
      anchor: pageRoot,
      execute: sourceInspector ? backConfigSource : backIntegrationSurface,
    };
  });
  const selectedCollection = () =>
    value()?.direct.collections.find((item) => item.id === selection());
  const selectedCollectionId = () => {
    const id = selection();
    return id &&
      (value()?.direct.collections.some((item) => item.id === id) ||
        value()?.contributed.collections.includes(id))
      ? id
      : undefined;
  };
  const selectedCollectionUse = () =>
    value()?.direct.collectionUse.find((item) => item.collection === selection());
  const collectionOwner = () => {
    const id = selectedCollectionId();
    if (!id || selectedCollectionUse()) return undefined;
    return props
      .projection()
      ?.configs.flatMap((config) => config.direct.collectionUse)
      .find((item) => item.collection === id)?.owner;
  };
  const action = (id: ConfigActionId) => props.actions.find((item) => item.id === id);
  const command = (
    id: string,
    record: CommandRecord,
    execute: () => void,
    reveal?: (target: Renderable) => void,
  ) => (
    <CommandControl
      id={id}
      record={record}
      keyboard={!props.executeCommand}
      register={(target) => {
        if (reveal) {
          const onFocus = () => reveal(target);
          target.on("focused", onFocus);
          target.once("destroyed", () => target.off("focused", onFocus));
        }
        const owner = `command:${record.id}` as const;
        bind(owner, target);
        return props.registerCommand?.(record, owner, id, execute);
      }}
      execute={() => (props.executeCommand ? props.executeCommand(record.id) : execute())}
    />
  );
  const actionCommand = (
    id: ConfigActionId,
    label?: string,
    reveal?: (target: Renderable) => void,
  ) => {
    const record = action(id);
    return record
      ? command(
          `config-command-${id}`,
          label ? { ...record, verb: label } : record,
          () => props.onAction(id),
          reveal,
        )
      : null;
  };
  const configSourceUpdate = (reveal?: (target: Renderable) => void) =>
    actionCommand("config-observe", "Check / review Config update…", reveal);
  const SourceActions = (options: { readonly compact?: boolean }) => {
    const reveal = () => (options.compact ? revealWorkCommand : undefined);
    return (
      <>
        <box flexDirection="row" flexWrap="wrap" gap={1} minWidth={0} flexShrink={0}>
          {actionCommand("check-updates", "Check updates", reveal())}
          {actionCommand("add-skills", "Find and install…", reveal())}
          <Show when={options.compact}>{actionCommand("add-source", "Add Source…", reveal())}</Show>
        </box>
        <box flexDirection="row" flexWrap="wrap" gap={1} minWidth={0} flexShrink={0}>
          {actionCommand("remove-source", "Remove Source declaration…", reveal())}
        </box>
      </>
    );
  };
  const localCommand = (id: string, verb: string, destination: string, execute: () => void) =>
    command(
      `config-command-${id}`,
      {
        id,
        keys: ["enter", "return"],
        verb,
        destination,
        scope: "page",
        enabled: true,
        danger: false,
      },
      execute,
      compactSourceLayout() ? revealWorkCommand : undefined,
    );
  const mounted = (owner: FocusOwner) => {
    const target = props.focusRegistry?.target(owner);
    return target &&
      !("isDestroyed" in target && target.isDestroyed) &&
      !("parent" in target && !target.parent)
      ? target
      : undefined;
  };
  const enabledCommand = (id: string): FocusOwner | undefined => {
    const owner = `command:${id}` as const;
    const target = mounted(owner);
    return target && "focusable" in target && target.focusable ? owner : undefined;
  };
  const controls = (): FocusOwner[] => {
    const ids =
      section() === "sources"
        ? ["check-updates", "add-skills", "remove-source", "add-source"]
        : section() === "config-sources"
          ? [
              "config-observe",
              "config-forget",
              "config-remove",
              ...(!sharedReturn ? ["config.source.back"] : []),
              "add-config-source",
            ]
          : section() === "collections"
            ? ["set-collection-use", "config.collection.open-owner", "new-collection"]
            : props.config.integrationSurface(props.destination) === "catalog-entry"
              ? !sharedReturn
                ? ["config.catalog.back"]
                : []
              : [
                  "enable-managed-opencode",
                  "disable-managed-opencode",
                  "config.integration.open-owner",
                  ...(!sharedReturn ? ["config.integration.back"] : []),
                ];
    return ids.flatMap((id) => {
      const owner = enabledCommand(id);
      return owner ? [owner] : [];
    });
  };
  const enterPrimary = () => {
    const destination = props.destination;
    const currentSection = section();
    queueMicrotask(() => {
      if (
        renderer.isDestroyed ||
        props.overlay?.() ||
        props.destination !== destination ||
        section() !== currentSection
      )
        return;
      const selectedAction = controls().find(
        (owner) =>
          !["command:add-source", "command:add-config-source", "command:new-collection"].includes(
            owner,
          ) &&
          !owner.endsWith(".back") &&
          !props.actions.find((record) => `command:${record.id}` === owner)?.danger,
      );
      const empty =
        section() === "sources"
          ? sourceItems().length === 0
          : section() === "config-sources"
            ? !value()?.direct.configSources.length
            : section() === "collections"
              ? !value()?.direct.collections.length && !value()?.contributed.collections.length
              : integrationRows().length === 0;
      const owner =
        selectedAction ??
        (empty ? controls()[0] : undefined) ??
        (mounted("config-source-contributions") &&
        selectedConfigSource() &&
        selectedConfigSource()!.contributed.sources.length +
          selectedConfigSource()!.contributed.collections.length >
          0
          ? "config-source-contributions"
          : mounted("details-metadata")
            ? "details-metadata"
            : "work-area");
      props.focusRegistry?.applyFocus(owner);
    });
  };
  const enterConfigSource = () => {
    if (props.onOpenConfigSourceInspector) props.onOpenConfigSourceInspector();
    else props.config.openConfigSourceInspector(props.destination);
    enterPrimary();
  };
  const enterContributions = () => {
    const target = mounted("config-source-contributions");
    return target instanceof SelectRenderable && target.options.length > 0
      ? props.focusRegistry?.applyFocus("config-source-contributions") === true
      : false;
  };
  const handleModeKey = (owner: FocusOwner, target: FocusTarget, key: NavKey) => {
    if (
      props.overlay?.() ||
      key.ctrl ||
      key.shift ||
      key.alt ||
      key.meta ||
      key.option ||
      key.super ||
      key.hyper
    )
      return "declined" as const;
    if (owner === "browser" && target instanceof SelectRenderable) {
      if (key.name === "right") {
        const option = target.options[target.getSelectedIndex()];
        if (!option) return "consumed" as const;
        props.onSelect(option.value);
        if (section() === "config-sources") enterConfigSource();
        else if (section() === "integrations") {
          props.config.openIntegrationInspector(props.destination);
          queueMicrotask(() => props.focusRegistry?.applyFocus("inspector") || enterPrimary());
        } else enterPrimary();
        return "consumed" as const;
      }
      if (key.name === "up" && target.getSelectedIndex() === 0) {
        const toolbarId =
          section() === "sources"
            ? "add-source"
            : section() === "config-sources"
              ? "add-config-source"
              : section() === "collections"
                ? "new-collection"
                : undefined;
        const toolbar = toolbarId && enabledCommand(toolbarId);
        if (toolbar) props.focusRegistry?.applyFocus(toolbar);
        return "consumed" as const;
      }
      return "declined" as const;
    }
    if (
      owner === "config-source-contributions" &&
      key.name === "right" &&
      target instanceof SelectRenderable
    ) {
      openContribution(target.options[target.getSelectedIndex()]?.value);
      return "consumed" as const;
    }
    if (
      (owner === "config-source-contributions" || owner === "inspector") &&
      target instanceof SelectRenderable &&
      key.name === "down" &&
      target.getSelectedIndex() === target.options.length - 1
    ) {
      enterPrimary();
      return "consumed" as const;
    }
    if (owner === "inspector" && target instanceof SelectRenderable && key.name === "right") {
      const entry = integrationCatalog()[target.getSelectedIndex()];
      if (entry) {
        props.config.openIntegrationCatalogEntry(props.destination, entry.selector);
        queueMicrotask(() => props.focusRegistry?.applyFocus("inspector"));
      }
      return "consumed" as const;
    }
    if (owner === "details-metadata" && (key.name === "right" || key.name === "enter")) {
      enterPrimary();
      return "consumed" as const;
    }
    if (owner === "work-area" && (key.name === "right" || key.name === "enter")) {
      if (section() === "integrations" && mounted("inspector"))
        props.focusRegistry?.applyFocus("inspector");
      else enterPrimary();
      return "consumed" as const;
    }
    if (!owner.startsWith("command:")) return "declined" as const;
    if (key.name === "right") {
      if (section() === "config-sources") {
        if (props.config.configSourceSurface(props.destination) === "list") {
          enterConfigSource();
          queueMicrotask(enterContributions);
        } else enterContributions();
      } else if (section() === "integrations") props.focusRegistry?.applyFocus("inspector");
      else if (!props.focusRegistry?.applyFocus("details-metadata"))
        props.focusRegistry?.applyFocus("work-area");
      return "consumed" as const;
    }
    if (key.name !== "up" && key.name !== "down") return "declined" as const;
    const toolbarId =
      section() === "sources"
        ? "add-source"
        : section() === "config-sources"
          ? "add-config-source"
          : section() === "collections"
            ? "new-collection"
            : undefined;
    if (owner === `command:${toolbarId}` && key.name === "down" && mounted("browser")) {
      props.focusRegistry?.applyFocus("browser");
      return "consumed" as const;
    }
    const sequence = controls();
    const index = sequence.indexOf(owner);
    if (index >= 0)
      props.focusRegistry?.applyFocus(
        sequence[
          Math.max(0, Math.min(sequence.length - 1, index + (key.name === "down" ? 1 : -1)))
        ]!,
      );
    return "consumed" as const;
  };
  const openContribution = (value: string | undefined) => {
    const current = selectedConfigSource();
    if (!current || !value) return;
    const [kind, index] = value.split(":");
    if (kind === "source") {
      const source = current.contributed.sources[Number(index)];
      if (source) props.onContribution({ kind: "source", source, owner: current.owner });
    } else {
      const collection = current.contributed.collections[Number(index)];
      if (collection)
        props.onContribution({
          kind: "collection",
          collection: collection.id,
          owner: collection.owner,
        });
    }
  };
  const sectionIntro = () => {
    if (section() === "sources")
      return "Sources declared at this level. Skills are discovered and installed from Sources.";
    if (section() === "config-sources")
      return "Config Sources are reusable Configs adopted at this level; they contribute read-only Sources and Collections.";
    if (section() === "collections")
      return "Collections group Skills for reuse; select a Collection to manage its Use.";
    return "Integrations connect this Config to agent hosts.";
  };
  const selectedDetails = createMemo<
    | {
        readonly text?: string;
        readonly fields: readonly MetadataField[];
      }
    | undefined
  >(() => {
    const field = (label: string, text: string): MetadataField => ({
      label,
      value: text || ".",
      priority: 1,
      wrap: "word",
      narrow: "stack",
    });
    const bindingField = ([label, text]: DetailFact) =>
      field(
        label === "Binding kind"
          ? "Kind"
          : label === "Canonical Origin"
            ? "Origin"
            : label === "Source Root"
              ? "Root"
              : label,
        text,
      );
    if (section() === "sources") {
      const source = selectedSource();
      if (!source) return undefined;
      const direct = value()?.direct.sources.find((item) => item.id === source.id);
      const owner = source.contribution?.configSource ?? direct?.ref.owner;
      const trackedRef = typeof source.ref === "string" ? source.ref : direct?.trackedRef;
      const binding = bindingFacts({ ...source, ref: trackedRef ?? "None" });
      return {
        text: `Selected Source  ${source.id}\n${factsText(binding)}\nProvenance  ${source.contribution ? "Config Source" : "Direct"}${owner ? `\n${source.contribution ? "Config Source owner" : "Owner"}  ${owner.level} ${owner.file} ${owner.pointer}` : ""}`,
        fields: [
          field("Source", source.id),
          ...binding.map(bindingField),
          field(
            "Editable",
            source.contribution
              ? "No · contributed by a Config Source"
              : "Yes · direct declaration",
          ),
          ...(owner
            ? [field("Owner", `${owner.level} ${owner.file}`), field("Declaration", owner.pointer)]
            : []),
        ],
      };
    }
    if (section() === "config-sources") {
      const facts = selectedConfigSourceDetails();
      if (!facts) return undefined;
      const { source } = facts;
      return {
        text:
          source.owner.pointer === selection() && props.handoff?.kind !== "source-contribution"
            ? `Selected > ${source.id}\nConfig Source  ${source.id}\nOwner  ${source.owner.file} ${source.owner.pointer}\n${factsText(facts.binding)}\n${factsText(facts.adoption.slice(-1))}`
            : undefined,
        fields: [
          field("Config Source", source.id),
          ...facts.binding.map(bindingField),
          ...facts.adoption.map(([label, value]) => field(label, value)),
          field("Owner", source.owner.file),
          field("Declaration", source.owner.pointer),
        ],
      };
    }
    const collection = section() === "collections" ? selectedCollection() : undefined;
    return collection
      ? {
          text: `Selected Collection  ${collection.id}\nOwner  ${collection.owner.file} ${collection.owner.pointer}`,
          fields: [],
        }
      : undefined;
  });
  const metadata = () => handoffText() ?? selectedDetails()?.text;
  const Metadata = () => (
    <Show
      when={
        !props.handoff && selectedDetails()?.fields.length ? selectedDetails()?.fields : undefined
      }
      fallback={
        <text selectable wrapMode="word">
          {metadata()}
        </text>
      }
    >
      {(fields) => <MetadataGrid fields={fields()} />}
    </Show>
  );
  const splitMetadata = () => props.mode === "wide" && !!metadata() && !fileProblem();
  const paneTitle = () =>
    section() === "config-sources"
      ? "Config Sources"
      : section() === "sources"
        ? "Sources"
        : section() === "collections"
          ? "Collections"
          : "Integrations";
  const surface = (
    <box id="config-page-pane" ref={setPageRoot} flexDirection="row" flexGrow={1} minHeight={0}>
      <Pane
        id="config-work-area"
        title={terminal().height < 20 ? undefined : paneTitle()}
        borderTitle={terminal().height < 20 ? paneTitle() : undefined}
        width={splitMetadata() ? "43%" : "100%"}
      >
        <Show
          when={fileProblem()}
          fallback={
            <>
              <Show
                when={
                  compactSourceLayout() &&
                  (section() === "sources" ? !!selectedSource() : !!selectedConfigSource())
                }
              >
                <text height={1} flexShrink={0} wrapMode="none">
                  {section() === "sources"
                    ? `Selected Source  ${selectedSourceId() ?? "None"} · ${selectedSource()?.kind ?? "Source"} · Actions ↓`
                    : `Selected Config Source  ${selectedConfigSource()?.id ?? "None"} · ${selectedConfigSource()?.binding.kind ?? "binding unavailable"} · Actions ↓`}
                </text>
              </Show>
              <scrollbox
                ref={(target: ScrollBoxRenderable) => {
                  workScroll = target;
                  bind("work-area", target);
                }}
                flexGrow={1}
                minHeight={0}
              >
                <Show when={!compactSourceLayout()}>
                  <text wrapMode="word" fg={tokens().colors.mutedForeground}>
                    {sectionIntro()}
                  </text>
                </Show>
                <Show when={!compactSourceLayout()}>
                  <box flexDirection="column" gap={1} marginTop={1} marginBottom={1}>
                    <Show
                      when={
                        !compactSourceLayout() &&
                        section() === "sources" &&
                        (value()?.direct.sources.length ?? 0) +
                          (value()?.contributed.sources.length ?? 0) >
                          0
                      }
                    >
                      {actionCommand("add-source", "Add Source…")}
                    </Show>
                    <Show
                      when={
                        section() === "config-sources" && !!value()?.direct.configSources.length
                      }
                    >
                      {actionCommand(
                        "add-config-source",
                        "Add Config Source…",
                        compactSourceLayout() ? revealWorkCommand : undefined,
                      )}
                    </Show>
                    <Show
                      when={
                        section() === "collections" &&
                        (value()?.direct.collections.length ?? 0) +
                          (value()?.contributed.collections.length ?? 0) >
                          0
                      }
                    >
                      {actionCommand("new-collection", "New Collection…")}
                    </Show>
                  </box>
                </Show>
                <Show when={!splitMetadata() && metadata()}>
                  <Show when={!compactSourceLayout()}>
                    <box flexDirection="column" marginTop={1} marginBottom={1}>
                      <Metadata />
                    </box>
                  </Show>
                </Show>
                <Show when={section() === "sources"} fallback={null}>
                  <>
                    <Show
                      when={
                        (value()?.direct.sources.length ?? 0) +
                          (value()?.contributed.sources.length ?? 0) >
                        0
                      }
                      fallback={null}
                    >
                      <DataList
                        id="config-source-browser"
                        ref={(item: SelectRenderable | undefined) => {
                          if (!item) return;
                          revealBrowser(item);
                          bind("browser", item);
                        }}
                        height={
                          compactSourceLayout() ? 1 : Math.max(3, Math.min(8, sourceItems().length))
                        }
                        minHeight={compactSourceLayout() ? 1 : 3}
                        flexShrink={0}
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
                            ? sourceItems().findIndex((item) => item.id === selection())
                            : compactSourceLayout() && sourceItems().length > 0
                              ? 0
                              : undefined
                        }
                        showDescription={false}
                        showSelectionIndicator
                        showScrollIndicator
                        onChange={(index) => {
                          props.onSelect(sourceItems()[index]!.id);
                        }}
                        onSelect={(index) => {
                          props.onSelect(sourceItems()[index]!.id);
                          enterPrimary();
                        }}
                      />
                    </Show>
                    <Show
                      when={!value()?.direct.sources.length && !value()?.contributed.sources.length}
                      fallback={null}
                    >
                      <box flexDirection="column">
                        <text>No Sources yet</text>
                        <text>Add a Source at this level, then Discover and Install Skills.</text>
                        {actionCommand(
                          "add-source",
                          undefined,
                          compactSourceLayout() ? revealWorkCommand : undefined,
                        )}
                      </box>
                    </Show>
                  </>
                </Show>
                <Show when={section() === "config-sources"} fallback={null}>
                  <>
                    <Show when={(value()?.direct.configSources.length ?? 0) > 0} fallback={null}>
                      <DataList
                        id="config-config-source-browser"
                        ref={(item: SelectRenderable | undefined) => {
                          if (!item) return;
                          revealBrowser(item);
                          bind("browser", item);
                        }}
                        height={
                          compactSourceLayout()
                            ? 1
                            : Math.max(3, Math.min(8, value()?.direct.configSources.length ?? 0))
                        }
                        minHeight={compactSourceLayout() ? 1 : 3}
                        flexShrink={0}
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
                            : compactSourceLayout() && value()?.direct.configSources.length
                              ? 0
                              : undefined
                        }
                        showDescription={false}
                        showSelectionIndicator
                        showScrollIndicator
                        onChange={(index) => {
                          const item = value()?.direct.configSources[index];
                          if (item) props.onSelect(item.owner.pointer);
                        }}
                        onSelect={(index) => {
                          const item = value()?.direct.configSources[index];
                          if (item) {
                            props.onSelect(item.owner.pointer);
                            enterConfigSource();
                          }
                        }}
                      />
                    </Show>
                    <Show when={!value()?.direct.configSources.length} fallback={null}>
                      <box flexDirection="column">
                        <text>No Config Sources yet</text>
                        <text>Register a reusable Config Source for this level.</text>
                        {actionCommand(
                          "add-config-source",
                          undefined,
                          compactSourceLayout() ? revealWorkCommand : undefined,
                        )}
                      </box>
                    </Show>
                    <Show
                      when={
                        selectedConfigSource() &&
                        props.config.configSourceSurface(props.destination) === "inspector"
                      }
                      fallback={null}
                    >
                      {selectedConfigSource() ? (
                        <box id="config-source-inspector" flexDirection="column" gap={1}>
                          <box
                            id="config-source-update-actions"
                            flexDirection="row"
                            flexWrap="wrap"
                            gap={1}
                            minWidth={0}
                            flexShrink={0}
                          >
                            {configSourceUpdate(
                              compactSourceLayout() ? revealWorkCommand : undefined,
                            )}
                          </box>
                          <box
                            id="config-source-danger-actions"
                            flexDirection="row"
                            flexWrap="wrap"
                            gap={1}
                            minWidth={0}
                            flexShrink={0}
                          >
                            {actionCommand(
                              "config-forget",
                              undefined,
                              compactSourceLayout() ? revealWorkCommand : undefined,
                            )}
                            {actionCommand(
                              "config-remove",
                              undefined,
                              compactSourceLayout() ? revealWorkCommand : undefined,
                            )}
                          </box>
                          <text>{`Config Source  ${selectedConfigSource()!.id}`}</text>
                          <text>{`Owner  ${selectedConfigSource()!.owner.file} ${selectedConfigSource()!.owner.pointer}`}</text>
                          <text>{`Binding kind  ${selectedConfigSource()!.binding.kind}`}</text>
                          {selectedConfigSourceDetails()!
                            .binding.slice(1)
                            .flatMap(([label, text]) =>
                              `${label}  ${text}`.split("\n").map((line) => <text>{line}</text>),
                            )}
                          <text>
                            {factsText(selectedConfigSourceDetails()!.adoption.slice(-1))}
                          </text>
                          <text>{`Contributed Sources  ${selectedConfigSource()!.contributed.sources.length}`}</text>
                          <text>{`Contributed Collections  ${selectedConfigSource()!.contributed.collections.length}`}</text>
                          <Show when={!sharedReturn}>
                            {localCommand(
                              "config.source.back",
                              "Back to Config Sources",
                              "Config Sources",
                              backConfigSource,
                            )}
                          </Show>
                          <DataList
                            id="config-source-contributions"
                            ref={(item: SelectRenderable) => {
                              revealBrowser(item);
                              bind("config-source-contributions", item);
                            }}
                            height={compactSourceLayout() ? 2 : 8}
                            flexShrink={0}
                            options={[
                              ...selectedConfigSource()!.contributed.sources.map(
                                (source, index) => ({
                                  name: `Source  ${source.id}`,
                                  description: "Contributed read-only Source",
                                  value: `source:${index}`,
                                }),
                              ),
                              ...selectedConfigSource()!.contributed.collections.map(
                                (collection, index) => ({
                                  name: `Collection  ${collection.id}`,
                                  description: "Contributed read-only Collection",
                                  value: `collection:${index}`,
                                }),
                              ),
                            ]}
                            showDescription={false}
                            showSelectionIndicator
                            showScrollIndicator
                            onSelect={(_index, option) => openContribution(option?.value)}
                          />
                        </box>
                      ) : null}
                    </Show>
                  </>
                </Show>
                <Show when={compactSourceLayout() && section() === "sources" && !!selectedSource()}>
                  <box flexDirection="column" gap={1}>
                    <SourceActions compact />
                  </box>
                </Show>
                <Show
                  when={
                    compactSourceLayout() &&
                    section() === "config-sources" &&
                    !!selectedConfigSource() &&
                    props.config.configSourceSurface(props.destination) === "list"
                  }
                >
                  <box flexDirection="column" gap={1}>
                    {actionCommand("add-config-source", "Add Config Source…", revealWorkCommand)}
                    {configSourceUpdate(revealWorkCommand)}
                  </box>
                </Show>
                <Show when={compactSourceLayout() && section() === "sources" && !!selectedSource()}>
                  <box flexDirection="column">
                    <Metadata />
                  </box>
                </Show>
                <Show
                  when={
                    compactSourceLayout() &&
                    section() === "config-sources" &&
                    !!selectedConfigSource()
                  }
                >
                  <box flexDirection="column">
                    <Metadata />
                  </box>
                </Show>
                <Show when={section() === "collections"} fallback={null}>
                  <>
                    <Show
                      when={
                        (value()?.direct.collections.length ?? 0) +
                          (value()?.contributed.collections.length ?? 0) >
                        0
                      }
                      fallback={null}
                    >
                      <DataList
                        id="config-collection-browser"
                        ref={(item: SelectRenderable) => {
                          revealBrowser(item);
                          bind("browser", item);
                        }}
                        height={Math.max(
                          3,
                          Math.min(
                            8,
                            (value()?.direct.collections.length ?? 0) +
                              (value()?.contributed.collections.length ?? 0),
                          ),
                        )}
                        minHeight={3}
                        flexShrink={0}
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
                        onSelect={(index) => {
                          const collections = [
                            ...(value()?.direct.collections ?? []).map((item) => item.id),
                            ...(value()?.contributed.collections ?? []),
                          ];
                          const collection = collections[index];
                          if (collection) {
                            props.onSelect(collection);
                            enterPrimary();
                          }
                        }}
                      />
                    </Show>
                    <Show when={!!selectedCollectionId()} fallback={null}>
                      <box
                        id="config-collection-commands"
                        flexDirection="row"
                        flexWrap="wrap"
                        gap={1}
                        minWidth={0}
                        flexShrink={0}
                      >
                        {!!(selectedCollection() || selectedCollectionUse()) &&
                          actionCommand("set-collection-use")}
                        {!!collectionOwner() &&
                          localCommand(
                            "config.collection.open-owner",
                            "Open Collection Use owner",
                            `${collectionOwner()!.level} ${collectionOwner()!.file} ${collectionOwner()!.pointer}`,
                            () => {
                              const owner = collectionOwner();
                              const id = selection();
                              if (owner && id) props.onCollectionOwner?.(id, owner);
                            },
                          )}
                      </box>
                    </Show>
                    <Show
                      when={
                        !value()?.direct.collections.length &&
                        !value()?.contributed.collections.length
                      }
                      fallback={null}
                    >
                      <box flexDirection="column">
                        <text>No Collections yet</text>
                        <text>Collections group Skills for reuse and agent disclosure.</text>
                        {actionCommand("new-collection")}
                      </box>
                    </Show>
                  </>
                </Show>
                <Show
                  when={section() === "integrations" && props.projection() === undefined}
                  fallback={null}
                >
                  <text>Loading Config integrations...</text>
                </Show>
                <Show
                  when={section() === "integrations" && props.projection() !== undefined}
                  fallback={null}
                >
                  <>
                    {props.config.integrationSurface(props.destination) === "list" && (
                      <>
                        <Show when={integrationRows().length > 0} fallback={null}>
                          <DataList
                            id="config-integrations-browser"
                            ref={(item: SelectRenderable) => {
                              revealBrowser(item);
                              bind("browser", item);
                            }}
                            height={Math.max(3, Math.min(8, integrationRows().length))}
                            minHeight={3}
                            flexShrink={0}
                            options={integrationRows().map((row) => ({
                              name: `Managed OpenCode · ${row.direct ? "Direct" : "Read-only"}`,
                              description: `${row.owner.level} ${row.owner.file} ${row.owner.pointer}`,
                              value: row.key,
                            }))}
                            selectedIndex={Math.max(
                              0,
                              integrationRows().findIndex((row) => row.key === selection()),
                            )}
                            showDescription={false}
                            showSelectionIndicator
                            showScrollIndicator
                            onChange={(index) => {
                              const row = integrationRows()[index];
                              if (row) props.onSelect(row.key);
                            }}
                            onSelect={(index) => {
                              const row = integrationRows()[index];
                              if (row) {
                                props.onSelect(row.key);
                                props.config.openIntegrationInspector(props.destination);
                                queueMicrotask(
                                  () =>
                                    props.focusRegistry?.applyFocus("inspector") || enterPrimary(),
                                );
                              }
                            }}
                          />
                        </Show>
                        <Show
                          when={!integrationRows().length && integrationStatus() === "available"}
                          fallback={null}
                        >
                          <box flexDirection="column">
                            <text>Managed OpenCode Available · Catalog empty</text>
                            <text>No catalog entries are currently exposed.</text>
                          </box>
                        </Show>
                        <Show
                          when={!integrationRows().length && integrationStatus() !== "available"}
                          fallback={null}
                        >
                          <box flexDirection="column">
                            <text>Managed OpenCode Unavailable</text>
                            {integrationReasons().map((reason) => (
                              <text>{reason.message}</text>
                            ))}
                            {actionCommand("enable-managed-opencode")}
                          </box>
                        </Show>
                      </>
                    )}
                    <Show
                      keyed
                      when={
                        props.config.integrationSurface(props.destination) !== "list"
                          ? props.config.integrationSurface(props.destination)
                          : undefined
                      }
                    >
                      {(_surface) => (
                        <scrollbox
                          id={
                            props.config.integrationSurface(props.destination) === "catalog-entry"
                              ? "config-catalog-entry-inspector"
                              : "config-integration-inspector"
                          }
                          ref={(target: ScrollBoxRenderable) =>
                            bind(
                              props.config.integrationSurface(props.destination) === "catalog-entry"
                                ? "inspector"
                                : "work-area",
                              target,
                            )
                          }
                          flexGrow={1}
                          minHeight={0}
                        >
                          <Show
                            when={
                              props.config.integrationSurface(props.destination) !== "catalog-entry"
                            }
                            fallback={
                              <Show
                                when={selectedCatalogEntry()}
                                fallback={
                                  <>
                                    <text>Catalog entry unavailable.</text>
                                    <Show when={!sharedReturn}>
                                      {localCommand(
                                        "config.catalog.back",
                                        "Back to Integration",
                                        "Integration inspector",
                                        backIntegrationSurface,
                                      )}
                                    </Show>
                                  </>
                                }
                              >
                                {(entry) => (
                                  <>
                                    <text>{`Catalog Entry  ${entry().selector}`}</text>
                                    <text>{`Name  ${entry().name}`}</text>
                                    <text>{`Description  ${entry().description || "None"}`}</text>
                                    <text>{`Aliases  ${entry().aliases.join(", ") || "None"}`}</text>
                                    <Show when={!sharedReturn}>
                                      {localCommand(
                                        "config.catalog.back",
                                        "Back to Integration",
                                        "Integration inspector",
                                        backIntegrationSurface,
                                      )}
                                    </Show>
                                  </>
                                )}
                              </Show>
                            }
                          >
                            <text>Managed OpenCode</text>
                            <text>{`Status  ${integrationStatus() === "available" ? "Available" : "Unavailable"}`}</text>
                            <text>{`Owner  ${selectedIntegration()?.owner.level ?? props.destination} ${selectedIntegration()?.owner.file ?? value()?.file.file ?? "Config"} ${selectedIntegration()?.owner.pointer ?? "Unavailable"}`}</text>
                            <text>{`Collection Use  ${
                              props
                                .projection()
                                ?.effective.agent.use.map((owner) => owner.level)
                                .join(", ") || "none"
                            }`}</text>
                            <Show
                              when={integrationStatus() === "available"}
                              fallback={
                                <>
                                  {integrationReasons().map((reason) => (
                                    <text>{`Reason  ${reason.message}`}</text>
                                  ))}
                                  <text>
                                    No catalog is available until Managed OpenCode dependencies are
                                    complete.
                                  </text>
                                </>
                              }
                            >
                              <text>{`Catalog  ${integrationCatalog().length === 0 ? "available · empty" : `${integrationCatalog().length} entries`}`}</text>
                              {integrationCatalog().length > 0 && (
                                <DataList
                                  id="config-integration-catalog"
                                  ref={(item: SelectRenderable) => {
                                    integrationCatalogBrowser = item;
                                    const selected = props.config.integrationCatalogSelection(
                                      props.destination,
                                    );
                                    const restoredIndex = Math.max(
                                      0,
                                      integrationCatalog().findIndex(
                                        (entry) => entry.selector === selected,
                                      ),
                                    );
                                    setCatalogSelectedIndex(restoredIndex);
                                    bind("inspector", item);
                                    queueMicrotask(() => {
                                      if (
                                        !item.isDestroyed &&
                                        props.config.integrationSurface(props.destination) ===
                                          "inspector"
                                      ) {
                                        item.setSelectedIndex(restoredIndex);
                                        props.focusRegistry?.applyFocus("inspector");
                                      }
                                    });
                                  }}
                                  height={Math.min(8, integrationCatalog().length + 1)}
                                  options={integrationCatalog().map((entry) => ({
                                    name: `${entry.selector} · ${entry.name}`,
                                    description: `${entry.description || "No description"}${entry.aliases.length ? ` · aliases: ${entry.aliases.join(", ")}` : ""}`,
                                    value: entry.selector,
                                  }))}
                                  showDescription
                                  showSelectionIndicator
                                  showScrollIndicator
                                  selectedIndex={catalogSelectedIndex()}
                                  onChange={(_index, option) => {
                                    if (
                                      option &&
                                      renderer.currentFocusedRenderable ===
                                        integrationCatalogBrowser &&
                                      props.config.integrationSurface(props.destination) ===
                                        "inspector"
                                    ) {
                                      setCatalogSelectedIndex(_index);
                                      props.config.selectIntegrationCatalogEntry(
                                        props.destination,
                                        option.value,
                                      );
                                    }
                                  }}
                                  onSelect={(_index, option) => {
                                    const selected =
                                      integrationCatalogBrowser?.getSelectedOption() ?? option;
                                    const entry = selected
                                      ? integrationCatalog().find(
                                          (candidate) => candidate.selector === selected.value,
                                        )
                                      : undefined;
                                    if (entry) {
                                      setCatalogSelectedIndex(
                                        integrationCatalogBrowser?.getSelectedIndex() ?? _index,
                                      );
                                      props.config.openIntegrationCatalogEntry(
                                        props.destination,
                                        entry.selector,
                                      );
                                      queueMicrotask(() =>
                                        props.focusRegistry?.applyFocus("inspector"),
                                      );
                                    }
                                  }}
                                />
                              )}
                            </Show>
                            <box flexDirection="column" gap={1} flexShrink={0}>
                              {selectedIntegration()?.direct ? (
                                <box
                                  id="config-integration-management"
                                  flexDirection="column"
                                  gap={1}
                                  minWidth={0}
                                  flexShrink={0}
                                >
                                  <box
                                    flexDirection="row"
                                    flexWrap="wrap"
                                    gap={1}
                                    minWidth={0}
                                    flexShrink={0}
                                  >
                                    {actionCommand("enable-managed-opencode")}
                                  </box>
                                  <box
                                    flexDirection="row"
                                    flexWrap="wrap"
                                    gap={1}
                                    minWidth={0}
                                    flexShrink={0}
                                  >
                                    {actionCommand("disable-managed-opencode")}
                                  </box>
                                </box>
                              ) : (
                                !!selectedIntegration()?.owner &&
                                localCommand(
                                  "config.integration.open-owner",
                                  "Open owning Config",
                                  `${selectedIntegration()!.owner.level} ${selectedIntegration()!.owner.file} ${selectedIntegration()!.owner.pointer}`,
                                  () => props.onIntegrationOwner?.(selectedIntegration()!.owner),
                                )
                              )}
                              <Show when={!sharedReturn}>
                                {localCommand(
                                  "config.integration.back",
                                  "Back to Integrations",
                                  "Integrations",
                                  backIntegrationSurface,
                                )}
                              </Show>
                            </box>
                          </Show>
                        </scrollbox>
                      )}
                    </Show>
                  </>
                </Show>
              </scrollbox>
            </>
          }
        >
          {(file) => (
            <scrollbox
              id="config-file-problem"
              ref={(target) => bind("work-area", target)}
              flexGrow={1}
              minHeight={0}
              paddingTop={1}
            >
              <text>Read-only Config</text>
              <text>{`File  ${file().file}`}</text>
              <text>{`Status  ${file().status}`}</text>
              <text>{`Code  ${file().problem?.code ?? "Unavailable"}`}</text>
              <text>{`Message  ${file().problem?.message ?? "Configuration cannot be read"}`}</text>
              <Show when={file().problem?.location?.pointer} fallback={null}>
                {(pointer) => <text>{`Pointer  ${pointer()}`}</text>}
              </Show>
              <Show when={file().problem?.suggestion} fallback={null}>
                {(suggestion) => <text>{`Suggestion  ${suggestion()}`}</text>}
              </Show>
              <text>Mutations disabled: repair this Config before editing it.</text>
            </scrollbox>
          )}
        </Show>
        <Show when={!compactSourceLayout() && !splitMetadata() && !fileProblem() && !!metadata()}>
          <box
            flexDirection="column"
            gap={1}
            flexShrink={0}
            border={["top"]}
            borderColor={tokens().colors.border}
          >
            <Show when={section() === "sources"}>
              <SourceActions />
            </Show>
            <Show
              when={
                section() === "config-sources" &&
                props.config.configSourceSurface(props.destination) === "list"
              }
            >
              <text fg={tokens().colors.mutedForeground}>UPDATE THIS CONFIG SOURCE</text>
              {configSourceUpdate()}
            </Show>
          </box>
        </Show>
      </Pane>
      <Show when={splitMetadata()}>
        <Pane id="config-metadata-pane" title="Declaration details" width="57%">
          <scrollbox
            id="config-declaration-metadata"
            flexGrow={1}
            minHeight={0}
            ref={(target) => bind("details-metadata", target)}
          >
            <Metadata />
            <text fg={tokens().colors.mutedForeground} wrapMode="word" marginTop={1}>
              Changes apply to the owning Config. Contributions from Config Sources remain read-only
              here.
            </text>
          </scrollbox>
          <Show when={section() === "sources"}>
            <box
              flexDirection="column"
              gap={1}
              flexShrink={0}
              border={["top"]}
              borderColor={tokens().colors.border}
            >
              <SourceActions />
            </box>
          </Show>
          <Show
            when={
              section() === "config-sources" &&
              props.config.configSourceSurface(props.destination) === "list"
            }
          >
            <box
              flexDirection="column"
              flexShrink={0}
              border={["top"]}
              borderColor={tokens().colors.border}
            >
              <text fg={tokens().colors.mutedForeground}>UPDATE THIS CONFIG SOURCE</text>
              {configSourceUpdate()}
            </box>
          </Show>
        </Pane>
      </Show>
    </box>
  );
  return surface;
}
