import {
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
  untrack,
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
import type { WorkspaceView } from "@skctl/core";
import { skillAddressKey } from "./types";
import type { FocusRegistry, FocusTarget } from "./focus";
import { isPlainNavKey, type NavKey } from "./navigation";
import { Accordion } from "@tuiparts/solid/accordion";
import { CommandControl } from "./command-control";
import { usePageReturn } from "./page-navigation";
import { DataList } from "./ui/data-list";
import { restoreSelectState, selectScrollOffset, setSelectScrollOffset } from "./select-scroll";
import { SectionTabs, sectionTabsWidth } from "./components/section-tabs";
import { fitColumn } from "./ui/list-text";
import { MetadataGrid, type MetadataField } from "./ui/metadata-grid";
import { useTheme } from "./ui/use-theme";
import type { ActionRecord } from "./actions";
import { Dialog, DialogContent } from "./ui/dialog";
import { Button } from "./ui/button";
import { CommandMenuBody } from "./command-menu-body";

const readerActionLabels: Partial<Record<ActionRecord["id"], string>> = {
  "skill-add-to-collection": "Add to Collection…",
  "skill-open-collection-use": "View Collection's agent exposure",
  "skill-open-source": "View Source",
  "skill-check-updates": "Check updates",
  "skill-rebind": "Change Source…",
  "skill-uninstall": "Uninstall…",
};

const readerViews = [
  { label: "Content", value: "skill" },
  { label: "Resources", value: "resources" },
] as const;

function NativeMarkdown(props: { readonly content: () => string }) {
  const tokens = useTheme();
  const syntaxStyle = SyntaxStyle.create();
  const content = createMemo(() => props.content().replace(/^(?:\s*<!--[\s\S]*?-->\s*)+/, ""));
  createEffect(() => {
    syntaxStyle.registerStyle("default", { fg: tokens().colors.foreground });
    syntaxStyle.registerStyle("markup.heading", { fg: tokens().colors.foreground, bold: true });
    syntaxStyle.registerStyle("markup.strong", { bold: true });
    syntaxStyle.registerStyle("markup.italic", { italic: true });
    syntaxStyle.registerStyle("markup.link", { fg: tokens().colors.primary, underline: true });
    syntaxStyle.registerStyle("markup.raw", { fg: tokens().colors.mutedForeground });
    syntaxStyle.registerStyle("string", { fg: tokens().colors.primary });
    syntaxStyle.registerStyle("keyword", { fg: tokens().colors.foreground, bold: true });
    syntaxStyle.registerStyle("comment", { fg: tokens().colors.mutedForeground, italic: true });
  });
  onCleanup(() => syntaxStyle.destroy());
  return (
    <ErrorBoundary
      fallback={() => (
        <text selectable wrapMode="word">
          {props.content()}
        </text>
      )}
    >
      {/* Native blocks own asynchronous highlighting. A different document gets
          a new native lifetime; focus keeps the memoized payload unchanged. */}
      <For each={[content()]}>
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
  readonly projection: () => WorkspaceView | undefined;
  readonly focusRegistry?: FocusRegistry;
  readonly skill?: InstalledSkill;
  readonly mode: LayoutMode;
  readonly active?: boolean;
  readonly registerCommand?: CommandRegistration;
  readonly executeCommand?: CommandExecution;
  readonly actions: readonly import("./actions").ActionRecord[];
  readonly onPatch: (value: Partial<ReaderState>) => void;
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
  const [popup, setPopup] = createSignal<"more">();
  const installation = () => props.reader().installationOpen === true;
  const setInstallation = (installationOpen: boolean) => props.onPatch({ installationOpen });
  const resourceDirectory = createMemo(() => props.reader().resourceDirectory ?? "");
  const listedResources = createMemo(() =>
    props
      .reader()
      .resources.filter(
        (resource) => !resourceDirectory() || resource.path.startsWith(`${resourceDirectory()}/`),
      ),
  );
  const leaveDirectory = () => {
    const directory = resourceDirectory();
    props.onPatch({
      resourceDirectory: directory.includes("/")
        ? directory.slice(0, directory.lastIndexOf("/"))
        : "",
      selectedResource: directory,
    });
    queueMicrotask(() => focusOwner("reader-resource-list"));
  };
  const closeInstallation = () => {
    setInstallation(false);
    queueMicrotask(() => renderer.root.findDescendantById("reader-more")?.focus());
  };
  const closePopup = () => {
    setPopup(undefined);
    queueMicrotask(() => renderer.root.findDescendantById("reader-more")?.focus());
  };
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
  const commandZone = (
    id: string,
    record: CommandRecord | (() => CommandRecord),
    execute: () => void,
    inline = false,
  ) => {
    const currentRecord = () => (typeof record === "function" ? record() : record);
    const owner: FocusOwner = `command:${currentRecord().id}`;
    const [commandTarget, setCommandTarget] = createSignal<Renderable>();
    if (typeof record === "function") {
      createEffect(() => {
        const target = commandTarget();
        const next = currentRecord();
        if (!target || persistentCommands[next.id]) return;
        const unregister = props.registerCommand?.(next, owner, id, execute);
        onCleanup(() => unregister?.());
      });
    }
    return (
      <CommandControl
        id={id}
        record={currentRecord()}
        showDisabledReason={!inline}
        intent={inline ? "quiet" : undefined}
        keyboard={!props.executeCommand}
        register={(target) => {
          bind(owner, target);
          if (typeof record === "function") setCommandTarget(target);
          // Menu-only reading commands stay available in Actions.
          if (typeof record === "function" || persistentCommands[currentRecord().id]) return;
          return props.registerCommand?.(currentRecord(), owner, id, execute);
        }}
        execute={() =>
          props.executeCommand ? props.executeCommand(currentRecord().id) : execute()
        }
      />
    );
  };
  const [scrollbox, setScrollbox] = createSignal<ScrollBoxRenderable>();
  const [resourceScrollbox, setResourceScrollbox] = createSignal<ScrollBoxRenderable>();
  const [resourceBrowser, setResourceBrowser] = createSignal<SelectRenderable>();
  const saveResourceListScroll = (offset: number) =>
    props.onPatch({
      resourceListScrolls: { ...reader().resourceListScrolls, [resourceDirectory()]: offset },
    });
  const saveResourceScroll = (target: ScrollBoxRenderable) => {
    const path = reader().selectedResource;
    if (path)
      props.onPatch({ resourceScrolls: { ...reader().resourceScrolls, [path]: target.scrollTop } });
  };
  const captureResourceScroll = () => {
    const target = resourceScrollbox();
    const address = readerAddress();
    const path = reader().selectedResource;
    queueMicrotask(() => {
      if (
        target &&
        !target.isDestroyed &&
        readerAddress() === address &&
        reader().selectedResource === path
      )
        saveResourceScroll(target);
    });
  };
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
  const readerAddress = createMemo(() =>
    reader().address ? skillAddressKey(reader().address!) : undefined,
  );
  const installedSkill = () => props.skill;
  onCleanup(() => {
    bindings.forEach((dispose) => dispose());
    readerRestoreFrame?.();
    detailsRestoreFrame?.();
    renderer.off("frame", revealDetailsFocus);
  });
  createEffect(() => {
    if (reader().address !== address) {
      address = reader().address;
      setPopup(undefined);
    }
  });
  const source = () => {
    const resource = reader().resource;
    if (reader().tab === "resources" && resource?.kind === "text") return resource.text;
    return reader().raw ? (reader().rawText ?? "") : (reader().text ?? "");
  };
  const renderedContent = createMemo(() => {
    const resource = reader().resource;
    if (reader().tab === "resources" && resource?.kind === "not-text") {
      return `Cannot preview ${resource.reason} resource\n${resource.metadata.path}  ${resource.metadata.kind}${resource.metadata.size === undefined ? "" : ` ${resource.metadata.size} bytes`}${resource.metadata.executable ? " executable" : ""}${resource.metadata.gitlinkCommit ? ` ${resource.metadata.gitlinkCommit}` : ""}`;
    }
    return source();
  });
  const textResource = () => {
    const resource = reader().resource;
    return resource?.kind === "text" ? resource : undefined;
  };
  const resourceName = (resource: ReaderState["resources"][number]) => {
    const suffix = resource.kind === "directory" ? "/" : "";
    const label =
      (resourceDirectory() ? resource.path.slice(resourceDirectory().length + 1) : resource.path) +
      suffix;
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
      listedResources().find((item) => item.path === reader().selectedResource) ??
      listedResources()[0];
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
      .join("  ");
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
  const sourceOwner = createMemo(() => {
    const source = installedSkill()?.source;
    return source?.contribution
      ? undefined
      : props
          .projection()
          ?.configs.flatMap((config) => config.direct.sources)
          .find((item) => item.id === source?.id)?.ref.owner;
  });
  const summaryFields = createMemo((): MetadataField[] => {
    const installed = installedSkill();
    if (!installed) return [];
    return [
      field("Name", installed.name),
      field("Source", installed.owner.source),
      field("Path", installed.address.path),
      ...(installed.owner.relevantRemoteRevision
        ? [field("Installed revision", installed.owner.relevantRemoteRevision)]
        : []),
      ...(installed.owner.relevantLocalRoot
        ? [field("Local directory", installed.owner.relevantLocalRoot)]
        : []),
      ...(installed.owner.health !== "healthy" ? [field("Status", installed.owner.health)] : []),
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
    const choices: {
      readonly name: string;
      readonly description: string;
      readonly value: string;
    }[] = [];
    if (source) {
      choices.push({ name: `Open Source: ${source.id}`, description: "", value: "source" });
    }
    for (const collection of skill.collections) {
      choices.push({
        name: collection.id,
        description: "Collection",
        value: `collection:${collection.id}`,
      });
    }
    if (skill.selectorViews.status === "complete" && skill.selectorViews.values.length > 0)
      choices.push({
        name: "Agent discovery paths",
        description: "All catalog paths for this Skill",
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
    popup()
      ? {
          ...command("reader.menu.back", "Close menu", readerIdentity(), closePopup),
          layer: "menu",
          anchor: readerRoot,
        }
      : installation() && props.active !== false
        ? {
            ...command(
              "reader.installation.back",
              "Back to reading",
              readerIdentity(),
              closeInstallation,
            ),
            anchor: readerRoot,
          }
        : reader().tab === "resources" &&
            reader().resourceLevel !== "content" &&
            resourceDirectory()
          ? {
              ...command("reader.directory.back", "Up to parent", "Resources", leaveDirectory),
              anchor: readerRoot,
            }
          : resourceReturnKey()
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
    const target = resourceBrowser();
    const address = readerAddress();
    const directory = resourceDirectory();
    if (!target || target.isDestroyed) return;
    const cancel = untrack(() =>
      restoreSelectState(
        renderer,
        target,
        listedResources().findIndex((resource) => resource.path === reader().selectedResource),
        reader().resourceListScrolls?.[directory] ?? 0,
        saveResourceListScroll,
        () =>
          !target.isDestroyed && readerAddress() === address && resourceDirectory() === directory,
      ),
    );
    onCleanup(cancel);
  });
  createEffect(() => {
    const state = reader();
    const resource = state.tab === "resources" && state.resourceLevel === "content";
    const native = resource ? resourceScrollbox() : scrollbox();
    const address = state.address && skillAddressKey(state.address);
    // Content can arrive after the ScrollBox mounts. A frame is the first point at
    // which OpenTUI has measured its child height, so restoring before it clamps.
    void renderedContent();
    if (!native || !address || (state.tab !== "skill" && !resource)) {
      readerRestoreFrame?.();
      readerRestoreFrame = undefined;
      readerRestoreKey = undefined;
      readerRestoreTarget = undefined;
      readerRestoreRevision++;
      return;
    }
    const key = JSON.stringify([
      address,
      state.tab,
      state.raw,
      state.selectedResource,
      renderedContent(),
    ]);
    if (key === readerRestoreKey && readerRestoreTarget === native) return;
    readerRestoreFrame?.();
    readerRestoreKey = key;
    readerRestoreTarget = native;
    const revision = ++readerRestoreRevision;
    const scroll = resource
      ? (state.resourceScrolls?.[state.selectedResource ?? ""] ?? 0)
      : state.scroll;
    const restore = () =>
      queueMicrotask(() => {
        if (readerRestoreFrame !== cancel) return;
        readerRestoreFrame = undefined;
        const current = reader();
        if (
          revision !== readerRestoreRevision ||
          (resource ? resourceScrollbox() : scrollbox()) !== native ||
          native.parent === undefined ||
          current.tab !== state.tab ||
          current.selectedResource !== state.selectedResource ||
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
    if (!native || !address || !installation()) {
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
          !installation() ||
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
    installation()
      ? "details-relationships"
      : reader().tab === "resources"
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
    props.onPatch({ tab });
  };
  const persistentCommands: Readonly<Record<string, string>> = {
    "reader.installation": "reader-installation-open",
    "reader.reload": "reader-reload",
    "reader.raw": "reader-raw",
  };
  // Include the shared caption padding and separating cells in the tool budget.
  const tabsWidth = sectionTabsWidth(readerViews);
  const showUpdate = () => paneWidth() >= 46;
  // Compact Button reserves one theme cell on either side of its full label.
  const identityWidth = () => Math.max(1, paneWidth());
  const reloadCommand = () =>
    command(
      "reader.reload",
      "Reread installed files",
      "Reread installed instructions and resources without checking remote updates",
      () => props.onReload?.(),
    );
  const installationCommand = () =>
    command("reader.installation", "Installation details", readerIdentity(), () => {
      setPopup(undefined);
      setInstallation(true);
      queueMicrotask(() => detailsScrollbox()?.focus());
    });
  const rawCommand = () =>
    command(
      "reader.raw",
      rawMode() ? "Show formatted text" : "Show Markdown source",
      "SKILL.md",
      () => {
        props.onPatch({ raw: !reader().raw });
      },
    );
  createEffect(() => {
    const commands = [
      installationCommand(),
      ...(props.onReload ? [reloadCommand()] : []),
      ...(!installation() && reader().tab === "skill" ? [rawCommand()] : []),
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
    if (!focused) return;
    const owner = props.focusRegistry?.ownerOf(focused);
    if (!owner) return;
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
      if (!mounted || focused.isDestroyed || node) {
        const replacement = props.focusRegistry?.target(owner);
        if (
          replacement instanceof Renderable &&
          replacement !== focused &&
          !replacement.isDestroyed &&
          replacement.focusable &&
          renderer.root.findDescendantById(replacement.id) === replacement &&
          focusOwner(owner) === "consumed"
        )
          return;
        enterCurrentView();
      }
    });
  };
  createEffect(() => {
    showUpdate();
    recoverHiddenFocus(renderer.currentFocusedRenderable);
  });
  const controls = (): FocusOwner[] => {
    const owners: FocusOwner[] =
      reader().tab === "skill"
        ? ["command:reader.content.retry", "command:reader.description.toggle"]
        : reader().tab === "resources"
          ? [
              "command:reader.reload",
              ...(!sharedReturn ? ["command:reader.resource.back" as const] : []),
              "command:reader.resource.retry",
            ]
          : [];
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
    if (installation()) {
      if (key.name === "escape") {
        closeInstallation();
        return "consumed";
      }
      if (target instanceof ScrollBoxRenderable) {
        queueMicrotask(() => {
          if (!target.isDestroyed && installation()) props.onDetailsScroll(target.scrollTop);
        });
      }
      return "declined";
    }
    if (
      reader().tab === "resources" &&
      reader().resourceLevel === "content" &&
      (key.name === "left" || key.name === "escape")
    ) {
      props.onResourceBack();
      return "consumed";
    }
    if (
      reader().tab === "resources" &&
      resourceDirectory() &&
      (key.name === "left" || key.name === "escape")
    ) {
      leaveDirectory();
      return "consumed";
    }
    if (
      (owner === "command:skill-check-updates" && showUpdate()) ||
      owner === "command:reader.add-to-collection" ||
      owner === "command:reader.more"
    ) {
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
      if (key.name === "left" || key.name === "right") {
        const next = Math.max(
          0,
          Math.min(sequence.length - 1, index + (key.name === "left" ? -1 : 1)),
        );
        return focusOwner(sequence[next]!);
      }
      if (key.name === "up") {
        if (index > 0) return focusOwner(sequence[index - 1]!);
        return enterCurrentView();
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
    if (key.name === "right") return "consumed";
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
      else if (owner === "reader-resource-content") saveResourceScroll(target);
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
      </box>
      <box
        id="reader-object-actions"
        flexDirection="row"
        height={1}
        gap={0}
        flexShrink={0}
        minWidth={0}
      >
        <Show
          when={readerActions().find((action) => action.id === "skill-add-to-collection")}
          keyed
        >
          {(action) => (
            <box id="reader-collection-actions" height={1} flexShrink={0} marginRight={1}>
              {commandZone(
                "reader-details-action-skill-add-to-collection",
                {
                  ...action,
                  id: "reader.add-to-collection",
                  verb: "Add to Collection…",
                },
                () => props.onDetailsAction(action.id),
                true,
              )}
            </box>
          )}
        </Show>
        <Show when={showUpdate()}>
          <For each={inlineActions()}>
            {(action) =>
              commandZone(
                `reader-action-${action.id}`,
                action,
                () => props.onDetailsAction(action.id),
                true,
              )
            }
          </For>
        </Show>
        <box marginLeft={1} flexShrink={0}>
          {commandControl(
            "reader-more",
            command("reader.more", "More…", readerIdentity(), () => setPopup("more")),
            true,
          )}
        </box>
      </box>
      <Show when={!installation()}>
        <box
          id="reader-tools"
          flexDirection="row"
          height={1}
          flexShrink={0}
          gap={1}
          marginBottom={terminal().height >= 24 ? 1 : 0}
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
        </box>
      </Show>
      {!installation() && reader().tab === "resources" && (
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
                : resourceDirectory()
                  ? `${resourceDirectory()}/`
                  : listedResources().length
                    ? `${listedResources().length} resources`
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
          {reader().resourceLevel !== "content" && listedResources().length > 0 && (
            <>
              <DataList
                id="resource-browser"
                ref={(value: SelectRenderable) => {
                  setResourceBrowser(value);
                  bind("reader-resource-list", value);
                  queueMicrotask(() => {
                    if (value.isDestroyed || renderer.root.findDescendantById(value.id) !== value)
                      return;
                    // Native Select receives options after its initial selectedIndex.
                    // Restore the semantic row once the compact list is remounted.
                    const selected = listedResources().findIndex(
                      (resource) => resource.path === reader().selectedResource,
                    );
                    if (selected >= 0 && value.getSelectedIndex() !== selected)
                      value.selectedIndex = selected;
                    if (
                      !readerError() &&
                      reader().resourceLevel !== "content" &&
                      renderer.currentFocusedRenderable?.id === "reader-resources-status"
                    )
                      value.focus();
                  });
                }}
                height={
                  readerError() ? Math.min(8, Math.max(2, terminal().height - 12)) : undefined
                }
                flexGrow={readerError() ? 0 : 1}
                flexShrink={0}
                options={listedResources().map((resource) => ({
                  name: resourceName(resource),
                  description: "",
                  value: resource.path,
                }))}
                selectedIndex={Math.max(
                  0,
                  listedResources().findIndex(
                    (resource) => resource.path === reader().selectedResource,
                  ),
                )}
                showDescription={false}
                wrapSelection={false}
                showSelectionIndicator
                showScrollIndicator
                onMouseScroll={(event) => {
                  const browser = resourceBrowser();
                  const scroll = event.scroll;
                  if (!browser || !scroll || !["up", "down"].includes(scroll.direction)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const step =
                    Math.max(1, Math.abs(scroll.delta)) * (scroll.direction === "down" ? 1 : -1);
                  const offset = Math.max(
                    0,
                    Math.min(
                      browser.options.length - browser.height,
                      selectScrollOffset(browser) + step,
                    ),
                  );
                  saveResourceListScroll(offset);
                  setSelectScrollOffset(browser, offset);
                  browser.requestRender();
                }}
                onChange={(index) =>
                  props.onPatch({ selectedResource: listedResources()[index]?.path })
                }
                onSelect={(index) => {
                  const resource = listedResources()[index];
                  if (resource?.kind === "directory") {
                    props.onPatch({ resourceDirectory: resource.path });
                    props.onPatch({ selectedResource: listedResources()[0]?.path });
                  } else if (resource) props.onReadResource(resource.path);
                }}
              />
            </>
          )}
          <Show
            when={
              reader().resourceLevel !== "content" &&
              resourceDirectory() &&
              !listedResources().length
            }
          >
            <text wrapMode="word">Empty directory. Esc returns to its parent.</text>
          </Show>
          {reader().resourceLevel === "content" && (
            <>
              <scrollbox
                id="resource-content"
                ref={(value: ScrollBoxRenderable) => {
                  bind("reader-resource-content", value);
                  setResourceScrollbox(value);
                }}
                onKeyDown={captureResourceScroll}
                onMouseScroll={captureResourceScroll}
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
      <Show when={popup()}>
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) closePopup();
          }}
        >
          <DialogContent
            anchor={() => renderer.root.findDescendantById("reader-more")}
            backdropColor="transparent"
            id="reader-more-dialog"
            width={Math.min(30, terminal().width - 4)}
            maxWidth={30}
            maxHeight={terminal().height - 2}
          >
            <CommandMenuBody
              id="reader-menu-body"
              items={[
                { ...installationCommand(), id: "reader-installation-open" },
                {
                  ...rawCommand(),
                  id: "reader-menu-raw",
                  execute: () => {
                    closePopup();
                    setInstallation(false);
                    props.onPatch({ tab: "skill" });
                    rawCommand().execute();
                  },
                },
                ...(props.onReload
                  ? [
                      {
                        ...reloadCommand(),
                        id: "reader-menu-reload",
                        execute: () => {
                          closePopup();
                          props.onReload?.();
                        },
                      },
                    ]
                  : []),
                ...readerActions()
                  .filter(
                    (action) =>
                      action.id === "skill-rebind" ||
                      action.id === "skill-uninstall" ||
                      (action.id === "skill-check-updates" && !showUpdate()),
                  )
                  .map((record) => ({
                    id: `reader-menu-${record.id}`,
                    record,
                    execute: () => props.onDetailsAction(record.id),
                  })),
              ]}
              onExecute={(command) => {
                setPopup(undefined);
                command.execute();
              }}
            />
          </DialogContent>
        </Dialog>
      </Show>
      <Show when={installation()}>
        <text height={1} flexShrink={0} marginTop={terminal().height >= 24 ? 1 : 0}>
          Installation details Esc back
        </text>
        <scrollbox
          id="reader-details"
          // Keep the final focused disclosure above the pane's bottom border.
          contentOptions={{ paddingBottom: 1 }}
          ref={(value: ScrollBoxRenderable) => {
            setDetailsScrollbox(value);
            bind("details-relationships", value);
          }}
          focusable
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          onMouseScroll={() => {
            const target = detailsScrollbox();
            const address = readerAddress();
            // Scroll events reach this callback before native wheel scrolling.
            queueMicrotask(() => {
              if (target && !target.isDestroyed && readerAddress() === address && installation())
                props.onDetailsScroll(target.scrollTop);
            });
          }}
        >
          <box id="reader-details-summary" width="100%" flexDirection="column" flexShrink={0}>
            <For each={detailsSummary()}>
              {(item) => (
                <text
                  wrapMode="word"
                  selectable
                  flexShrink={0}
                >{`${item.label}: ${item.value}`}</text>
              )}
            </For>
          </box>
          {detailRelationships().length > 0 && (
            <box id="reader-details-connections" marginTop={1} gap={0} flexShrink={0} maxWidth={88}>
              <text height={1} flexShrink={0}>
                <strong>Source and Collections</strong>
              </text>
              {detailRelationships().map((relationship) => {
                const value = command(
                  `reader.relationship.${relationship.value}`,
                  relationship.name,
                  relationship.description,
                  () => {
                    if (relationship.value === "selectors") {
                      props.onPatch({ detailsMetadataOpen: true });
                      queueMicrotask(() =>
                        detailsScrollbox()?.scrollChildIntoView("reader-details-metadata"),
                      );
                    } else {
                      renderer.root.findDescendantById("reader-more")?.focus();
                      props.onDetailsRelationship(relationship.value);
                    }
                  },
                );
                return (
                  <box flexDirection="column" minWidth={0} flexShrink={0} gap={0}>
                    <box flexShrink={0}>
                      <Button
                        intent="menu"
                        id={`reader-details-relationship-${relationship.value}`}
                        label={relationship.name}
                        onPress={value.execute}
                      />
                    </box>
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
                      bind("details-metadata", value);
                      revealDisclosure(value);
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
        </scrollbox>
      </Show>
      <Show when={reader().tab === "skill"}>
        <scrollbox
          id="reader-scrollbox"
          visible={!installation()}
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
          <Show when={!rawMode() && description()}>
            {commandControl(
              "reader-description-toggle",
              command(
                "reader.description.toggle",
                reader().detailsDescriptionOpen ? "Hide description" : "Show description",
                readerIdentity(),
                () => props.onPatch({ detailsDescriptionOpen: !reader().detailsDescriptionOpen }),
              ),
              true,
            )}
            <Show when={reader().detailsDescriptionOpen}>
              <text
                id="reader-description"
                wrapMode="word"
                selectable
                flexShrink={0}
                marginBottom={1}
                fg={tokens().colors.mutedForeground}
              >
                {description()}
              </text>
            </Show>
          </Show>
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
