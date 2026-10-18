import {
  InputRenderable,
  Renderable,
  ScrollBoxRenderable,
  SelectRenderable,
  SyntaxStyle,
  TextAttributes,
} from "@opentui/core";
import type { BaseRenderable } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import {
  createEffect,
  createMemo,
  createSignal,
  ErrorBoundary,
  For,
  onCleanup,
  Show,
} from "solid-js";
import type {
  CommandExecution,
  CommandRecord,
  CommandRegistration,
  DispatchResult,
  FocusOwner,
  InstalledSkill,
  LayoutMode,
  ReaderState,
} from "./types";
import type { ManagementProjection } from "@skill-cli/core";
import { findLiteralMatches, rawLineForMarkdownMatch, skillAddressKey } from "./types";
import type { FocusRegistry, FocusTarget } from "./focus";
import { isPlainNavKey, type NavKey } from "./navigation";
import { Accordion } from "@tuiparts/solid/accordion";
import { CommandControl } from "./command-control";
import { usePageReturn } from "./page-navigation";
import { Input } from "./ui/input";
import { DataList } from "./ui/data-list";
import { SectionTabs, sectionTabsWidth } from "./components/section-tabs";
import { fitColumn } from "./ui/list-text";
import { MetadataGrid, type MetadataField } from "./ui/metadata-grid";
import { useTheme } from "./ui/use-theme";
import type { ActionRecord } from "./actions";

const readerActionLabels: Partial<Record<ActionRecord["id"], string>> = {
  "skill-add-to-collection": "Add Skill to Collection…",
  "skill-open-collection-use": "View Collection's agent exposure",
  "skill-open-source": "View Source",
  "skill-check-updates": "Update Skill",
  "skill-rebind": "Change Skill's Source…",
  "skill-uninstall": "Uninstall Skill…",
};

const syntaxStyle = SyntaxStyle.fromStyles({});
const readerViews = [
  { label: "SKILL.md", value: "skill" },
  { label: "Resources", value: "resources" },
  { label: "Details", value: "details" },
] as const;

function NativeMarkdown(props: { readonly content: () => string }) {
  return (
    <ErrorBoundary
      fallback={() => (
        <text selectable wrapMode="word">
          {props.content()}
        </text>
      )}
    >
      {/* Native blocks own asynchronous highlighting. A different document gets
          a new native lifetime; Find/focus keep the memoized payload unchanged. */}
      <For each={[props.content()]}>
        {(content) => (
          <markdown
            content={content}
            maxWidth={88}
            syntaxStyle={syntaxStyle}
            streaming={false}
            conceal
            tableOptions={{ selectable: true, wrapMode: "word" }}
          />
        )}
      </For>
    </ErrorBoundary>
  );
}

export function Reader(props: {
  readonly reader: () => ReaderState;
  readonly projection: () => ManagementProjection | undefined;
  readonly focusRegistry?: FocusRegistry;
  readonly skill?: InstalledSkill;
  readonly mode: LayoutMode;
  readonly active?: boolean;
  readonly registerCommand?: CommandRegistration;
  readonly executeCommand?: CommandExecution;
  readonly actions: readonly import("./actions").ActionRecord[];
  readonly onPatch: (value: Partial<ReaderState>) => void;
  readonly onCommitFind: (value: string) => void;
  readonly onReadResource: (path: string) => void;
  readonly onRetryResource: () => void;
  readonly onRetryContent?: () => void;
  readonly onReload?: () => void;
  readonly onResourceBack: () => void;
  readonly onDetailsAction: (id: import("./actions").ActionRecord["id"]) => void;
  readonly onDetailsRelationship: (value: string) => void;
  readonly onDetailsScroll: (scroll: number) => void;
}) {
  const renderer = useRenderer();
  const terminal = useTerminalDimensions();
  const tokens = useTheme();
  const [find, setFind] = createSignal(props.reader().find);
  const [findOpen, setFindOpen] = createSignal(false);
  const [descriptionOverflow, setDescriptionOverflow] = createSignal(false);
  const [paneWidth, setPaneWidth] = createSignal(0);
  const [readerRoot, setReaderRoot] = createSignal<Renderable>();
  let readerScrollbox: ScrollBoxRenderable | undefined;
  let readerRestoreRevision = 0;
  let detailsRestoreRevision = 0;
  let readerRestoreKey: string | undefined;
  let detailsRestoreKey: string | undefined;
  let readerRestoreFrame: (() => void) | undefined;
  let detailsRestoreFrame: (() => void) | undefined;
  let readerRestoreTarget: ScrollBoxRenderable | undefined;
  let detailsRestoreTarget: ScrollBoxRenderable | undefined;
  const bindings = new Map<string, () => void>();
  const bind = (
    owner: Parameters<FocusRegistry["register"]>[0],
    target: FocusTarget & Pick<BaseRenderable, "once" | "off">,
    handleKey: (key: NavKey) => DispatchResult = (key) => handleReaderKey(owner, target, key),
  ) => {
    bindings.get(owner)?.();
    if (!props.focusRegistry) return;
    const dispose = props.focusRegistry.register(owner, target);
    const disposeMode = props.focusRegistry.registerModeHandler(target, handleKey);
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
  const commandZone = (id: string, record: CommandRecord, execute: () => void, inline = false) => {
    const owner: FocusOwner = `command:${record.id}`;
    return (
      <CommandControl
        id={id}
        record={record}
        showDisabledReason={!inline}
        intent={record.id === "skill-check-updates" ? "primary" : inline ? "quiet" : undefined}
        keyboard={!props.executeCommand}
        register={(target) => {
          bind(owner, target);
          // Reading tools remain registered even when their physical controls
          // yield space to the views or Find input.
          if (persistentCommands[record.id]) return;
          return props.registerCommand?.(record, owner, id, execute);
        }}
        execute={() => (props.executeCommand ? props.executeCommand(record.id) : execute())}
      />
    );
  };
  const [scrollbox, setScrollbox] = createSignal<ScrollBoxRenderable>();
  const [detailsScrollbox, setDetailsScrollbox] = createSignal<ScrollBoxRenderable>();
  const revealDetailsFocus = () => {
    const target = renderer.currentFocusedRenderable;
    const viewport = detailsScrollbox();
    if (!target || target.isDestroyed || !viewport || viewport.isDestroyed) return;
    for (let parent = target.parent; parent; parent = parent.parent) {
      if (parent !== viewport) continue;
      viewport.scrollChildIntoView(target.id);
      const overflow = target.y + target.height - viewport.viewport.y - viewport.viewport.height;
      if (overflow >= 0) viewport.scrollBy(overflow + 1);
      break;
    }
  };
  const queueDetailsFocus = () => {
    renderer.off("frame", revealDetailsFocus);
    renderer.once("frame", revealDetailsFocus);
    renderer.requestRender();
  };
  const revealDisclosure = (target: Renderable) => {
    target.on("focused", queueDetailsFocus);
    onCleanup(() => target.off("focused", queueDetailsFocus));
  };
  const reader = props.reader;
  const rawMode = createMemo(() => reader().raw);
  let address = reader().address;
  const readerAddress = () => (reader().address ? skillAddressKey(reader().address!) : undefined);
  const installedSkill = () => props.skill;
  const commitFind = () => {
    const current = reader().address;
    if (current?.source === address?.source && current?.path === address?.path)
      props.onCommitFind(find());
  };
  onCleanup(() => {
    bindings.forEach((dispose) => dispose());
    readerRestoreFrame?.();
    detailsRestoreFrame?.();
    renderer.off("frame", revealDetailsFocus);
  });
  createEffect(() => {
    if (reader().address !== address) {
      address = reader().address;
      setFind(reader().find);
      setFindOpen(false);
    }
  });
  const source = () => {
    const resource = reader().resource;
    if (reader().tab === "resources" && resource?.kind === "text") return resource.text;
    return reader().raw ? (reader().rawText ?? "") : (reader().text ?? "");
  };
  const matches = createMemo(() => findLiteralMatches(source(), find()));
  const current = () => matches()[Math.min(reader().match, Math.max(0, matches().length - 1))];
  const revealCurrent = (raw: boolean, line = current()?.line) => {
    const native = scrollbox();
    if (line === undefined || !native || showMarkdown() || reader().raw !== raw) return;
    native.scrollChildIntoView(`reader-line-${line}`);
    if (native.scrollTop === reader().scroll) native.scrollTo(line);
    if (native.scrollTop > 0 && native.scrollTop !== reader().scroll)
      props.onPatch({ scroll: native.scrollTop });
  };
  const renderedContent = () => {
    const resource = reader().resource;
    if (reader().tab === "resources" && resource?.kind === "not-text") {
      return `Cannot preview ${resource.reason} resource\n${resource.metadata.path}  ${resource.metadata.kind}${resource.metadata.size === undefined ? "" : ` ${resource.metadata.size} bytes`}${resource.metadata.executable ? " executable" : ""}${resource.metadata.gitlinkCommit ? ` ${resource.metadata.gitlinkCommit}` : ""}`;
    }
    return source();
  };
  const textResource = () => {
    const resource = reader().resource;
    return resource?.kind === "text" ? resource : undefined;
  };
  const resourceName = (resource: ReaderState["resources"][number]) => {
    const suffix = resource.kind === "directory" ? "/" : "";
    const label = resource.path + suffix;
    const width = Math.max(1, paneWidth() - 5);
    if (Bun.stringWidth(label) <= width) return label;
    const separator = resource.path.lastIndexOf("/");
    const parentSeparator = resource.path.lastIndexOf("/", separator - 1);
    const tailStart =
      parentSeparator >= 0 && Bun.stringWidth(resource.path.slice(parentSeparator) + suffix) < width
        ? parentSeparator
        : separator;
    const name = resource.path.slice(tailStart >= 0 ? tailStart : 0) + suffix;
    const remaining = width - Bun.stringWidth(name);
    // Keep the nearest parent too, so deep paths with repeated filenames differ.
    return tailStart >= 0 && remaining >= 1
      ? fitColumn(resource.path.slice(0, tailStart), remaining).trimEnd() + name
      : fitColumn(resource.path.slice(separator + 1) + suffix, width).trimEnd();
  };
  const resourceInfo = () => {
    const resource =
      reader().resources.find((item) => item.path === reader().selectedResource) ??
      reader().resources[0];
    if (!resource) return "";
    const size = resource.size;
    return [
      resource.kind === "directory"
        ? "Directory"
        : resource.kind === "symlink"
          ? "Symlink"
          : resource.kind === "gitlink"
            ? "Gitlink"
            : undefined,
      resource.executable ? "Executable" : undefined,
      size === undefined
        ? undefined
        : size < 1024
          ? `${size} B`
          : size < 1024 * 1024
            ? `${(size / 1024).toFixed(1)} KiB`
            : `${(size / (1024 * 1024)).toFixed(1)} MiB`,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const readerError = () => reader().error;
  const readerIdentity = () => {
    const installed = installedSkill();
    return installed?.name ?? reader().address?.path ?? "Reader";
  };
  const field = (label: string, value: string): MetadataField => ({
    label,
    value,
    wrap: "word",
  });
  const summaryFields = createMemo((): MetadataField[] => {
    const installed = installedSkill();
    if (!installed) return [];
    return [
      field("Name", installed.name),
      field("Address", `${installed.address.source}/${installed.address.path}`),
      field("Health", installed.owner.health),
      ...(installed.problems.length
        ? [
            field(
              "Problems",
              installed.problems.map((problem) => `${problem.code}: ${problem.message}`).join("; "),
            ),
          ]
        : []),
    ];
  });
  const detailsSummary = () =>
    summaryFields().filter(
      (item) => item.label !== "Name" || Bun.stringWidth(item.value) > identityWidth(),
    );
  const description = () => installedSkill()?.description || "No description provided.";
  const descriptionExpanded = () => reader().detailsDescriptionOpen === true;
  const managementExpanded = () => reader().detailsManagementOpen === true;
  const sourceOwner = createMemo(() => {
    const source = installedSkill()?.source;
    return source?.contribution
      ? undefined
      : props
          .projection()
          ?.configs.flatMap((config) => config.direct.sources)
          .find((item) => item.id === source?.id)?.ref.owner;
  });
  const detailsMetadata = (): MetadataField[] => {
    const installed = installedSkill();
    if (!installed) return [];
    const skill = installed;
    const source = skill.source;
    const directOwner = sourceOwner();
    const configSource = source?.contribution
      ? props
          .projection()
          ?.configs.find((config) => config.level === source.contribution!.configSource.level)
          ?.direct.configSources.find((item) => {
            const owner = source.contribution!.configSource;
            return (
              item.owner.level === owner.level &&
              item.owner.file === owner.file &&
              item.owner.pointer === owner.pointer
            );
          })?.id
      : undefined;
    const config = source?.contribution
      ? `${source.contribution.configSource.level}${configSource ? ` / Config Source ${configSource}` : ""}`
      : directOwner
        ? `${directOwner.level} (${directOwner.pointer})`
        : "Unavailable";
    const contribution = source?.contribution;
    const declaration = directOwner
      ? [
          field("Declaration level", directOwner.level),
          field("Declaration file", directOwner.file),
          field("Declaration pointer", directOwner.pointer),
        ]
      : contribution
        ? [
            field("Config Source ID", configSource ?? "Unavailable"),
            field("Host level", contribution.configSource.level),
            field("Host file", contribution.configSource.file),
            field("Host pointer", contribution.configSource.pointer),
            ...(contribution.declaration.file
              ? [field("Contributed declaration file", contribution.declaration.file)]
              : []),
            field("Contributed declaration", contribution.declaration.pointer ?? "Unavailable"),
            ...(contribution.declaration.namespace
              ? [field("Namespace", contribution.declaration.namespace)]
              : []),
          ]
        : [];
    const selectorLines =
      skill.selectorViews.status === "complete"
        ? skill.selectorViews.values.flatMap((view) => [
            field("Selector", `${view.selector} (${view.collection}:${view.entry})`),
            ...view.paths.map((path) =>
              path.kind === "direct"
                ? field(
                    "Membership",
                    `${path.collection}:${path.entryName}${path.owner ? ` (${path.owner.level})` : ""}`,
                  )
                : path.kind === "repository-derived"
                  ? field("Repository-derived", `${path.repository} (${path.source}/${path.path})`)
                  : field(
                      "Link",
                      path.links
                        .map(
                          (link) =>
                            `${link.collection}->${link.linkedCollection}${link.owner ? ` (${link.owner.level})` : ""}`,
                        )
                        .join(", "),
                    ),
            ),
            ...view.useOwners.map((owner) =>
              field("Collection Use", `${owner.level} (${owner.pointer})`),
            ),
          ])
        : [field("Exposure", "Collection Use paths are unavailable")];
    const agent = props.projection()?.effective.agent;
    const readiness =
      agent?.status === "available"
        ? "Available"
        : agent?.reasons.map((reason) => `${reason.code}: ${reason.message}`).join("; ") ||
          "Unavailable";
    return [
      field("Entry name", skill.name),
      field("Source", skill.owner.source),
      source ? field("Binding", source.kind) : field("Source binding", "Unavailable"),
      ...(source
        ? [
            field("Origin", source.origin),
            field("Source Root", source.root),
            ...(source.ref ? [field("Tracked ref", source.ref)] : []),
          ]
        : []),
      field("Config", config),
      ...declaration,
      ...(skill.owner.relevantLocalRoot
        ? [field("Local root", skill.owner.relevantLocalRoot)]
        : skill.owner.relevantRemoteRevision
          ? [field("Revision", skill.owner.relevantRemoteRevision)]
          : []),
      field("Agent readiness", readiness),
      ...selectorLines,
      field("Primary selector", skill.primary ?? "None"),
      field("Aliases", skill.aliases.join(", ") || "None"),
      field("Collections", skill.collections.map((item) => item.id).join(", ") || "None"),
    ];
  };
  // Native Markdown rebuilds code blocks whenever its content setter runs. Keep the
  // payload independent from find, focus, and match state.
  const markdownContent = createMemo(() => reader().text ?? "", "", {
    equals: (previous, next) => previous === next,
  });
  const resourceMarkdownContent = createMemo(
    () => (textResource()?.format === "markdown" ? textResource()!.text : ""),
    "",
    { equals: (previous, next) => previous === next },
  );
  const showMarkdown = createMemo(() => reader().tab === "skill" && !reader().raw, false, {
    equals: (previous, next) => previous === next,
  });
  const detailRelationships = () => {
    const installed = installedSkill();
    if (!installed) return [];
    const skill = installed;
    const source = skill.source;
    const directOwner = sourceOwner();
    const choices: {
      readonly name: string;
      readonly description: string;
      readonly value: string;
    }[] = [];
    if (source) {
      choices.push({ name: "Open Source", description: source.id, value: "source" });
      if (source.contribution) {
        choices.push({
          name: "Open Config Source",
          description: `${source.contribution.configSource.level} ${source.contribution.configSource.pointer}`,
          value: "config-source",
        });
      } else if (directOwner) {
        choices.push({
          name: "Open Config",
          description: `${directOwner.level} ${directOwner.pointer}`,
          value: "config",
        });
      }
    }
    for (const collection of skill.collections) {
      const direct = collection.paths.find((path) => path.kind === "direct");
      if (direct?.kind === "direct" && direct.owner)
        choices.push({
          name: "Open Collection",
          description: `${collection.id} · ${direct.owner.level}`,
          value: `collection:${collection.id}`,
        });
    }
    if (skill.selectorViews.status === "complete" && skill.selectorViews.values.length > 0)
      choices.push({
        name: "Selector paths",
        description: "Membership, Link, producer and Use paths",
        value: "selectors",
      });
    return choices;
  };
  const command = (
    id: string,
    verb: string,
    destination: string,
    execute: () => void,
    enabled = true,
    disabledReason?: string,
  ) => ({
    record: {
      id,
      keys: ["enter", "return"],
      verb,
      destination,
      scope: "page",
      enabled,
      disabledReason,
      danger: false,
    } satisfies CommandRecord,
    execute,
  });
  const commandControl = (id: string, value: ReturnType<typeof command>, inline = false) =>
    commandZone(id, value.record, value.execute, inline);
  const resourceReturnKey = createMemo(() => {
    const state = reader();
    return props.active !== false && state.tab === "resources" && state.resourceLevel === "content"
      ? JSON.stringify([state.address, state.selectedResource])
      : undefined;
  });
  const sharedReturn = usePageReturn(() =>
    resourceReturnKey()
      ? {
          ...command(
            "reader.resource.back",
            "Back to Resources",
            "Resources",
            props.onResourceBack,
          ),
          anchor: readerRoot,
        }
      : undefined,
  );
  createEffect(() => {
    const native = scrollbox();
    const state = reader();
    const address = state.address && skillAddressKey(state.address);
    // Content can arrive after the ScrollBox mounts. A frame is the first point at
    // which OpenTUI has measured its child height, so restoring before it clamps.
    void renderedContent();
    if (!native || !address || state.tab !== "skill") {
      readerRestoreFrame?.();
      readerRestoreFrame = undefined;
      readerRestoreKey = undefined;
      readerRestoreTarget = undefined;
      readerRestoreRevision++;
      return;
    }
    const key = `${address}:${state.tab}:${state.raw}:${state.match}:${renderedContent()}`;
    if (key === readerRestoreKey && readerRestoreTarget === native) return;
    readerRestoreFrame?.();
    readerRestoreKey = key;
    readerRestoreTarget = native;
    const revision = ++readerRestoreRevision;
    const scroll = state.scroll;
    const restore = () =>
      queueMicrotask(() => {
        if (readerRestoreFrame !== cancel) return;
        readerRestoreFrame = undefined;
        const current = reader();
        if (
          revision !== readerRestoreRevision ||
          scrollbox() !== native ||
          native.parent === undefined ||
          current.tab !== "skill" ||
          !current.address ||
          skillAddressKey(current.address) !== address
        )
          return;
        native.scrollTop = scroll;
      });
    const cancel = () => renderer.off("frame", restore);
    readerRestoreFrame = cancel;
    renderer.once("frame", restore);
    renderer.requestRender();
  });
  createEffect(() => {
    const native = detailsScrollbox();
    const state = reader();
    const address = state.address && skillAddressKey(state.address);
    // Details can remount at responsive breakpoints; defer until the new surface is laid out.
    void detailsSummary();
    void detailsMetadata();
    if (!native || !address || state.tab !== "details") {
      detailsRestoreFrame?.();
      detailsRestoreFrame = undefined;
      detailsRestoreKey = undefined;
      detailsRestoreTarget = undefined;
      detailsRestoreRevision++;
      return;
    }
    const key = `${address}:${state.tab}:${JSON.stringify(detailsSummary())}:${JSON.stringify(detailsMetadata())}`;
    if (key === detailsRestoreKey && detailsRestoreTarget === native) return;
    detailsRestoreFrame?.();
    detailsRestoreKey = key;
    detailsRestoreTarget = native;
    const revision = ++detailsRestoreRevision;
    const scroll = state.detailsScroll;
    const restore = () =>
      queueMicrotask(() => {
        if (detailsRestoreFrame !== cancel) return;
        detailsRestoreFrame = undefined;
        const current = reader();
        if (
          revision !== detailsRestoreRevision ||
          detailsScrollbox() !== native ||
          native.parent === undefined ||
          current.tab !== "details" ||
          !current.address ||
          skillAddressKey(current.address) !== address
        )
          return;
        native.scrollTop = scroll;
      });
    const cancel = () => renderer.off("frame", restore);
    detailsRestoreFrame = cancel;
    renderer.once("frame", restore);
    renderer.requestRender();
  });
  createEffect(() => {
    const raw = reader().raw;
    const markdown = showMarkdown();
    const line = raw ? reader().scroll : current()?.line;
    if (!scrollbox() || markdown || line === undefined) return;
    queueMicrotask(() => revealCurrent(raw, line));
  });
  const readerActions = () =>
    props.actions
      .filter(
        (action) =>
          action.id.startsWith("skill-") && action.id !== "skill-add-selected-to-collection",
      )
      .filter(
        (action) =>
          action.id !== "skill-open-source" ||
          !detailRelationships().some((relationship) => relationship.value === "source"),
      )
      .filter((action) => {
        if (action.id !== "skill-open-collection-use") return true;
        const views = installedSkill()?.selectorViews;
        return (
          views?.status === "complete" &&
          views.values.some((view) => (view.exposurePaths?.length ?? 0) > 0)
        );
      })
      .map((action) => ({ ...action, verb: readerActionLabels[action.id] ?? action.verb }));
  const inlineActions = () =>
    readerActions().filter((action) => action.id === "skill-check-updates");
  const detailActions = () =>
    readerActions().filter((action) => action.id !== "skill-check-updates");
  // These are the controls rendered by this page, not an App pane-ID heuristic.
  const focusOwner = (owner: FocusOwner): DispatchResult => {
    const target = props.focusRegistry?.target(owner);
    if (target instanceof Renderable) {
      for (let node: Renderable | null = target; node; node = node.parent)
        if (node.isDestroyed || !node.visible) return "declined";
    }
    if (!props.focusRegistry?.applyFocus(owner)) return "declined";
    if (owner === "details-metadata")
      detailsScrollbox()?.scrollChildIntoView("reader-details-metadata");
    return "consumed";
  };
  const primaryOwner = (): FocusOwner =>
    reader().tab === "resources"
      ? reader().resourceLevel === "content" &&
        props.focusRegistry?.target("reader-resource-content")
        ? "reader-resource-content"
        : !readerError() && props.focusRegistry?.target("reader-resource-list")
          ? "reader-resource-list"
          : "reader"
      : "reader";
  const enterCurrentView = () => focusOwner(primaryOwner());
  const selectView = (tab: ReaderState["tab"]) => {
    if (tab === reader().tab) return;
    commitFind();
    props.onPatch({ tab });
  };
  const matchToolbar = () => reader().tab === "skill" && findOpen() && !!find() && !!current();
  const persistentCommands: Readonly<Record<string, string>> = {
    "reader.reload": "reader-reload",
    "reader.find": "reader-find-open",
    "reader.raw": "reader-raw",
    "reader.find.previous": "reader-find-previous",
    "reader.find.next": "reader-find-next",
    "reader.match.open-raw": "open-match-raw",
  };
  // Include the shared caption padding and separating cells in the tool budget.
  const tabsWidth = sectionTabsWidth(readerViews);
  const editingFind = () => reader().tab === "skill" && findOpen();
  const toolsWidth = () => (editingFind() ? paneWidth() : Math.max(0, paneWidth() - tabsWidth - 3));
  const showReadingTools = () => !editingFind() && toolsWidth() >= 15;
  const showMatchNavigation = () => matchToolbar() && toolsWidth() >= 46;
  const showRawMatch = () => showMatchNavigation() && showMarkdown() && toolsWidth() >= 60;
  const showUpdate = () => paneWidth() >= 24;
  // Compact Button reserves one theme cell on either side of its full label.
  const identityWidth = () =>
    Math.max(
      1,
      paneWidth() -
        (showUpdate() && inlineActions().length
          ? Bun.stringWidth("Update") + tokens().density.paddingX * 2 + 1
          : 0),
    );
  const findCount = () =>
    find() ? `${Math.min(reader().match + 1, matches().length)}/${matches().length}` : "";
  const openFind = () => {
    setFindOpen(true);
    focusOwner("input");
  };
  const reloadCommand = () =>
    command(
      "reader.reload",
      "Reload",
      "Reread installed instructions and resources without checking remote updates",
      () => props.onReload?.(),
    );
  const findCommand = () => command("reader.find", "Find", "Search this Skill", openFind);
  const rawCommand = () =>
    command("reader.raw", rawMode() ? "Prose" : "Raw", "SKILL.md", () => {
      commitFind();
      props.onPatch({ raw: !reader().raw });
    });
  const moveMatch = (direction: -1 | 1) => {
    const index = Math.max(0, Math.min(matches().length - 1, reader().match + direction));
    const match = matches()[index];
    props.onPatch({ match: index, scroll: match?.line ?? 0 });
    queueMicrotask(() => revealCurrent(reader().raw, match?.line));
  };
  const previousCommand = () =>
    command("reader.find.previous", "Previous", "Previous match", () => moveMatch(-1));
  const nextCommand = () => command("reader.find.next", "Next", "Next match", () => moveMatch(1));
  const rawMatchCommand = () =>
    command("reader.match.open-raw", "Raw match", "Open current match in Raw", () => {
      const line = rawLineForMarkdownMatch(
        reader().rawText ?? "",
        reader().text ?? "",
        current()?.offset ?? 0,
      );
      setFindOpen(false);
      props.onPatch({ raw: true, scroll: line });
    });
  createEffect(() => {
    const commands = [
      ...(props.onReload ? [reloadCommand()] : []),
      ...(reader().tab === "skill" ? [findCommand(), rawCommand()] : []),
      ...(matchToolbar() ? [previousCommand(), nextCommand()] : []),
      ...(matchToolbar() && showMarkdown() ? [rawMatchCommand()] : []),
    ];
    const dispose = commands.map(({ record, execute }) =>
      props.registerCommand?.(
        record,
        `command:${record.id}`,
        persistentCommands[record.id]!,
        execute,
      ),
    );
    onCleanup(() => dispose.forEach((unregister) => unregister?.()));
  });
  const recoverHiddenFocus = (focused: Renderable | null) => {
    if (!focused || !props.focusRegistry?.ownerOf(focused)) return;
    let ancestor: Renderable | null = focused;
    while (ancestor && ancestor.id !== "reader-pane") ancestor = ancestor.parent;
    if (!ancestor) return;
    queueMicrotask(() => {
      if (renderer.isDestroyed) return;
      const current = renderer.currentFocusedRenderable;
      if (current && current !== focused) return;
      let node: Renderable | null = focused;
      while (node && !node.isDestroyed && node.visible) node = node.parent;
      // Solid detaches a removed subtree before destroying it on nextTick.
      // Its controls can still report visible/not-destroyed in this microtask,
      // so only membership in the live renderer tree proves they remain usable.
      const mounted = renderer.root.findDescendantById(focused.id) === focused;
      if (!mounted || focused.isDestroyed || node) enterCurrentView();
    });
  };
  createEffect(() => {
    showReadingTools();
    showMatchNavigation();
    showRawMatch();
    showUpdate();
    editingFind();
    recoverHiddenFocus(renderer.currentFocusedRenderable);
  });
  const controls = (): FocusOwner[] => {
    const owners: FocusOwner[] =
      reader().tab === "skill"
        ? matchToolbar()
          ? [
              "command:reader.find.previous",
              "command:reader.find.next",
              "command:reader.match.open-raw",
              "input",
            ]
          : [
              "command:reader.content.retry",
              "command:reader.reload",
              "command:reader.find",
              "command:reader.raw",
              "command:reader.find.previous",
              "command:reader.find.next",
              "command:reader.match.open-raw",
              ...(findOpen() ? ["input" as const] : []),
            ]
        : reader().tab === "resources"
          ? [
              "command:reader.reload",
              ...(!sharedReturn ? ["command:reader.resource.back" as const] : []),
              "command:reader.resource.retry",
            ]
          : [
              "command:reader.description.toggle",
              ...detailRelationships().map(
                (relationship) => `command:reader.relationship.${relationship.value}` as const,
              ),
              "details-metadata",
              "command:reader.details.manage",
              "command:reader.reload",
              ...detailActions()
                .filter((action) => action.enabled)
                .map((action) => `command:${action.id}` as const),
            ];
    return owners.filter((owner) => {
      const target = props.focusRegistry?.target(owner);
      if (
        !(target instanceof Renderable) ||
        target.isDestroyed ||
        !target.parent ||
        !target.focusable ||
        renderer.root.findDescendantById(target.id) !== target
      )
        return false;
      for (let node: Renderable | null = target; node; node = node.parent)
        if (!node.visible) return false;
      return true;
    });
  };
  const handleReaderKey = (owner: FocusOwner, target: FocusTarget, key: NavKey): DispatchResult => {
    if (!isPlainNavKey(key)) return "declined";
    // Find retains native caret/navigation keys; Escape leaves editing, not Reader.
    if (owner === "input") {
      if (key.name === "escape") {
        commitFind();
        setFindOpen(false);
        return enterCurrentView();
      }
      return "declined";
    }
    if (key.name === "slash" && reader().tab === "skill") {
      setFindOpen(true);
      return focusOwner("input");
    }
    if (key.name === "escape" && reader().tab === "skill" && findOpen()) {
      setFindOpen(false);
      return enterCurrentView();
    }
    if (
      reader().tab === "resources" &&
      reader().resourceLevel === "content" &&
      (key.name === "left" || key.name === "escape")
    ) {
      props.onResourceBack();
      return "consumed";
    }
    if (owner === "command:skill-check-updates") {
      if (key.name === "down") return focusOwner("reader-tabs");
      if (["up", "left", "right"].includes(key.name)) return "consumed";
      return "declined";
    }
    const sequence = controls();
    const index = sequence.indexOf(owner);
    if (index >= 0) {
      if (reader().tab === "skill") {
        if (key.name === "down") return enterCurrentView();
        if (key.name === "up") return focusOwner("reader-tabs");
        if (key.name === "left" && index === 0) return focusOwner("reader-tabs");
      }
      if (reader().tab === "details" && key.name === "left") return enterCurrentView();
      if (key.name === "left" || key.name === "right") {
        const next = Math.max(
          0,
          Math.min(sequence.length - 1, index + (key.name === "left" ? -1 : 1)),
        );
        return focusOwner(sequence[next]!);
      }
      if (key.name === "up") {
        if (index > 0) return focusOwner(sequence[index - 1]!);
        const result = enterCurrentView();
        if (result === "consumed" && reader().tab === "details") {
          const summary = detailsScrollbox();
          if (summary && !summary.isDestroyed) {
            summary.scrollTo(0);
            props.onDetailsScroll(summary.scrollTop);
          }
        }
        return result;
      }
      if (key.name === "down")
        return index === sequence.length - 1 ? "consumed" : focusOwner(sequence[index + 1]!);
      return "declined";
    }
    if (target instanceof SelectRenderable) {
      if (key.name === "up" && target.getSelectedIndex() === 0) return focusOwner("reader-tabs");
      if (key.name === "right") return "consumed";
      return "declined";
    }
    if (key.name === "right")
      return reader().tab === "details" ? focusOwner(sequence[0] ?? "reader-tabs") : "consumed";
    if (key.name === "left") return "consumed";
    if (key.name === "up" && (!(target instanceof ScrollBoxRenderable) || target.scrollTop === 0))
      return focusOwner("reader-tabs");
    if (key.name === "down" && !(target instanceof ScrollBoxRenderable))
      return props.focusRegistry?.target("reader-resource-list")
        ? focusOwner("reader-resource-list")
        : sequence.length
          ? focusOwner(sequence[0]!)
          : "consumed";
    if (key.name === "enter" && owner === "reader" && reader().tab === "resources")
      return props.focusRegistry?.target("reader-resource-list")
        ? focusOwner("reader-resource-list")
        : focusOwner(sequence[0] ?? "reader-tabs");
    if (target instanceof ScrollBoxRenderable) {
      if (
        key.name === "up" ||
        key.name === "down" ||
        key.name === "page-up" ||
        key.name === "page-down"
      ) {
        const direction = key.name === "up" || key.name === "page-up" ? -1 : 1;
        target.scrollBy(direction, key.name.startsWith("page-") ? "viewport" : "step");
      } else if (key.name === "home") target.scrollTo(0);
      else if (key.name === "end") target.scrollTo(target.scrollHeight);
      else return "declined";
      if (reader().tab === "skill") props.onPatch({ scroll: target.scrollTop });
      else if (reader().tab === "details") props.onDetailsScroll(target.scrollTop);
      return "consumed";
    }
    return "declined";
  };
  return (
    <box
      id="reader-pane"
      flexDirection="column"
      flexGrow={1}
      minWidth={0}
      minHeight={0}
      ref={(target) => {
        setReaderRoot(target);
        const resize = () => {
          // Capture before Solid removes a focused control at the breakpoint.
          const focused = renderer.currentFocusedRenderable;
          recoverHiddenFocus(focused);
          setPaneWidth(target.width);
          queueDetailsFocus();
        };
        target.on("resize", resize);
        onCleanup(() => target.off("resize", resize));
        resize();
      }}
    >
      <box id="reader-identity-row" flexDirection="row" height={1} flexShrink={0} gap={1}>
        <text
          id="reader-identity"
          width={identityWidth()}
          flexShrink={0}
          minWidth={0}
          height={1}
          wrapMode="none"
          attributes={TextAttributes.BOLD}
          content={fitColumn(readerIdentity(), identityWidth()).trimEnd()}
        />
        <Show when={showUpdate()}>
          <For each={inlineActions()}>
            {(action) =>
              commandZone(
                `reader-action-${action.id}`,
                { ...action, verb: "Update" },
                () => props.onDetailsAction(action.id),
                true,
              )
            }
          </For>
        </Show>
      </box>
      <box
        id="reader-tools"
        flexDirection="row"
        height={1}
        flexShrink={0}
        gap={1}
        marginBottom={terminal().height >= 20 ? 1 : 0}
      >
        <box width={tabsWidth} maxWidth="100%" minWidth={0} height={1} flexShrink={0}>
          <SectionTabs
            id="reader-tabs"
            panelId="reader-views"
            owner="reader-tabs"
            focusRegistry={props.focusRegistry}
            options={readerViews}
            value={reader().tab}
            onNavigate={selectView}
            onPrimaryPointerEntry={selectView}
            onActivate={enterCurrentView}
            activateOnReselect={false}
          />
        </box>
        <Show when={reader().tab === "skill"}>
          <box
            flexDirection="row"
            flexGrow={1}
            minWidth={0}
            height={1}
            justifyContent="flex-start"
            gap={1}
          >
            <Show when={showReadingTools()}>
              <text height={1} flexShrink={0} fg={tokens().colors.mutedForeground}>
                │
              </text>
              {commandControl("reader-find-open", findCommand(), true)}
              {commandControl("reader-raw", rawCommand(), true)}
            </Show>
          </box>
        </Show>
      </box>
      <box
        visible={editingFind()}
        id="reader-find-row"
        flexDirection="row"
        height={1}
        flexShrink={0}
        minWidth={0}
        gap={1}
      >
        <box flexDirection="row" flexGrow={1} minWidth={0} height={1}>
          <Input
            id="reader-find"
            flexGrow={1}
            minWidth={0}
            ref={(value: InputRenderable) => {
              value.on("blurred", commitFind);
              value.on("focused", () => setFindOpen(true));
              bind("input", value);
            }}
            placeholder="Find"
            value={find()}
            onInput={setFind}
            onSubmit={() => {
              commitFind();
              if (!current()) setFindOpen(false);
              enterCurrentView();
            }}
          />
          <text id="reader-find-count" flexShrink={0} wrapMode="none">
            {findCount() ? ` ${findCount()}` : ""}
          </text>
        </box>
        <Show when={showMatchNavigation()}>
          {commandControl("reader-find-previous", previousCommand(), true)}
          {commandControl("reader-find-next", nextCommand(), true)}
        </Show>
        <Show when={showRawMatch()}>
          {commandControl("open-match-raw", rawMatchCommand(), true)}
        </Show>
      </box>
      {reader().tab === "resources" && (
        <>
          <box
            id="reader-resources-status"
            visible={reader().resourceLevel !== "content"}
            flexDirection="row"
            height={1}
            flexShrink={0}
            gap={1}
            focusable
            ref={(target) => bind("reader", target)}
          >
            <text
              id="reader-resources-summary"
              height={1}
              flexGrow={1}
              minWidth={0}
              wrapMode="none"
              fg={tokens().colors.mutedForeground}
            >
              {reader().resourceLoading
                ? "Loading resources…"
                : reader().resources.length
                  ? `${reader().resources.length} resources`
                  : reader().resourcesLoaded
                    ? "No supporting resources"
                    : "Resources"}
            </text>
            <Show when={reader().resources.length > 0}>
              <text
                id="reader-resource-info"
                height={1}
                flexShrink={0}
                wrapMode="none"
                fg={tokens().colors.mutedForeground}
              >
                {resourceInfo()}
              </text>
            </Show>
          </box>
          {(props.mode === "wide" || reader().resourceLevel !== "content") &&
            reader().resources.length > 0 && (
              <>
                <DataList
                  id="resource-browser"
                  ref={(value: SelectRenderable) => {
                    bind("reader-resource-list", value);
                    queueMicrotask(() => {
                      if (value.isDestroyed || renderer.root.findDescendantById(value.id) !== value)
                        return;
                      // Native Select receives options after its initial selectedIndex.
                      // Restore the semantic row once the compact list is remounted.
                      const selected = reader().resources.findIndex(
                        (resource) => resource.path === reader().selectedResource,
                      );
                      if (selected >= 0) value.selectedIndex = selected;
                      if (
                        !readerError() &&
                        reader().resourceLevel !== "content" &&
                        renderer.currentFocusedRenderable?.id === "reader-resources-status"
                      )
                        value.focus();
                    });
                  }}
                  height={
                    reader().resourceLevel === "content"
                      ? Math.min(3, reader().resources.length)
                      : readerError()
                        ? Math.min(8, Math.max(2, terminal().height - 12))
                        : undefined
                  }
                  flexGrow={reader().resourceLevel === "content" || readerError() ? 0 : 1}
                  flexShrink={0}
                  options={reader().resources.map((resource) => ({
                    name: resourceName(resource),
                    description: "",
                    value: resource.path,
                  }))}
                  selectedIndex={Math.max(
                    0,
                    reader().resources.findIndex(
                      (resource) => resource.path === reader().selectedResource,
                    ),
                  )}
                  showDescription={false}
                  wrapSelection={false}
                  showSelectionIndicator
                  showScrollIndicator
                  onChange={(index) =>
                    props.onPatch({ selectedResource: reader().resources[index]?.path })
                  }
                  onSelect={(index) => {
                    const resource = reader().resources[index];
                    if (resource) props.onReadResource(resource.path);
                  }}
                />
              </>
            )}
          {reader().resourceLevel === "content" && (
            <>
              <box flexDirection="row" flexShrink={0} minHeight={1} minWidth={0} gap={1}>
                <text
                  id="reader-resource-path"
                  flexGrow={1}
                  flexBasis={0}
                  minWidth={0}
                  maxHeight={terminal().height < 20 ? 2 : 3}
                  wrapMode="word"
                >
                  {reader().resource?.path ?? reader().selectedResource ?? "Resource"}
                </text>
                <Show when={!sharedReturn}>
                  {commandControl(
                    "reader-resource-back",
                    command("reader.resource.back", "Back", "Resources", props.onResourceBack),
                    true,
                  )}
                </Show>
              </box>
              <scrollbox
                id="resource-content"
                ref={(value: ScrollBoxRenderable) => bind("reader-resource-content", value)}
                width="100%"
                flexGrow={1}
                flexShrink={1}
                minHeight={0}
              >
                {reader().resourceLoading ? (
                  <text>Loading resource content</text>
                ) : readerError() ? (
                  <text>{`${readerError()!.code}: ${readerError()!.message}`}</text>
                ) : textResource()?.format === "markdown" ? (
                  <NativeMarkdown content={resourceMarkdownContent} />
                ) : (
                  renderedContent()
                    .split("\n")
                    .map((line, index) => (
                      <text id={`resource-line-${index}`} selectable wrapMode="word">
                        {line}
                      </text>
                    ))
                )}
              </scrollbox>
            </>
          )}
          {readerError() && (
            <>
              {reader().resourceLevel !== "content" && (
                <text>{`${readerError()!.code}: ${readerError()!.message}`}</text>
              )}
              {commandControl(
                "resource-retry",
                command("reader.resource.retry", "Retry", "Resource", props.onRetryResource),
              )}
            </>
          )}
        </>
      )}
      {reader().tab === "details" && (
        <scrollbox
          id="reader-details"
          // Keep the final focused disclosure above the pane's bottom border.
          contentOptions={{ paddingBottom: 1 }}
          ref={(value: ScrollBoxRenderable) => {
            setDetailsScrollbox(value);
            bind("reader", value);
          }}
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          onMouseScroll={() => {
            const target = detailsScrollbox();
            const address = readerAddress();
            // Scroll events reach this callback before native wheel scrolling.
            queueMicrotask(() => {
              if (
                target &&
                !target.isDestroyed &&
                readerAddress() === address &&
                reader().tab === "details"
              )
                props.onDetailsScroll(target.scrollTop);
            });
          }}
        >
          <box id="reader-details-summary" maxWidth={88} flexShrink={0}>
            <MetadataGrid fields={detailsSummary()} />
          </box>
          <box marginTop={1} maxWidth={88} flexShrink={0}>
            <text height={1} flexShrink={0}>
              <strong>Description</strong>
            </text>
            <text
              id="reader-description"
              ref={(target) => {
                const measure = () => {
                  if (!target.isDestroyed) setDescriptionOverflow(target.virtualLineCount > 3);
                };
                renderer.on("frame", measure);
                onCleanup(() => renderer.off("frame", measure));
              }}
              selectable
              wrapMode="word"
              maxHeight={descriptionExpanded() ? undefined : 3}
              overflow="hidden"
              flexShrink={0}
            >
              {description()}
            </text>
            <Show when={descriptionOverflow()}>
              {commandControl(
                "reader-description-toggle",
                command(
                  "reader.description.toggle",
                  descriptionExpanded() ? "Show less" : "Show full description",
                  readerIdentity(),
                  () => props.onPatch({ detailsDescriptionOpen: !descriptionExpanded() }),
                ),
                true,
              )}
            </Show>
          </box>
          {detailRelationships().length > 0 && (
            <box id="reader-details-connections" marginTop={1} gap={1} flexShrink={0} maxWidth={88}>
              <text height={1} flexShrink={0}>
                <strong>Connections</strong>
              </text>
              {detailRelationships().map((relationship) => {
                const value = command(
                  `reader.relationship.${relationship.value}`,
                  relationship.name,
                  relationship.description,
                  () => props.onDetailsRelationship(relationship.value),
                );
                return (
                  <box
                    flexDirection={paneWidth() < 48 ? "column" : "row"}
                    minWidth={0}
                    flexShrink={0}
                    gap={paneWidth() < 48 ? 0 : 1}
                  >
                    <box width={paneWidth() < 48 ? undefined : 22} flexShrink={0}>
                      {commandZone(
                        `reader-details-relationship-${relationship.value}`,
                        value.record,
                        value.execute,
                        true,
                      )}
                    </box>
                    <text
                      flexGrow={1}
                      minWidth={0}
                      wrapMode="word"
                      paddingLeft={paneWidth() < 48 ? 1 : 0}
                      fg={tokens().colors.mutedForeground}
                    >
                      {relationship.description}
                    </text>
                  </box>
                );
              })}
            </box>
          )}
          <Show when={reader().address ? skillAddressKey(reader().address!) : undefined} keyed>
            {(_address) => (
              <Accordion.Root
                value={reader().detailsMetadataOpen ? ["metadata"] : []}
                onValueChange={(value) =>
                  props.onPatch({ detailsMetadataOpen: value.includes("metadata") })
                }
                flexDirection="column"
                width="100%"
                marginTop={1}
                flexShrink={0}
              >
                <Accordion.Item value="metadata" flexDirection="column" width="100%">
                  <Accordion.Trigger
                    id="reader-details-metadata"
                    ref={(value) => {
                      if (!value) return;
                      revealDisclosure(value);
                      bind("details-metadata", value, (key) => {
                        const navigation = handleReaderKey("details-metadata", value, key);
                        if (navigation !== "declined") return navigation;
                        if (!isPlainNavKey(key) || key.name !== "right") return "declined";
                        value.item.toggle();
                        return "consumed";
                      });
                    }}
                    height={1}
                    width="100%"
                  >
                    {(state) => (
                      <box
                        height={1}
                        width="100%"
                        backgroundColor={
                          state.focused ? tokens().colors.primary : tokens().colors.surface
                        }
                      >
                        <text
                          fg={
                            state.focused
                              ? tokens().colors.primaryForeground
                              : tokens().colors.foreground
                          }
                        >
                          {`${state.open ? "▾" : "▸"} Technical details`}
                        </text>
                      </box>
                    )}
                  </Accordion.Trigger>
                  <Show when={reader().detailsMetadataOpen}>
                    <Accordion.Panel width="100%">
                      <MetadataGrid fields={detailsMetadata()} />
                    </Accordion.Panel>
                  </Show>
                </Accordion.Item>
              </Accordion.Root>
            )}
          </Show>
          <Show when={readerAddress()} keyed>
            {(_address) => (
              <Accordion.Root
                value={managementExpanded() ? ["manage"] : []}
                onValueChange={(value) =>
                  props.onPatch({ detailsManagementOpen: value.includes("manage") })
                }
                flexDirection="column"
                width="100%"
                marginTop={1}
                flexShrink={0}
              >
                <Accordion.Item value="manage" flexDirection="column" width="100%">
                  <Accordion.Trigger
                    id="reader-details-manage"
                    height={1}
                    width="100%"
                    ref={(target) => {
                      if (target) {
                        revealDisclosure(target);
                        bind("command:reader.details.manage", target);
                      }
                    }}
                  >
                    {(state) => (
                      <box
                        height={1}
                        width="100%"
                        backgroundColor={
                          state.focused ? tokens().colors.primary : tokens().colors.surface
                        }
                      >
                        <text
                          fg={
                            state.focused
                              ? tokens().colors.primaryForeground
                              : tokens().colors.foreground
                          }
                        >
                          <strong>{`${state.open ? "▾" : "▸"} Manage Skill`}</strong>
                        </text>
                      </box>
                    )}
                  </Accordion.Trigger>
                  <Show when={managementExpanded()}>
                    <Accordion.Panel width="100%" flexDirection="column">
                      <box
                        id="reader-manage-actions"
                        flexDirection="row"
                        flexWrap="wrap"
                        gap={1}
                        minWidth={0}
                        flexShrink={0}
                      >
                        <Show when={props.onReload}>
                          {commandControl("reader-reload", reloadCommand(), true)}
                        </Show>
                        <For each={detailActions().filter((action) => !action.danger)}>
                          {(action) =>
                            commandZone(
                              `reader-details-action-${action.id}`,
                              action,
                              () => props.onDetailsAction(action.id),
                              true,
                            )
                          }
                        </For>
                      </box>
                      <Show when={detailActions().some((action) => action.danger)}>
                        <box
                          id="reader-danger-actions"
                          marginTop={1}
                          flexDirection="row"
                          flexWrap="wrap"
                          gap={1}
                          minWidth={0}
                          flexShrink={0}
                        >
                          <For each={detailActions().filter((action) => action.danger)}>
                            {(action) =>
                              commandZone(
                                `reader-details-action-${action.id}`,
                                action,
                                () => props.onDetailsAction(action.id),
                                true,
                              )
                            }
                          </For>
                        </box>
                      </Show>
                    </Accordion.Panel>
                  </Show>
                </Accordion.Item>
              </Accordion.Root>
            )}
          </Show>
        </scrollbox>
      )}
      <Show when={reader().tab === "skill"}>
        <scrollbox
          id="reader-scrollbox"
          ref={(value: ScrollBoxRenderable) => {
            readerScrollbox = value;
            bind("reader", value);
            setScrollbox(value);
          }}
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          onMouseScroll={() => {
            const target = readerScrollbox;
            const address = readerAddress();
            queueMicrotask(() => {
              if (
                target &&
                !target.isDestroyed &&
                readerAddress() === address &&
                reader().tab === "skill"
              )
                props.onPatch({ scroll: target.scrollTop });
            });
          }}
        >
          {reader().loading ? (
            <text>Loading SKILL.md</text>
          ) : reader().error ? (
            <box flexDirection="column">
              <text wrapMode="word">{`Could not read ${props.skill?.name ?? "this Skill"}: ${reader().error?.message}`}</text>
              {commandControl(
                "reader-content-retry",
                command(
                  "reader.content.retry",
                  "Retry reading",
                  readerIdentity(),
                  () => props.onRetryContent?.(),
                  !!props.onRetryContent,
                ),
              )}
            </box>
          ) : (
            <Show
              when={showMarkdown()}
              fallback={renderedContent()
                .split("\n")
                .map((line, index) => (
                  <text id={`reader-line-${index}`} selectable wrapMode="word">
                    {line}
                  </text>
                ))}
            >
              <NativeMarkdown content={markdownContent} />
            </Show>
          )}
        </scrollbox>
      </Show>
    </box>
  );
}
