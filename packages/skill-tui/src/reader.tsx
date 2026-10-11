import { InputRenderable, ScrollBoxRenderable, SelectRenderable, SyntaxStyle } from "@opentui/core";
import type { BaseRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { createEffect, createMemo, createSignal, ErrorBoundary, onCleanup, Show } from "solid-js";
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
import { SectionTabs } from "./components/section-tabs";
import type { ActionRecord } from "./actions";

const readerActionLabels: Partial<Record<ActionRecord["id"], string>> = {
  "skill-add-to-collection": "Add Skill to Collection…",
  "skill-open-collection-use": "View Collection's agent exposure",
  "skill-open-source": "View Source",
  "skill-check-updates": "Check / update Skill…",
  "skill-rebind": "Change Skill's Source…",
  "skill-uninstall": "Uninstall Skill…",
};

const syntaxStyle = SyntaxStyle.fromStyles({});

function NativeMarkdown(props: { readonly content: () => string }) {
  return (
    <ErrorBoundary
      fallback={() => (
        <text selectable wrapMode="word">
          {props.content()}
        </text>
      )}
    >
      <markdown
        content={props.content()}
        syntaxStyle={syntaxStyle}
        streaming={false}
        conceal
        tableOptions={{ selectable: true, wrapMode: "word" }}
      />
    </ErrorBoundary>
  );
}

export function Reader(props: {
  readonly reader: () => ReaderState;
  readonly projection: () => ManagementProjection | undefined;
  readonly focusRegistry?: FocusRegistry;
  readonly skill?: InstalledSkill;
  readonly mode: LayoutMode;
  readonly registerCommand?: CommandRegistration;
  readonly executeCommand?: CommandExecution;
  readonly actions: readonly import("./actions").ActionRecord[];
  readonly onPatch: (value: Partial<ReaderState>) => void;
  readonly onCommitFind: (value: string) => void;
  readonly onResources: () => void;
  readonly onReadResource: (path: string) => void;
  readonly onRetryResource: () => void;
  readonly onResourceBack: () => void;
  readonly onDetailsAction: (id: import("./actions").ActionRecord["id"]) => void;
  readonly onDetailsRelationship: (value: string) => void;
  readonly onDetailsScroll: (scroll: number) => void;
}) {
  const renderer = useRenderer();
  const [find, setFind] = createSignal(props.reader().find);
  const [metadataOpenAddress, setMetadataOpenAddress] = createSignal<string>();
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
  const commandZone = (id: string, record: CommandRecord, execute: () => void) => {
    const owner: FocusOwner = `command:${record.id}`;
    return (
      <CommandControl
        id={id}
        record={record}
        keyboard={!props.executeCommand}
        register={(target) => {
          bind(owner, target, (key) => {
            const navigation = handleReaderKey(owner, target, key);
            if (navigation !== "declined") return navigation;
            if (!isPlainNavKey(key) || key.name !== "right") return "declined";
            if (!record.enabled)
              return { kind: "blocked", reason: record.disabledReason ?? "Unavailable" };
            if (props.executeCommand) props.executeCommand(record.id);
            else execute();
            return "consumed";
          });
          return props.registerCommand?.(record, owner, id, execute);
        }}
        execute={() => (props.executeCommand ? props.executeCommand(record.id) : execute())}
      />
    );
  };
  const [scrollbox, setScrollbox] = createSignal<ScrollBoxRenderable>();
  const [detailsScrollbox, setDetailsScrollbox] = createSignal<ScrollBoxRenderable>();
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
  });
  createEffect(() => {
    if (reader().address !== address) {
      address = reader().address;
      setFind(reader().find);
    }
  });
  const source = () => {
    const resource = reader().resource;
    if (reader().tab === "resources" && resource?.kind === "text") return resource.text;
    return reader().raw ? (reader().rawText ?? "") : (reader().text ?? "");
  };
  const matches = () => findLiteralMatches(source(), find());
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
  const resourceDescriptor = (resource: ReaderState["resources"][number]) =>
    `${resource.path}  ${resource.kind}${resource.size === undefined ? "" : ` ${resource.size} bytes`}${resource.executable === undefined ? "" : resource.executable ? " executable" : " not executable"}${resource.gitlinkCommit ? ` ${resource.gitlinkCommit}` : ""}`;
  const readerError = () => reader().error;
  const readerIdentity = () => {
    const installed = installedSkill();
    return installed
      ? `Reader · ${installed.name}\n${installed.address.source}/${installed.address.path}`
      : "Reader";
  };
  const detailsSummary = () => {
    const installed = installedSkill();
    if (!installed) return "Summary\nSelect an Installed Skill";
    return [
      "Summary",
      `Address  ${installed.address.source}/${installed.address.path}`,
      `Description  ${installed.description || "None"}`,
      `Health  ${installed.owner.health}`,
      `Problems  ${installed.problems.map((problem) => `${problem.code}: ${problem.message}`).join("; ") || "None"}`,
    ].join("\n");
  };
  const detailsMetadata = () => {
    const installed = installedSkill();
    if (!installed) return "Select an Installed Skill";
    const skill = installed;
    const source = skill.source;
    const directOwner = source?.contribution
      ? undefined
      : props
          .projection()
          ?.configs.flatMap((config) => config.direct.sources)
          .find((item) => item.id === source?.id)?.ref.owner;
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
    const declaration = directOwner
      ? `Declaration level  ${directOwner.level}\nDeclaration file  ${directOwner.file}\nDeclaration pointer  ${directOwner.pointer}`
      : undefined;
    const contribution = source?.contribution
      ? `Config Source ID  ${configSource ?? "Unavailable"}\nHost level  ${source.contribution.configSource.level}\nHost file  ${source.contribution.configSource.file}\nHost pointer  ${source.contribution.configSource.pointer}${source.contribution.declaration.file ? `\nContributed declaration file  ${source.contribution.declaration.file}` : ""}\nContributed declaration  ${source.contribution.declaration.pointer ?? "Unavailable"}${source.contribution.declaration.namespace ? `\nNamespace  ${source.contribution.declaration.namespace}` : ""}`
      : undefined;
    const selectorLines =
      skill.selectorViews.status === "complete"
        ? skill.selectorViews.values.flatMap((view) => [
            `Selector  ${view.selector} (${view.collection}:${view.entry})`,
            ...view.paths.map((path) =>
              path.kind === "direct"
                ? `  Membership  ${path.collection}:${path.entryName}${path.owner ? ` (${path.owner.level})` : ""}`
                : path.kind === "repository-derived"
                  ? `  Repository-derived  ${path.repository} (${path.source}/${path.path})`
                  : `  Link  ${path.links.map((link) => `${link.collection}->${link.linkedCollection}${link.owner ? ` (${link.owner.level})` : ""}`).join(", ")}`,
            ),
            ...view.useOwners.map((owner) => `  Collection Use  ${owner.level} (${owner.pointer})`),
          ])
        : ["Exposure  Collection Use paths are unavailable"];
    const agent = props.projection()?.effective.agent;
    const readiness =
      agent?.status === "available"
        ? "Available"
        : agent?.reasons.map((reason) => `${reason.code}: ${reason.message}`).join("; ") ||
          "Unavailable";
    return [
      `Entry name  ${skill.name}`,
      `Source  ${skill.owner.source}`,
      source
        ? `Binding  ${source.kind}\nOrigin  ${source.origin}\nSource Root  ${source.root}${source.ref ? `\nTracked ref  ${source.ref}` : ""}`
        : "Source binding  Unavailable",
      `Config  ${config}`,
      declaration ?? contribution ?? "",
      skill.owner.relevantLocalRoot
        ? `Local root  ${skill.owner.relevantLocalRoot}`
        : skill.owner.relevantRemoteRevision
          ? `Revision  ${skill.owner.relevantRemoteRevision}`
          : "",
      `Agent readiness  ${readiness}`,
      ...selectorLines,
      skill.primary ? `Primary selector  ${skill.primary}` : "Primary selector  None",
      `Aliases  ${skill.aliases.join(", ") || "None"}`,
      `Collections  ${skill.collections.map((item) => item.id).join(", ") || "None"}`,
    ]
      .filter(Boolean)
      .join("\n");
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
    const directOwner = source?.contribution
      ? undefined
      : props
          .projection()
          ?.configs.flatMap((config) => config.direct.sources)
          .find((item) => item.id === source?.id)?.ref.owner;
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
          name: `Open Collection ${collection.id}`,
          description: `${direct.owner.level} ${direct.owner.pointer}`,
          value: `collection:${collection.id}`,
        });
    }
    if (skill.selectorViews.status === "complete" && skill.selectorViews.values.length > 0)
      choices.push({
        name: "Open selector paths",
        description: "Open exact Membership, Link, producer, and Collection Use paths",
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
    const key = `${address}:${state.tab}:${detailsSummary()}:${detailsMetadata()}`;
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
  // These are the controls rendered by this page, not an App pane-ID heuristic.
  const focusOwner = (owner: FocusOwner): DispatchResult => {
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
  const controls = (): FocusOwner[] => {
    const owners: FocusOwner[] =
      reader().tab === "skill"
        ? [
            "input",
            "command:reader.raw",
            "command:reader.find.previous",
            "command:reader.find.next",
            "command:reader.match.open-raw",
          ]
        : reader().tab === "resources"
          ? ["command:reader.resource.back", "command:reader.resource.retry"]
          : [
              ...readerActions()
                .filter((action) => action.enabled)
                .map((action) => `command:${action.id}` as const),
              ...detailRelationships().map(
                (relationship) => `command:reader.relationship.${relationship.value}` as const,
              ),
              "details-metadata",
            ];
    return owners.filter((owner) => props.focusRegistry?.target(owner));
  };
  const handleReaderKey = (owner: FocusOwner, target: FocusTarget, key: NavKey): DispatchResult => {
    if (!isPlainNavKey(key)) return "declined";
    // Find retains native caret/navigation keys; Escape leaves editing, not Reader.
    if (owner === "input") {
      if (key.name === "escape") {
        commitFind();
        return enterCurrentView();
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
    const sequence = controls();
    const index = sequence.indexOf(owner);
    if (index >= 0) {
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
      // Details commands decline Back so App restores the semantic predecessor.
      if (reader().tab !== "details" && (key.name === "left" || key.name === "escape"))
        return enterCurrentView();
      return "declined";
    }
    if (target instanceof SelectRenderable) {
      if (key.name === "up" && target.getSelectedIndex() === 0) return focusOwner("reader-tabs");
      if (key.name === "right") {
        target.selectCurrent();
        return "consumed";
      }
      return "declined";
    }
    if (key.name === "right") return focusOwner(sequence[0] ?? "reader-tabs");
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
    <box id="reader-pane" flexDirection="column" flexGrow={1} minWidth={0} minHeight={0}>
      <text id="reader-identity" width="100%" flexShrink={0} wrapMode="word">
        {readerIdentity()}
      </text>
      <box flexDirection="column" flexShrink={0}>
        <box height={1} flexShrink={0}>
          <SectionTabs
            id="reader-tabs"
            panelId="reader-views"
            owner="reader-tabs"
            focusRegistry={props.focusRegistry}
            options={[
              { label: "SKILL.md", value: "skill" },
              { label: "Resources", value: "resources" },
              { label: "Details", value: "details" },
            ]}
            value={reader().tab}
            onNavigate={(next) => {
              commitFind();
              props.onPatch({ tab: next });
            }}
            onActivate={enterCurrentView}
          />
        </box>
      </box>
      {reader().tab === "resources" && (
        <>
          <box
            id="reader-resources-status"
            height={1}
            flexShrink={0}
            focusable
            ref={(target) => bind("reader", target)}
          >
            <text>
              {reader().resourceLoading
                ? "Loading resources…"
                : reader().resources.length
                  ? "↑↓ choose resource · Enter open"
                  : "No resources · ↑ views"}
            </text>
          </box>
          {(props.mode === "wide" || reader().resourceLevel !== "content") &&
            reader().resources.length > 0 && (
              <>
                <select
                  id="resource-browser"
                  ref={(value: SelectRenderable) => {
                    bind("reader-resource-list", value);
                    queueMicrotask(() => {
                      if (
                        !value.isDestroyed &&
                        !readerError() &&
                        reader().resourceLevel !== "content" &&
                        renderer.currentFocusedRenderable?.id === "reader-resources-status"
                      )
                        value.focus();
                    });
                  }}
                  height={readerError() ? 8 : undefined}
                  flexGrow={readerError() ? undefined : 1}
                  options={reader().resources.map((resource) => ({
                    name: resourceDescriptor(resource),
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
          {(props.mode === "wide" || reader().resourceLevel !== "content") &&
            reader().resourceLoading && <text>Loading resources</text>}
          {(props.mode === "wide" || reader().resourceLevel !== "content") &&
            !reader().resourceLoading &&
            reader().resourcesLoaded &&
            reader().resources.length === 0 && <text>No supporting resources</text>}
          {reader().resourceLevel === "content" && (
            <>
              <text>{reader().selectedResource ?? "Resource"}</text>
              {(() => {
                const value = command(
                  "reader.resource.back",
                  "Back",
                  "Resources",
                  props.onResourceBack,
                );
                return commandZone("reader-resource-back", value.record, value.execute);
              })()}
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
              {(() => {
                const value = command(
                  "reader.resource.retry",
                  "Retry",
                  "Resource",
                  props.onRetryResource,
                );
                return commandZone("resource-retry", value.record, value.execute);
              })()}
            </>
          )}
        </>
      )}
      {reader().tab === "details" && (
        <scrollbox
          id="reader-details"
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
          <text selectable wrapMode="word">
            {detailsSummary()}
          </text>
          {readerActions().map((action) =>
            commandZone(`reader-details-action-${action.id}`, action, () =>
              props.onDetailsAction(action.id),
            ),
          )}
          {detailRelationships().length > 0 && (
            <>
              {detailRelationships().map((relationship) => {
                const value = command(
                  `reader.relationship.${relationship.value}`,
                  relationship.name,
                  relationship.description,
                  () => props.onDetailsRelationship(relationship.value),
                );
                return commandZone(
                  `reader-details-relationship-${relationship.value}`,
                  value.record,
                  value.execute,
                );
              })}
            </>
          )}
          <Show when={reader().address ? skillAddressKey(reader().address!) : undefined} keyed>
            {(_address) => (
              <Accordion.Root
                value={metadataOpenAddress() === readerAddress() ? ["metadata"] : []}
                onValueChange={(value) =>
                  setMetadataOpenAddress(value.includes("metadata") ? readerAddress() : undefined)
                }
                flexDirection="column"
                width="100%"
              >
                <Accordion.Item value="metadata" flexDirection="column" width="100%">
                  <Accordion.Trigger
                    id="reader-details-metadata"
                    ref={(value) => {
                      if (!value) return;
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
                      <text>{`${state.open ? "▼" : "▶"} Source, Config & agent metadata`}</text>
                    )}
                  </Accordion.Trigger>
                  <Show when={metadataOpenAddress() === readerAddress()}>
                    <Accordion.Panel width="100%">
                      <text selectable wrapMode="word">
                        {detailsMetadata()}
                      </text>
                    </Accordion.Panel>
                  </Show>
                </Accordion.Item>
              </Accordion.Root>
            )}
          </Show>
        </scrollbox>
      )}
      <Show when={reader().tab === "skill"}>
        <box flexDirection="row" height={1}>
          <input
            id="reader-find"
            ref={(value: InputRenderable) => {
              value.on("blurred", commitFind);
              bind("input", value);
            }}
            placeholder="Find"
            value={find()}
            onInput={setFind}
            onSubmit={() => {
              commitFind();
              focusOwner("command:reader.raw");
            }}
          />
          <text id="reader-find-count">
            {find()
              ? ` ${Math.min(reader().match + 1, matches().length)}/${matches().length}`
              : " "}
          </text>
        </box>
        <box height={1}>
          {(() => {
            const value = command("reader.raw", rawMode() ? "Prose" : "Raw", "SKILL.md", () => {
              commitFind();
              props.onPatch({ raw: !reader().raw });
            });
            return commandZone("reader-raw", value.record, value.execute);
          })()}
        </box>
        {!!find() && !!current() && (
          <>
            <box height={1}>
              {(() => {
                const value = command("reader.find.previous", "Previous", "Previous match", () => {
                  const match = matches()[Math.max(0, reader().match - 1)];
                  props.onPatch({
                    match: Math.max(0, reader().match - 1),
                    scroll: match?.line ?? 0,
                  });
                  queueMicrotask(() => revealCurrent(reader().raw, match?.line));
                });
                return commandZone("reader-find-previous", value.record, value.execute);
              })()}
            </box>
            <box height={1}>
              {(() => {
                const value = command("reader.find.next", "Next", "Next match", () => {
                  const match = matches()[Math.min(matches().length - 1, reader().match + 1)];
                  props.onPatch({
                    match: Math.min(matches().length - 1, reader().match + 1),
                    scroll: match?.line ?? 0,
                  });
                  queueMicrotask(() => revealCurrent(reader().raw, match?.line));
                });
                return commandZone("reader-find-next", value.record, value.execute);
              })()}
            </box>
            {showMarkdown() && (
              <box height={1}>
                {(() => {
                  const value = command(
                    "reader.match.open-raw",
                    "Open current match in Raw",
                    "Raw",
                    () => {
                      const line = rawLineForMarkdownMatch(
                        reader().rawText ?? "",
                        reader().text ?? "",
                        current()?.offset ?? 0,
                      );
                      props.onPatch({ raw: true, scroll: line });
                    },
                  );
                  return commandZone("open-match-raw", value.record, value.execute);
                })()}
              </box>
            )}
          </>
        )}
      </Show>
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
            <text>{`${reader().error?.code}: ${reader().error?.message}`}</text>
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
