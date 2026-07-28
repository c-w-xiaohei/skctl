import {
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  SyntaxStyle,
  TabSelectRenderable,
} from "@opentui/core";
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { InstalledSkill, TuiState } from "./model";
import { findLiteralMatches, rawLineForMarkdownMatch } from "./model";

const syntaxStyle = SyntaxStyle.fromStyles({});

function NativeMarkdown(props: { readonly content: () => string }) {
  return (
    <markdown
      content={props.content()}
      syntaxStyle={syntaxStyle}
      streaming={false}
      conceal
      internalBlockMode="coalesced"
      tableOptions={{ selectable: true }}
    />
  );
}

export function Reader(props: {
  readonly state: TuiState;
  readonly skill?: InstalledSkill;
  readonly narrow: boolean;
  readonly onPatch: (value: Partial<TuiState["reader"]>) => void;
  readonly onCommitFind: (value: string) => void;
  readonly onRegisterFindCommit: (commit: () => void) => void;
  readonly onResources: () => void;
  readonly onReadResource: (path: string) => void;
  readonly onRetryResource: () => void;
  readonly onResourceBack: () => void;
  readonly onDetailsActions: () => void;
  readonly onDetailsRelationship: (value: string) => void;
  readonly onDetailsScroll: (scroll: number) => void;
}) {
  const [find, setFind] = createSignal(props.state.reader.find);
  let findInput: InputRenderable | undefined;
  let readerScrollbox: ScrollBoxRenderable | undefined;
  let readerTabs: TabSelectRenderable | undefined;
  let readerRaw: SelectRenderable | undefined;
  let readerFindPrevious: SelectRenderable | undefined;
  let readerFindNext: SelectRenderable | undefined;
  let openMatchRaw: SelectRenderable | undefined;
  let resourceBrowser: SelectRenderable | undefined;
  let resourceContent: ScrollBoxRenderable | undefined;
  let resourceRetry: SelectRenderable | undefined;
  let detailsActions: SelectRenderable | undefined;
  let detailsRelationships: SelectRenderable | undefined;
  let synchronizingTab = false;
  let restoredAddress: string | undefined;
  let restoredScroll: number | undefined;
  let restoredDetailsAddress: string | undefined;
  let restoredDetailsScroll: number | undefined;
  const [scrollbox, setScrollbox] = createSignal<ScrollBoxRenderable>();
  const [detailsScrollbox, setDetailsScrollbox] = createSignal<ScrollBoxRenderable>();
  const reader = () => props.state.reader;
  let address = reader().address;
  const commitFind = () => props.onCommitFind(find());
  onMount(() => props.onRegisterFindCommit(commitFind));
  onCleanup(() => props.onRegisterFindCommit(() => {}));
  createEffect(() => {
    if (reader().address !== address) {
      address = reader().address;
      setFind(reader().find);
    }
  });
  createEffect(() => {
    const details = detailsScrollbox();
    if (reader().tab === "details" && details)
      if (
        restoredDetailsAddress !== reader().address?.source + "/" + reader().address?.path ||
        restoredDetailsScroll !== reader().detailsScroll
      ) {
        details.scrollTop = reader().detailsScroll;
        restoredDetailsAddress = reader().address?.source + "/" + reader().address?.path;
        restoredDetailsScroll = reader().detailsScroll;
      }
  });
  const source = () => {
    const resource = reader().resource;
    if (resource?.kind === "text") return resource.text;
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
  const content = () => {
    const resource = reader().resource;
    if (resource?.kind === "not-text") {
      return `Cannot preview ${resource.reason} resource\n${resource.metadata.path}  ${resource.metadata.kind}${resource.metadata.size === undefined ? "" : ` ${resource.metadata.size} bytes`}${resource.metadata.executable ? " executable" : ""}${resource.metadata.gitlinkCommit ? ` ${resource.metadata.gitlinkCommit}` : ""}`;
    }
    return source();
  };
  const textResource = () => {
    const resource = reader().resource;
    return resource?.kind === "text" ? resource : undefined;
  };
  const descriptor = (resource: TuiState["reader"]["resources"][number]) =>
    `${resource.path}  ${resource.kind}${resource.size === undefined ? "" : ` ${resource.size} bytes`}${resource.executable === undefined ? "" : resource.executable ? " executable" : " not executable"}${resource.gitlinkCommit ? ` ${resource.gitlinkCommit}` : ""}`;
  const readerError = () => reader().error;
  const details = () => {
    const skill = props.skill;
    if (!skill) return "Select an Installed Skill";
    const source = skill.source;
    const directOwner = source?.contribution
      ? undefined
      : props.state.workspace?.configs
          .flatMap((config) => config.direct.sources)
          .find((item) => item.id === source?.id)?.ref.owner;
    const configSource = source?.contribution
      ? props.state.workspace?.configs
          .find((config) => config.level === source.contribution!.configSource.level)
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
        : ["For agents  Agent selector paths are unavailable"];
    const agent = props.state.workspace?.effective.agent;
    const readiness =
      agent?.status === "available"
        ? "Available"
        : agent?.reasons.map((reason) => `${reason.code}: ${reason.message}`).join("; ") ||
          "Unavailable";
    return [
      `Address  ${skill.address.source}/${skill.address.path}`,
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
      `Owner  ${skill.owner.health}`,
      `Problems  ${skill.problems.map((problem) => `${problem.code}: ${problem.message}`).join("; ") || "None"}`,
      `Description  ${skill.description}`,
    ]
      .filter(Boolean)
      .join("\n");
  };
  // Native Markdown rebuilds code blocks whenever its content setter runs. Keep the
  // payload independent from find, focus, and match state.
  const markdownContent = createMemo(
    () => {
      const resource = reader().resource;
      return resource?.kind === "text" ? resource.text : (reader().text ?? "");
    },
    "",
    { equals: (previous, next) => previous === next },
  );
  const resourceMarkdownContent = createMemo(
    () => (textResource()?.format === "markdown" ? textResource()!.text : ""),
    "",
    { equals: (previous, next) => previous === next },
  );
  const showMarkdown = createMemo(
    () => reader().tab === "skill" && !reader().raw && reader().resource?.kind !== "text",
    false,
    { equals: (previous, next) => previous === next },
  );
  createEffect(() => {
    if (props.state.focus === "input") findInput?.focus();
    else if (props.state.focus === "reader") {
      findInput?.blur();
      if (reader().tab === "details") detailsScrollbox()?.focus();
      else readerScrollbox?.focus();
    } else if (props.state.focus === "reader-tabs") readerTabs?.focus();
    else if (props.state.focus === "reader-raw") readerRaw?.focus();
    else if (props.state.focus === "reader-find-previous") readerFindPrevious?.focus();
    else if (props.state.focus === "reader-find-next") readerFindNext?.focus();
    else if (props.state.focus === "open-match-raw") openMatchRaw?.focus();
    else if (props.state.focus === "reader-resource-list") resourceBrowser?.focus();
    else if (props.state.focus === "reader-resource-content") resourceContent?.focus();
    else if (props.state.focus === "reader-resource-retry") resourceRetry?.focus();
    else if (props.state.focus === "inspector") detailsActions?.focus();
    else if (props.state.focus === "details-relationships") detailsRelationships?.focus();
  });
  createEffect(() => {
    const address = reader().address;
    const tab = reader().tab;
    if (!address) return;
    const index = ["skill", "resources", "details"].indexOf(tab);
    if (readerTabs?.getSelectedIndex() !== index) {
      synchronizingTab = true;
      readerTabs?.setSelectedIndex(index);
      synchronizingTab = false;
    }
  });
  const detailRelationships = () => {
    const skill = props.skill;
    if (!skill) return [];
    const source = skill.source;
    const directOwner = source?.contribution
      ? undefined
      : props.state.workspace?.configs
          .flatMap((config) => config.direct.sources)
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
  createEffect(() => {
    const native = scrollbox();
    if (!native) return;
    const savedAddress = reader().address
      ? `${reader().address!.source}/${reader().address!.path}`
      : undefined;
    const savedScroll = reader().scroll;
    if (savedAddress === restoredAddress && savedScroll === restoredScroll) return;
    native.scrollTop = savedScroll;
    restoredAddress = savedAddress;
    restoredScroll = savedScroll;
  });
  createEffect(() => {
    const raw = reader().raw;
    const markdown = showMarkdown();
    const line = raw ? reader().scroll : current()?.line;
    if (!scrollbox() || markdown || line === undefined) return;
    queueMicrotask(() => revealCurrent(raw, line));
  });
  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={props.narrow ? 0 : 1}>
      <tab_select
        id="reader-tabs"
        ref={(value: TabSelectRenderable) => {
          readerTabs = value;
        }}
        focused={props.state.focus === "reader-tabs"}
        options={[
          { name: "SKILL.md", description: "", value: "skill" },
          { name: "Resources", description: "", value: "resources" },
          { name: "Details", description: "", value: "details" },
        ]}
        showDescription={false}
        showUnderline={false}
        wrapSelection={false}
        onChange={(index) => {
          if (synchronizingTab) return;
          const tab = ["skill", "resources", "details"] as const;
          const next = tab[index]!;
          commitFind();
          props.onPatch({
            tab: next,
            resource: undefined,
            resourceLevel: "list",
            loading: false,
            error: undefined,
          });
          if (next === "resources" && !reader().resourcesLoaded && !reader().loading)
            props.onResources();
        }}
      />
      {reader().tab === "resources" ? (
        <>
          {(!props.narrow || reader().resourceLevel !== "content") && (
            <>
              <select
                id="resource-browser"
                ref={(value: SelectRenderable) => {
                  resourceBrowser = value;
                }}
                focused={props.state.focus === "reader-resource-list"}
                height={8}
                options={reader().resources.map((resource) => ({
                  name: descriptor(resource),
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
                onChange={(index) =>
                  props.onPatch({ selectedResource: reader().resources[index]?.path })
                }
                onSelect={(index) => {
                  const resource = reader().resources[index];
                  if (resource?.kind === "file") props.onReadResource(resource.path);
                }}
              />
              {reader().loading && <text>Loading resources</text>}
              {!reader().loading && reader().resourcesLoaded && reader().resources.length === 0 && (
                <text>No supporting resources</text>
              )}
            </>
          )}
          {reader().resourceLevel === "content" && (
            <>
              <text>{reader().selectedResource ?? "Resource"}</text>
              {reader().loading && <text>Loading resource content</text>}
              {textResource() && !reader().loading && (
                <scrollbox
                  id="resource-content"
                  ref={(value: ScrollBoxRenderable) => {
                    resourceContent = value;
                  }}
                  width="100%"
                  height={8}
                  flexGrow={1}
                  focused={props.state.focus === "reader-resource-content"}
                >
                  {textResource()!.format === "markdown" ? (
                    <NativeMarkdown content={resourceMarkdownContent} />
                  ) : (
                    content()
                      .split("\n")
                      .map((line, index) => (
                        <text id={`resource-line-${index}`} selectable>
                          {line}
                        </text>
                      ))
                  )}
                </scrollbox>
              )}
              {reader().resource?.kind === "not-text" && !reader().loading && (
                <scrollbox
                  id="resource-content"
                  ref={(value: ScrollBoxRenderable) => {
                    resourceContent = value;
                  }}
                  width="100%"
                  height={8}
                  flexGrow={1}
                  focused={props.state.focus === "reader-resource-content"}
                >
                  <text selectable>{content()}</text>
                </scrollbox>
              )}
            </>
          )}
          {readerError() && (
            <>
              <text>{`${readerError()!.code}: ${readerError()!.message}`}</text>
              <select
                id="resource-retry"
                ref={(value: SelectRenderable) => {
                  resourceRetry = value;
                }}
                focused={props.state.focus === "reader-resource-retry"}
                options={[
                  { name: "Retry", description: "Repeat this resource request", value: "retry" },
                ]}
                showDescription={false}
                onSelect={props.onRetryResource}
              />
            </>
          )}
        </>
      ) : reader().tab === "details" ? (
        <scrollbox
          id="reader-details"
          ref={(value: ScrollBoxRenderable) => {
            setDetailsScrollbox(value);
          }}
          flexGrow={1}
          focused={props.state.focus === "reader"}
          onMouseScroll={() => {
            const scroll = detailsScrollbox()?.scrollTop;
            if (scroll && scroll > 0) props.onDetailsScroll(scroll);
          }}
        >
          <text selectable>{details()}</text>
          <select
            id="reader-details-actions"
            ref={(value: SelectRenderable) => {
              detailsActions = value;
            }}
            focused={props.state.focus === "inspector"}
            options={[
              {
                name: "Actions",
                description: "Actions for this Installed Skill",
                value: "actions",
              },
            ]}
            showDescription={false}
            onSelect={props.onDetailsActions}
          />
          {detailRelationships().length > 0 && (
            <select
              id="reader-details-relationships"
              ref={(value: SelectRenderable) => {
                detailsRelationships = value;
              }}
              focused={props.state.focus === "details-relationships"}
              options={detailRelationships()}
              showDescription
              onSelect={(_index, option) => option && props.onDetailsRelationship(option.value)}
            />
          )}
        </scrollbox>
      ) : (
        <>
          <box flexDirection="row">
            <input
              id="reader-find"
              ref={(value: InputRenderable) => {
                findInput = value;
              }}
              focused={props.state.focus === "input"}
              placeholder="Find"
              value={find()}
              onInput={setFind}
              onSubmit={() => commitFind()}
            />
            <text id="reader-find-count">
              {find()
                ? ` ${Math.min(reader().match + 1, matches().length)}/${matches().length}`
                : " "}
            </text>
            <text>{reader().raw ? "Prose" : "Raw"}</text>
            <select
              id="reader-raw"
              ref={(value: SelectRenderable) => {
                readerRaw = value;
              }}
              focused={props.state.focus === "reader-raw"}
              options={[{ name: "Toggle", description: "", value: "raw" }]}
              showDescription={false}
              onSelect={() => {
                commitFind();
                props.onPatch({ raw: !reader().raw });
              }}
            />
          </box>
          {!!find() && !!current() && (
            <box flexDirection="row">
              <select
                id="reader-find-previous"
                ref={(value: SelectRenderable) => {
                  readerFindPrevious = value;
                }}
                focused={props.state.focus === "reader-find-previous"}
                options={[{ name: "Previous", description: "", value: "previous" }]}
                showDescription={false}
                onSelect={() => {
                  const match = matches()[Math.max(0, reader().match - 1)];
                  props.onPatch({
                    match: Math.max(0, reader().match - 1),
                    scroll: match?.line ?? 0,
                  });
                  queueMicrotask(() => revealCurrent(reader().raw, match?.line));
                }}
              />
              <select
                id="reader-find-next"
                ref={(value: SelectRenderable) => {
                  readerFindNext = value;
                }}
                focused={props.state.focus === "reader-find-next"}
                options={[{ name: "Next", description: "", value: "next" }]}
                showDescription={false}
                onSelect={() => {
                  const match = matches()[Math.min(matches().length - 1, reader().match + 1)];
                  props.onPatch({
                    match: Math.min(matches().length - 1, reader().match + 1),
                    scroll: match?.line ?? 0,
                  });
                  queueMicrotask(() => revealCurrent(reader().raw, match?.line));
                }}
              />
              {showMarkdown() && (
                <select
                  id="open-match-raw"
                  ref={(value: SelectRenderable) => {
                    openMatchRaw = value;
                  }}
                  focused={props.state.focus === "open-match-raw"}
                  options={[
                    { name: "Open current match in Raw", description: "", value: "raw-match" },
                  ]}
                  showDescription={false}
                  onSelect={() => {
                    const line = rawLineForMarkdownMatch(
                      reader().rawText ?? "",
                      reader().text ?? "",
                      current()?.offset ?? 0,
                    );
                    props.onPatch({ raw: true, scroll: line });
                  }}
                />
              )}
            </box>
          )}
          <scrollbox
            id="reader-scrollbox"
            ref={(value: ScrollBoxRenderable) => {
              readerScrollbox = value;
              setScrollbox(value);
            }}
            flexGrow={1}
            focused={props.state.focus === "reader"}
            onMouseScroll={() =>
              queueMicrotask(() => {
                const scroll = readerScrollbox?.scrollTop;
                if (scroll && scroll > 0) props.onPatch({ scroll });
              })
            }
          >
            {reader().loading ? (
              <text>Loading SKILL.md</text>
            ) : reader().error ? (
              <text>{`${reader().error?.code}: ${reader().error?.message}`}</text>
            ) : (
              <Show
                when={showMarkdown()}
                fallback={content()
                  .split("\n")
                  .map((line, index) => (
                    <text id={`reader-line-${index}`} selectable>
                      {line}
                    </text>
                  ))}
              >
                <NativeMarkdown content={markdownContent} />
              </Show>
            )}
          </scrollbox>
        </>
      )}
    </box>
  );
}
