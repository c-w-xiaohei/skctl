import {
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  SyntaxStyle,
  TabSelectRenderable,
} from "@opentui/core";
import type { BaseRenderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { InstalledSkill, ReaderState } from "./types";
import type { ManagementProjection } from "../core/api";
import { findLiteralMatches, rawLineForMarkdownMatch } from "./types";
import type { FocusRegistry, FocusTarget } from "./focus";
import { Accordion } from "@tuiparts/solid/accordion";

const syntaxStyle = SyntaxStyle.fromStyles({});

function NativeMarkdown(props: { readonly content: () => string }) {
  return (
    <markdown
      content={props.content()}
      syntaxStyle={syntaxStyle}
      streaming={false}
      conceal
      internalBlockMode="coalesced"
      tableOptions={{ selectable: true, wrapMode: "word" }}
    />
  );
}

export function Reader(props: {
  readonly reader: () => ReaderState;
  readonly projection: () => ManagementProjection | undefined;
  readonly focusRegistry?: FocusRegistry;
  readonly skill?: InstalledSkill;
  readonly narrow: boolean;
  readonly onPatch: (value: Partial<ReaderState>) => void;
  readonly onCommitFind: (value: string) => void;
  readonly onResources: () => void;
  readonly onReadResource: (path: string) => void;
  readonly onRetryResource: () => void;
  readonly onResourceBack: () => void;
  readonly onDetailsActions: () => void;
  readonly onDetailsRelationship: (value: string) => void;
  readonly onDetailsScroll: (scroll: number) => void;
}) {
  const [find, setFind] = createSignal(props.reader().find);
  const [markdownFallback, setMarkdownFallback] = createSignal(false);
  const [metadataOpenAddress, setMetadataOpenAddress] = createSignal<string>();
  let readerScrollbox: ScrollBoxRenderable | undefined;
  let readerTabs: TabSelectRenderable | undefined;
  let synchronizingTab = false;
  let restoredAddress: string | undefined;
  let restoredScroll: number | undefined;
  let restoredDetailsAddress: string | undefined;
  let restoredDetailsScroll: number | undefined;
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
  const [scrollbox, setScrollbox] = createSignal<ScrollBoxRenderable>();
  const [detailsScrollbox, setDetailsScrollbox] = createSignal<ScrollBoxRenderable>();
  const reader = props.reader;
  let address = reader().address;
  const readerAddress = () =>
    reader().address ? `${reader().address!.source}/${reader().address!.path}` : undefined;
  const installedSkill = () => props.skill;
  const commitFind = () => {
    const current = reader().address;
    if (current?.source === address?.source && current?.path === address?.path)
      props.onCommitFind(find());
  };
  onCleanup(() => {
    bindings.forEach((dispose) => dispose());
  });
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
  const descriptor = (resource: ReaderState["resources"][number]) =>
    `${resource.path}  ${resource.kind}${resource.size === undefined ? "" : ` ${resource.size} bytes`}${resource.executable === undefined ? "" : resource.executable ? " executable" : " not executable"}${resource.gitlinkCommit ? ` ${resource.gitlinkCommit}` : ""}`;
  const readerError = () => reader().error;
  const readerIdentity = () => {
    const installed = installedSkill();
    return installed
      ? `Reader · ${installed.name}\nSource: ${installed.address.source}\nPath: ${installed.address.path}`
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
        : ["For agents  Agent selector paths are unavailable"];
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
    () =>
      reader().tab === "skill" &&
      !markdownFallback() &&
      !reader().raw &&
      reader().resource?.kind !== "text",
    false,
    { equals: (previous, next) => previous === next },
  );
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
  createEffect(() => {
    if (reader().tab !== "skill") setMarkdownFallback(true);
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
    <box flexDirection="column" flexGrow={1} minWidth={0} height="100%" minHeight={0}>
      <text id="reader-identity" width="100%" height={5} flexShrink={0} wrapMode="word">
        {readerIdentity()}
      </text>
      <box flexDirection="row" height={1} flexShrink={0}>
        <text>View: </text>
        <box flexGrow={1} height={1}>
          <tab_select
            id="reader-tabs"
            ref={(value: TabSelectRenderable) => {
              readerTabs = value;
              bind("reader-tabs", value);
            }}
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
              props.onPatch({ tab: next });
            }}
          />
        </box>
      </box>
      {reader().tab === "resources" && (
        <>
          {(!props.narrow || reader().resourceLevel !== "content") && (
            <>
              <select
                id="resource-browser"
                ref={(value: SelectRenderable) => {
                  bind("reader-resource-list", value);
                }}
                height={readerError() ? 8 : undefined}
                flexGrow={readerError() ? undefined : 1}
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
                showSelectionIndicator
                showScrollIndicator
                onChange={(index) =>
                  props.onPatch({ selectedResource: reader().resources[index]?.path })
                }
                onSelect={(index) => {
                  const resource = reader().resources[index];
                  if (resource?.kind === "file") props.onReadResource(resource.path);
                }}
              />
              {reader().resourceLoading && <text>Loading resources</text>}
              {!reader().resourceLoading &&
                reader().resourcesLoaded &&
                reader().resources.length === 0 && <text>No supporting resources</text>}
            </>
          )}
          {reader().resourceLevel === "content" && (
            <>
              <text>{reader().selectedResource ?? "Resource"}</text>
              {reader().resourceLoading && (
                <scrollbox
                  id="resource-content"
                  ref={(value: ScrollBoxRenderable) => {
                    bind("reader-resource-content", value);
                  }}
                  width="100%"
                  flexGrow={1}
                  flexShrink={1}
                  minHeight={0}
                >
                  <text>Loading resource content</text>
                </scrollbox>
              )}
              {textResource() && !reader().resourceLoading && (
                <scrollbox
                  id="resource-content"
                  ref={(value: ScrollBoxRenderable) => {
                    bind("reader-resource-content", value);
                  }}
                  width="100%"
                  flexGrow={1}
                  flexShrink={1}
                  minHeight={0}
                >
                  {textResource()!.format === "markdown" ? (
                    <NativeMarkdown content={resourceMarkdownContent} />
                  ) : (
                    content()
                      .split("\n")
                      .map((line, index) => (
                        <text id={`resource-line-${index}`} selectable wrapMode="word">
                          {line}
                        </text>
                      ))
                  )}
                </scrollbox>
              )}
              {reader().resource?.kind === "not-text" && !reader().resourceLoading && (
                <scrollbox
                  id="resource-content"
                  ref={(value: ScrollBoxRenderable) => {
                    bind("reader-resource-content", value);
                  }}
                  width="100%"
                  flexGrow={1}
                  flexShrink={1}
                  minHeight={0}
                >
                  <text selectable wrapMode="word">
                    {content()}
                  </text>
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
                  bind("reader-resource-retry", value);
                }}
                options={[
                  { name: "Retry", description: "Repeat this resource request", value: "retry" },
                ]}
                showDescription={false}
                onSelect={props.onRetryResource}
              />
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
            const scroll = detailsScrollbox()?.scrollTop;
            if (scroll && scroll > 0) props.onDetailsScroll(scroll);
          }}
        >
          <text selectable wrapMode="word">
            {detailsSummary()}
          </text>
          <select
            id="reader-details-actions"
            ref={(value: SelectRenderable) => {
              bind("inspector", value);
            }}
            options={[
              {
                name: "Actions",
                description: "Actions for this Installed Skill",
                value: "actions",
              },
            ]}
            height={1}
            flexShrink={0}
            showDescription={false}
            onSelect={props.onDetailsActions}
          />
          {detailRelationships().length > 0 && (
            <select
              id="reader-details-relationships"
              ref={(value: SelectRenderable) => {
                bind("details-relationships", value);
              }}
              options={detailRelationships()}
              height={1}
              flexShrink={0}
              showDescription
              onSelect={(_index, option) => option && props.onDetailsRelationship(option.value)}
            />
          )}
          <Show
            when={
              reader().address ? `${reader().address!.source}/${reader().address!.path}` : undefined
            }
            keyed
          >
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
                      if (value) bind("details-metadata", value);
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
            onSubmit={() => commitFind()}
          />
          <text id="reader-find-count">
            {find()
              ? ` ${Math.min(reader().match + 1, matches().length)}/${matches().length}`
              : " "}
          </text>
        </box>
        <box height={1}>
          <select
            id="reader-raw"
            ref={(value: SelectRenderable) => bind("reader-raw", value)}
            options={[{ name: reader().raw ? "Prose" : "Raw", description: "", value: "raw" }]}
            showDescription={false}
            onSelect={() => {
              commitFind();
              props.onPatch({ raw: !reader().raw });
            }}
          />
        </box>
        {!!find() && !!current() && (
          <>
            <box height={1}>
              <select
                id="reader-find-previous"
                ref={(value: SelectRenderable) => bind("reader-find-previous", value)}
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
            </box>
            <box height={1}>
              <select
                id="reader-find-next"
                ref={(value: SelectRenderable) => bind("reader-find-next", value)}
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
            </box>
            {showMarkdown() && (
              <box height={1}>
                <select
                  id="open-match-raw"
                  ref={(value: SelectRenderable) => bind("open-match-raw", value)}
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
