import { createMemo, createSignal, For, Show, onCleanup, untrack, type JSX } from "solid-js";
import { ObjectMenu } from "./object-menu";
import { usePageView } from "./page-navigation";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { ScrollBoxRenderable, type Renderable } from "@opentui/core";
import type {
  ConfigDeclarationOwner,
  ConfigLevelView,
  SourceBindingView,
  WorkspaceView,
} from "@skctl/core";
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
import type { FocusRegistry } from "./focus";
import { CommandControl } from "./command-control";
import { usePageReturn } from "./page-navigation";
import { DataList } from "./ui/data-list";
import { Pane } from "./ui/pane";
import { MetadataGrid, type MetadataField } from "./ui/metadata-grid";

type ConfigActionId =
  | "add-source"
  | "add-config-source"
  | "new-collection"
  | "set-collection-use"
  | "config-observe"
  | "config-forget"
  | "config-remove"
  | "check-updates"
  | "add-skills"
  | "remove-source";
type ConfigSource = ConfigLevelView["direct"]["configSources"][number];
const field = (label: string, value: string): MetadataField => ({ label, value, wrap: "word" });
const categories = [
  { name: "Sources", value: "sources" },
  { name: "Config Sources", value: "config-sources" },
  { name: "Collections", value: "collections" },
  { name: "Interface", value: "interface" },
] as const;

export function ConfigPage(props: {
  readonly config: ConfigReadonly;
  readonly overlay?: () => boolean;
  readonly mode?: LayoutMode;
  readonly browserWidth?: number;
  readonly interface?: boolean;
  readonly interfaceContent?: () => JSX.Element;
  readonly onCategory?: (section: ConfigSection | "interface") => void;
  readonly onCategories?: () => void;
  readonly registerCommand?: CommandRegistration;
  readonly executeCommand?: CommandExecution;
  readonly handoff?: RouteHandoff;
  readonly relationshipReturn?: boolean;
  readonly projection: () => WorkspaceView | undefined;
  readonly focusRegistry?: FocusRegistry;
  readonly destination: Exclude<Destination, "workspace">;
  readonly actions: readonly ActionRecord[];
  readonly onSelect: (source: string) => void;
  readonly onAction: (id: ConfigActionId) => void;
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
  const [root, setRoot] = createSignal<Renderable>();
  const [category, setCategory] = createSignal<ConfigSection | "interface">(
    props.config.section(props.destination),
  );
  const config = () => props.projection()?.configs.find((item) => item.level === props.destination);
  const section = createMemo(() => props.config.section(props.destination));
  const level = () => props.config.snapshot(props.destination).browserLevel;
  const view = usePageView();
  const wide = () => props.mode === "wide" && !view?.expanded();
  const title = () => categories.find((item) => item.value === section())?.name ?? "Settings";
  const selected = createMemo(() => props.config.selection(props.destination));
  const scrollKey = () => JSON.stringify([section(), selected()]);
  const DeclarationBody = (body: { children: JSX.Element }) => {
    const destination = untrack(() => props.destination);
    const key = untrack(scrollKey);
    const offset = untrack(() => props.config.snapshot(destination).scrolls[key] ?? 0);
    let target: ScrollBoxRenderable | undefined;
    let restored = false;
    let frames = 0;
    const observe = () => {
      if (!target || target.isDestroyed || props.destination !== destination || scrollKey() !== key)
        return;
      if (!restored) {
        target.scrollTo(offset);
        restored = target.scrollTop === offset || ++frames >= 3;
        if (!restored) renderer.requestRender();
      } else if (!props.overlay?.()) props.config.setScroll(destination, key, target.scrollTop);
    };
    renderer.on("frame", observe);
    onCleanup(() => {
      renderer.off("frame", observe);
    });
    return (
      <scrollbox
        id="config-declaration-body"
        ref={(value) => {
          target = value;
          bind("work-area", value);
        }}
        flexGrow={1}
        minHeight={0}
      >
        {body.children}
      </scrollbox>
    );
  };
  const sources = () => [
    ...(config()?.direct.sources ?? []),
    ...(config()?.contributed.sources ?? []),
  ];
  const source = () => sources().find((item) => item.id === selected());
  const configSource = () =>
    config()?.direct.configSources.find((item) => item.owner.pointer === selected());
  const collection = () => config()?.direct.collections.find((item) => item.id === selected());
  const use = () => config()?.direct.collectionUse.find((item) => item.collection === selected());
  const collectionOwner = () =>
    !use() &&
    props
      .projection()
      ?.configs.flatMap((item) => item.direct.collectionUse)
      .find((item) => item.collection === selected())?.owner;
  const fileProblem = () => {
    const file = config()?.file;
    return file && file.status !== "valid" && file.status !== "missing" ? file : undefined;
  };
  const rows = createMemo(() => {
    if (section() === "sources")
      return sources().map((item) => ({ name: item.id, description: item.origin, value: item.id }));
    if (section() === "config-sources")
      return (config()?.direct.configSources ?? []).map((item) => ({
        name: item.id,
        description: item.owner.file,
        value: item.owner.pointer,
      }));
    return [
      ...(config()?.direct.collections ?? []).map((item) => ({
        name: item.id,
        description: item.owner.file,
        value: item.id,
      })),
      ...(config()?.contributed.collections ?? []).map((id) => ({
        name: id,
        description: "Contributed Collection",
        value: id,
      })),
    ];
  });
  const browserId = () =>
    section() === "sources"
      ? "config-source-browser"
      : section() === "config-sources"
        ? "config-config-source-browser"
        : "config-collection-browser";
  const focus = (id: string) =>
    queueMicrotask(() => {
      if (!renderer.isDestroyed && !props.overlay?.())
        renderer.root.findDescendantById(id)?.focus();
    });
  const back = () => {
    if (!props.interface && !wide() && level() === "object") {
      props.config.showDeclarations(props.destination);
      focus(browserId());
    } else {
      props.onCategories?.();
      props.config.showCategories(props.destination);
      focus("settings-categories");
    }
  };
  const backRecord = (): CommandRecord => ({
    id: "config.back",
    keys: ["enter", "return"],
    scope: "page",
    enabled: true,
    danger: false,
    verb:
      !props.interface && !wide() && level() === "object"
        ? `Back to ${title()}`
        : "Back to categories",
    destination: "Settings",
  });
  const sharedReturn = usePageReturn(() =>
    !(view?.available() && view.expanded()) &&
    !props.relationshipReturn &&
    (level() !== "categories" || props.interface)
      ? { record: backRecord(), anchor: root, execute: back }
      : undefined,
  );
  const enter = () => {
    props.config.openObject(props.destination);
    if (section() === "config-sources") {
      props.config.openConfigSourceInspector(props.destination);
    }
    queueMicrotask(() => {
      const primary = renderer.root.findDescendantById(
        `config-command-${section() === "sources" ? "check-updates" : section() === "config-sources" ? "config-observe" : "set-collection-use"}`,
      );
      const first = primary?.focusable ? primary : objectCommands()[0];
      if (!renderer.isDestroyed && !props.overlay?.())
        (first ?? renderer.root.findDescendantById("config-declaration-body"))?.focus();
    });
  };
  const commandTargets = new Set<Renderable>();
  const objectCommands = () =>
    [...commandTargets]
      .filter((target) => {
        if (target.isDestroyed || !target.parent || !target.focusable) return false;
        for (let parent: Renderable | null = target.parent; parent; parent = parent.parent)
          if (parent.id === "config-object-pane") return true;
        return false;
      })
      .sort((left, right) => left.screenY - right.screenY || left.screenX - right.screenX);
  const chooseCategory = (value: ConfigSection | "interface") => {
    setCategory(value);
    props.onCategory?.(value);
    if (value !== "interface") {
      props.config.showDeclarations(props.destination);
      focus(browserId());
    }
  };
  const bind = (owner: FocusOwner, target: Renderable, browser = false) => {
    const revealNow = () => {
      if (target.isDestroyed) return;
      for (let parent = target.parent; parent; parent = parent.parent)
        if (parent instanceof ScrollBoxRenderable) {
          parent.scrollChildIntoView(target.id);
          const bottom = parent.viewport.y + parent.viewport.height;
          if (target.y + target.height >= bottom)
            parent.scrollBy(target.y + target.height - bottom + 1);
        }
    };
    const reveal = () => {
      revealNow();
      renderer.off("frame", revealNow);
      renderer.once("frame", revealNow);
      renderer.requestRender();
    };
    target.on("focused", reveal);
    const release = props.focusRegistry?.register(owner, target);
    const mode = browser
      ? props.focusRegistry?.registerModeHandler(target, (key) => {
          if (key.name !== "tab" || key.shift || key.ctrl || key.alt || key.meta) return "declined";
          enter();
          return "consumed";
        })
      : undefined;
    target.once("destroyed", () => {
      target.off("focused", reveal);
      renderer.off("frame", revealNow);
      release?.();
      mode?.();
    });
  };
  const command = (id: string, record: CommandRecord, execute: () => void) => (
    <CommandControl
      id={id}
      record={record}
      keyboard={!props.executeCommand}
      execute={() => (props.executeCommand ? props.executeCommand(record.id) : execute())}
      showDisabledReason={false}
      register={(target) => {
        const owner = `command:${record.id}` as const;
        bind(owner, target);
        commandTargets.add(target);
        const mode = props.focusRegistry?.registerModeHandler(target, (key) => {
          if (key.ctrl || key.alt || key.meta || !["up", "down"].includes(key.name))
            return "declined";
          const targets = objectCommands();
          const index = targets.indexOf(target);
          if (index < 0) return "declined";
          targets[
            Math.max(0, Math.min(targets.length - 1, index + (key.name === "down" ? 1 : -1)))
          ]?.focus();
          return "consumed";
        });
        const release = props.registerCommand?.(record, owner, id, execute);
        return () => {
          commandTargets.delete(target);
          mode?.();
          release?.();
        };
      }}
    />
  );
  const action = (id: ConfigActionId, label?: string) => {
    const record = props.actions.find((item) => item.id === id);
    return record
      ? command(`config-command-${id}`, label ? { ...record, verb: label } : record, () =>
          props.onAction(id),
        )
      : null;
  };
  const localCommand = (id: string, verb: string, destination: string, execute: () => void) =>
    command(
      `config-command-${id}`,
      {
        id,
        verb,
        destination,
        keys: ["enter", "return"],
        scope: "page",
        enabled: true,
        danger: false,
      },
      execute,
    );
  const add = () =>
    section() === "sources"
      ? action("add-source", "Add Source…")
      : section() === "config-sources"
        ? action("add-config-source", "Add Config Source…")
        : action("new-collection", "New Collection…");
  const bindingFields = (
    binding: ConfigSource["binding"] | Pick<SourceBindingView, "kind" | "origin" | "root" | "ref">,
  ): MetadataField[] => [
    field("Kind", binding.kind),
    {
      label: "path" in binding ? "Local path" : "Origin",
      value: "path" in binding ? binding.path : binding.origin,
      wrap: "word",
    },
    field("Root", binding.root || "."),
    ...("ref" in binding && binding.ref ? [field("Tracked ref", binding.ref)] : []),
  ];
  const ownerFields = (owner: ConfigDeclarationOwner): MetadataField[] => [
    { label: "Owner", value: `${owner.level} ${owner.file}`, wrap: "word" },
    { label: "Declaration", value: owner.pointer, wrap: "word" },
  ];
  const fields = createMemo<MetadataField[]>(() => {
    if (section() === "sources") {
      const item = source();
      if (!item) return [];
      const direct = config()?.direct.sources.find((source) => source.id === item.id);
      const owner = item.contribution?.configSource ?? direct?.ref.owner;
      return [
        field("Source", item.id),
        ...bindingFields({
          ...item,
          ref: typeof item.ref === "string" ? item.ref : direct?.trackedRef,
        }),
        field(
          "Editable",
          item.contribution ? "No, contributed by a Config Source" : "Yes, direct declaration",
        ),
        ...(owner ? ownerFields(owner) : []),
      ];
    }
    if (section() === "config-sources") {
      const item = configSource();
      if (!item) return [];
      return [
        field("Config Source", item.id),
        ...bindingFields(item.binding),
        field("Adoption", item.adoption.status),
        ...(item.adoption.status === "adopted"
          ? [field("Applied commit", item.adoption.commit)]
          : []),
        ...ownerFields(item.owner),
      ];
    }
    const item = collection();
    return item ? [field("Collection", item.id), ...ownerFields(item.owner)] : [];
  });
  const handoffText = () => {
    const handoff = props.handoff;
    if (!handoff || handoff.kind === "agent-producer" || handoff.owner.level !== props.destination)
      return undefined;
    const owner = handoff.owner;
    const identity =
      "source" in handoff
        ? handoff.source.id
        : "collection" in handoff
          ? handoff.collection
          : undefined;
    return `${handoff.kind}\n${identity ?? ""}\nOwner  ${owner.file} ${owner.pointer}${owner.contribution ? `\nConfig Source host  ${owner.contribution.configSource.file} ${owner.contribution.configSource.pointer}\nContributed declaration  ${owner.contribution.declaration.pointer ?? "Unavailable"}` : ""}${"address" in handoff ? `\nSkill  ${handoff.address.source}/${handoff.address.path}` : ""}${"entry" in handoff && handoff.entry ? `\nEntry  ${handoff.entry}` : ""}`;
  };
  const contributions = () => {
    const current = configSource();
    return current
      ? [
          ...current.contributed.sources.map((source) => ({
            name: `Source  ${source.id}`,
            description: "Contributed read-only Source",
            open: () => props.onContribution({ kind: "source", source, owner: current.owner }),
          })),
          ...current.contributed.collections.map((collection) => ({
            name: `Collection  ${collection.id}`,
            description: "Contributed read-only Collection",
            open: () =>
              props.onContribution({
                kind: "collection",
                collection: collection.id,
                owner: collection.owner,
              }),
          })),
        ]
      : [];
  };
  return (
    <box id="config-page-pane" ref={setRoot} flexDirection="row" gap={1} flexGrow={1} minHeight={0}>
      <Show
        when={
          !(view?.available() && view.expanded()) &&
          (wide() || (!props.interface && level() !== "object"))
        }
      >
        <box width={wide() ? (props.browserWidth ?? 38) : "100%"} flexShrink={0} minHeight={0}>
          <Pane
            id="config-browser-pane"
            title={level() === "categories" || props.interface ? "Settings" : title()}
          >
            <Show
              when={level() === "categories" || props.interface}
              fallback={
                <>
                  <box height={1} flexShrink={0}>
                    {localCommand("config.categories", "Categories", "Settings", () => {
                      props.config.showCategories(props.destination);
                      focus("settings-categories");
                    })}
                  </box>
                  <Show
                    when={!fileProblem() && props.projection()}
                    fallback={
                      <Show when={!props.projection()}>
                        <text>Loading Config…</text>
                      </Show>
                    }
                  >
                    <box height={1} flexShrink={0} marginBottom={terminal().height >= 24 ? 1 : 0}>
                      {add()}
                    </box>
                    <DataList
                      id={browserId()}
                      ref={(target) => bind("browser", target, true)}
                      flexGrow={1}
                      minHeight={0}
                      options={rows()}
                      selectedIndex={Math.max(
                        0,
                        rows().findIndex((row) => row.value === selected()),
                      )}
                      showDescription={false}
                      onChange={(index) => {
                        const row = rows()[index];
                        if (row) props.onSelect(row.value);
                      }}
                      onSelect={(index) => {
                        const row = rows()[index];
                        if (row) props.onSelect(row.value);
                        enter();
                      }}
                    />
                    <Show when={!rows().length}>
                      <text>No {title()} yet</text>
                    </Show>
                  </Show>
                  <Show when={fileProblem()}>
                    <text>Read-only Config</text>
                    {localCommand("config.problem", "View problem", "Config file", enter)}
                  </Show>
                </>
              }
            >
              <DataList
                id="settings-categories"
                marginTop={terminal().height >= 24 ? 1 : 0}
                flexGrow={1}
                options={categories.map((item) => ({ ...item, description: "" }))}
                selectedIndex={categories.findIndex((item) => item.value === category())}
                showDescription={false}
                ref={(target) => bind("browser", target)}
                onChange={(index) => setCategory(categories[index]!.value)}
                onSelect={(index) => chooseCategory(categories[index]!.value)}
              />
            </Show>
          </Pane>
        </box>
      </Show>
      <Show
        when={
          wide() ||
          (view?.available() && view.expanded()) ||
          props.interface ||
          level() === "object"
        }
      >
        <box flexGrow={1} flexBasis={0} minWidth={0} minHeight={0}>
          <Show
            when={props.interface}
            fallback={
              <Pane
                id="config-object-pane"
                title={
                  selected()
                    ? (rows().find((row) => row.value === selected())?.name ?? title())
                    : title()
                }
              >
                <Show when={!sharedReturn && level() !== "categories"}>
                  {command("config-back", backRecord(), back)}
                </Show>
                <Show when={!fileProblem() && !!props.projection()}>
                  <box
                    id="config-object-actions"
                    marginBottom={terminal().height >= 24 ? 1 : 0}
                    height={1}
                    flexShrink={0}
                    flexDirection="row"
                    gap={1}
                  >
                    <Show when={section() === "config-sources" && configSource()}>
                      {action("config-observe", "Review update…")}
                    </Show>
                    <Show when={section() === "sources" && source()}>
                      {action("check-updates", "Check updates")}
                    </Show>
                    <Show when={section() === "collections" && (collection() || use())}>
                      {action("set-collection-use")}
                    </Show>
                    <ObjectMenu
                      id="config-more"
                      target={`${props.destination}:${scrollKey()}`}
                      focusRegistry={props.focusRegistry}
                      registerCommand={props.registerCommand}
                    />
                  </box>
                </Show>
                <Show when={`${props.destination}:${scrollKey()}`} keyed>
                  {(_identity) => (
                    <DeclarationBody>
                      <Show when={props.projection()} fallback={<text>Loading Config…</text>}>
                        <Show
                          when={fileProblem()}
                          fallback={
                            <>
                              <Show when={handoffText()}>
                                {(text) => <text wrapMode="word">{text()}</text>}
                              </Show>
                              <MetadataGrid fields={fields()} />
                              <Show when={!fields().length}>
                                <text>Select a declaration from {title()}.</text>
                              </Show>
                              <Show when={section() === "sources" && source()}>
                                {action("add-skills", "Find and install…")}
                                {action("remove-source", "Remove Source declaration…")}
                              </Show>
                              <Show when={section() === "config-sources" && configSource()}>
                                <box id="config-source-inspector" flexDirection="column" gap={1}>
                                  {action("config-forget")}
                                  {action("config-remove")}
                                  <text>{`Contributed Sources  ${configSource()!.contributed.sources.length}`}</text>
                                  <text>{`Contributed Collections  ${configSource()!.contributed.collections.length}`}</text>
                                  <Show when={contributions().length}>
                                    <box
                                      id="config-contributions-pane"
                                      flexDirection="column"
                                      flexShrink={0}
                                    >
                                      <DataList
                                        id="config-source-contributions"
                                        height={Math.min(
                                          8,
                                          Math.max(2, terminal().height - 7),
                                          Math.max(2, contributions().length),
                                        )}
                                        ref={(target) =>
                                          bind("config-source-contributions", target)
                                        }
                                        showDescription={false}
                                        options={contributions().map((item, index) => ({
                                          name: item.name,
                                          description: item.description,
                                          value: String(index),
                                        }))}
                                        onSelect={(index) => contributions()[index]?.open()}
                                      />
                                    </box>
                                  </Show>
                                </box>
                              </Show>
                              <Show when={section() === "collections" && collectionOwner()}>
                                {(owner) =>
                                  localCommand(
                                    "config.collection.open-owner",
                                    "Open Collection Use owner",
                                    `${owner().file} ${owner().pointer}`,
                                    () => {
                                      if (selected())
                                        props.onCollectionOwner?.(selected()!, owner());
                                    },
                                  )
                                }
                              </Show>
                              <For
                                each={props.actions.filter(
                                  (item) => !item.enabled && item.disabledReason,
                                )}
                              >
                                {(item) => (
                                  <Show
                                    when={
                                      section() === "sources"
                                        ? item.id === "remove-source"
                                        : section() === "config-sources"
                                          ? item.id === "config-remove"
                                          : item.id === "set-collection-use"
                                    }
                                  >
                                    <text wrapMode="word">{item.disabledReason}</text>
                                  </Show>
                                )}
                              </For>
                            </>
                          }
                        >
                          {(file) => (
                            <box id="config-file-problem" flexDirection="column">
                              <text>Read-only Config</text>
                              <text>{`File  ${file().file}`}</text>
                              <text>{`Status  ${file().status}`}</text>
                              <text>{`Code  ${file().problem?.code ?? "Unavailable"}`}</text>
                              <text>{`Message  ${file().problem?.message ?? "Configuration cannot be read"}`}</text>
                              <Show when={file().problem?.location?.pointer}>
                                {(pointer) => <text>{`Pointer  ${pointer()}`}</text>}
                              </Show>
                              <Show when={file().problem?.suggestion}>
                                {(suggestion) => <text>{`Suggestion  ${suggestion()}`}</text>}
                              </Show>
                              <text>Mutations disabled: repair this Config before editing it.</text>
                            </box>
                          )}
                        </Show>
                      </Show>
                    </DeclarationBody>
                  )}
                </Show>
              </Pane>
            }
          >
            {props.interfaceContent?.()}
          </Show>
        </box>
      </Show>
    </box>
  );
}
