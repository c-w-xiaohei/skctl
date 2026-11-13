import { sameSkillAddress, type ConfigDeclarationOwner, type SkillAddress } from "@skctl/core";
import { SelectRenderable } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createSignal, Index, Show } from "solid-js";
import {
  createModalControlRegistry,
  useModalControl,
  useModalControlTraversal,
} from "../modal-controls";
import { DataList } from "../ui/data-list";
import { Input } from "../ui/input";
import { ownerLine } from "./collection-review";
import { ModalBody, ModalCommand, modalCommand, ModalShell } from "./modal";

export function RebindSourceOverlay(props: {
  readonly address?: SkillAddress;
  readonly sources: readonly string[];
  readonly onSelect: (source: string, ownerPath: string) => void;
  readonly onClose: () => void;
}) {
  const controls = createModalControlRegistry();
  const [ownerPath, setOwnerPath] = createSignal("");
  const [owner, setOwner] = createSignal<string | undefined>(props.sources[0]);
  const registerSource = useModalControl("rebind-source-choice", controls, 10);
  const registerPath = useModalControl("rebind-owner-path", controls, 20);
  useModalControlTraversal(controls, props.onClose);
  const validPath = () => {
    const path = ownerPath().trim();
    return !!owner() && !!path && !path.startsWith("/") && !path.split("/").includes("..");
  };
  return (
    <ModalShell>
      <ModalBody
        controls={controls}
        maxWidth={76}
        maxHeight={Math.min(4, props.sources.length) + 11}
        footer={
          <box flexDirection="row" gap={1} flexShrink={0}>
            <ModalCommand
              id="rebind-preview"
              intent="primary"
              order={30}
              controls={controls}
              record={modalCommand(
                "rebind.review",
                "Review change",
                "Check the new Source and preview affected references",
                validPath(),
              )}
              execute={() => props.onSelect(owner()!, ownerPath().trim())}
            />
            <ModalCommand
              id="rebind-cancel"
              order={40}
              controls={controls}
              record={modalCommand("rebind.cancel", "Cancel", "Return to previous view")}
              execute={props.onClose}
            />
          </box>
        }
      >
        <text flexShrink={0}>Change Source</text>
        <Show when={props.address}>
          <text
            wrapMode="word"
            flexShrink={0}
          >{`Current Skill: ${props.address!.source}/${props.address!.path}`}</text>
        </Show>
        <Show
          when={props.sources.length}
          fallback={
            <text wrapMode="word">
              No other Source is available. Add a Source in Sources, then try again.
            </text>
          }
        >
          <text flexShrink={0}>New Source</text>
          <DataList
            id="rebind-source-choice"
            ref={registerSource}
            focused
            height={Math.min(4, props.sources.length)}
            flexShrink={0}
            options={props.sources.map((source) => ({
              name: source,
              description: "",
              value: source,
            }))}
            showDescription={false}
            onChange={(_index, option) => {
              if (option) setOwner(option.value);
            }}
            onSelect={(_index, option) => {
              if (option) setOwner(option.value);
            }}
          />
          <text flexShrink={0}>Skill path in new Source</text>
          <Input
            id="rebind-owner-path"
            ref={registerPath}
            focused={false}
            placeholder="e.g. skills/my-skill"
            value={ownerPath()}
            onInput={setOwnerPath}
          />
          <text wrapMode="word" flexShrink={0}>
            Relative path. Review checks Skill identity.
          </text>
          <Show when={ownerPath().trim() && !validPath()}>
            <text wrapMode="word" flexShrink={0}>
              Use a relative path without ..
            </text>
          </Show>
        </Show>
      </ModalBody>
    </ModalShell>
  );
}

export function CollectionHandoffOverlay(props: {
  readonly onCreate?: () => void;
  readonly choices: readonly {
    readonly collection: string;
    readonly fixed?: boolean;
    readonly level?: "global" | "project" | "local";
    readonly owner?: ConfigDeclarationOwner;
  }[];
  readonly onSelect: (choice: {
    readonly collection: string;
    readonly level?: "global" | "project" | "local";
    readonly owner?: ConfigDeclarationOwner;
  }) => void;
  readonly onClose: () => void;
}) {
  const controls = createModalControlRegistry();
  const registerChoice = useModalControl("collection-handoff-choice", controls);
  const renderer = useRenderer();
  const terminal = useTerminalDimensions();
  const [query, setQuery] = createSignal("");
  const [collection, setCollection] = createSignal<string>();
  const [current, setCurrent] = createSignal(0);
  const [selectedCollection, setSelectedCollection] = createSignal<string>();
  const collections = () =>
    [...new Set(props.choices.map((choice) => choice.collection))].filter((id) =>
      id.toLowerCase().includes(query().trim().toLowerCase()),
    );
  const owners = () => props.choices.filter((choice) => choice.collection === collection());
  const back = () => {
    if (collection()) {
      setCollection(undefined);
      queueMicrotask(() => renderer.root.findDescendantById("collection-handoff-choice")?.focus());
    } else props.onClose();
  };
  const choose = (id: string) => {
    const choices = props.choices.filter((choice) => choice.collection === id);
    if (choices.length === 1) props.onSelect(choices[0]!);
    else {
      setCurrent(0);
      setCollection(id);
    }
  };
  useModalControlTraversal(controls, back);
  return (
    <ModalShell transparent>
      <ModalBody
        controls={controls}
        maxWidth={76}
        maxHeight={Math.min(terminal().height - 2, Math.max(10, collections().length + 7))}
        scroll={false}
        header={
          <text height={1} wrapMode="none" flexShrink={0}>
            {collection() ? `Save to: ${collection()}` : "Add to Collection"}
          </text>
        }
        footer={
          <box flexDirection="row" gap={1} flexShrink={0}>
            <Show when={props.onCreate}>
              <ModalCommand
                id="collection-handoff-create"
                controls={controls}
                record={modalCommand(
                  "collection-handoff.create",
                  "New Collection…",
                  "Create and continue",
                )}
                execute={() => props.onCreate?.()}
              />
            </Show>
            <ModalCommand
              id="collection-handoff-cancel"
              controls={controls}
              record={modalCommand(
                "collection-handoff.cancel",
                collection() ? "Back" : "Cancel",
                "Return to previous view",
              )}
              execute={back}
            />
          </box>
        }
      >
        <Show
          when={props.choices.length}
          fallback={
            <text wrapMode="word">No available Collection. Create one to add this Skill.</text>
          }
        >
          <Show
            when={!collection()}
            fallback={
              <>
                <text>Choose where to add these Skills.</text>
                <DataList
                  id="collection-handoff-owner"
                  focused
                  flexGrow={1}
                  minHeight={1}
                  ref={useModalControl("collection-handoff-owner", controls)}
                  showDescription={false}
                  options={owners().map((choice, index) => ({
                    name: choice.level ?? "Choose a new save location…",
                    description: choice.owner?.file ?? "",
                    value: index,
                  }))}
                  onChange={(index) => setCurrent(index)}
                  onSelect={(_index, option) => option && props.onSelect(owners()[option.value]!)}
                />
                <scrollbox
                  height={2}
                  flexShrink={0}
                  focusable
                  scrollX={false}
                  ref={useModalControl("collection-handoff-location", controls)}
                >
                  <text wrapMode="word">{owners()[current()]?.owner?.file ?? ""}</text>
                </scrollbox>
              </>
            }
          >
            <text flexShrink={0}>Search Collections</text>
            <Input
              id="collection-handoff-search"
              ref={useModalControl("collection-handoff-search", controls)}
              value={query()}
              onInput={(value) => {
                setQuery(value);
                setCurrent(0);
              }}
            />
            <DataList
              id="collection-handoff-choice"
              focused={true}
              flexGrow={1}
              minHeight={1}
              showDescription={false}
              ref={registerChoice}
              options={collections().map((id) => ({
                name: id,
                description: "",
                value: id,
              }))}
              selectedIndex={Math.max(0, collections().indexOf(selectedCollection() ?? ""))}
              onChange={(index, option) => {
                setCurrent(index);
                if (option) setSelectedCollection(option.value);
              }}
              onSelect={(_index, option) => option && choose(option.value)}
            />
            <Show when={!collections().length}>
              <text>No matching Collections. Change the search.</text>
            </Show>
          </Show>
        </Show>
      </ModalBody>
    </ModalShell>
  );
}

export function InstalledSkillChooserOverlay(props: {
  readonly collection: string;
  readonly owner: ConfigDeclarationOwner;
  readonly members?: readonly { readonly name: string; readonly address: SkillAddress }[];
  readonly pending?: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly initialQuery?: string;
  readonly initialSource?: string;
  readonly initialSelected?: readonly { readonly name: string; readonly address: SkillAddress }[];
  readonly onAcquire?: (draft: {
    query: string;
    source?: string;
    additions: readonly { readonly name: string; readonly address: SkillAddress }[];
  }) => void;
  readonly skills: readonly {
    readonly address: { readonly source: string; readonly path: string };
    readonly name: string;
    readonly description: string;
  }[];
  readonly onSelect: (
    items: readonly { readonly address: SkillAddress; readonly name: string }[],
  ) => void;
  readonly onClose: () => void;
}) {
  const controls = createModalControlRegistry();
  const terminal = useTerminalDimensions();
  const [query, setQuery] = createSignal(props.initialQuery ?? "");
  const [source, setSource] = createSignal(props.initialSource);
  const sources = () => [...new Set(props.skills.map((skill) => skill.address.source))].sort();
  const [selected, setSelected] = createSignal<readonly { name: string; address: SkillAddress }[]>(
    props.initialSelected ?? [],
  );
  const registerSearch = useModalControl("installed-skill-search", controls, 10);
  const registerSource = useModalControl("installed-skill-source", controls, 15);
  const registerChoice = useModalControl("installed-skill-choice", controls, 20);
  const matches = () =>
    props.skills.filter(
      (skill) =>
        (!source() || skill.address.source === source()) &&
        `${skill.name} ${skill.description} ${skill.address.source}/${skill.address.path}`
          .toLowerCase()
          .includes(query().trim().toLowerCase()),
    );
  const included = (address: SkillAddress) =>
    props.members?.some((member) => sameSkillAddress(member.address, address));
  const toggle = (index: number) => {
    const skill = matches()[index];
    if (!skill || included(skill.address) || props.pending) return;
    setSelected((items) =>
      items.some((item) => sameSkillAddress(item.address, skill.address))
        ? items.filter((item) => !sameSkillAddress(item.address, skill.address))
        : [...items, { name: skill.name, address: skill.address }],
    );
  };
  const conflict = () =>
    selected().some(
      (item, index, all) =>
        !item.name.trim() ||
        all.some(
          (other, otherIndex) => otherIndex !== index && other.name.trim() === item.name.trim(),
        ) ||
        props.members?.some((member) => member.name === item.name.trim()),
    );
  controls.intercept((event, current) => {
    if (
      event.name !== "space" ||
      current?.id !== "installed-skill-choice" ||
      !(current instanceof SelectRenderable)
    )
      return false;
    event.preventDefault();
    event.stopPropagation();
    toggle(current.getSelectedIndex());
    return true;
  });
  useModalControlTraversal(controls, props.onClose);
  return (
    <ModalShell>
      <ModalBody
        controls={controls}
        header={
          <>
            <text height={1} wrapMode="none">
              {`Add Skills to ${props.collection}`}
            </text>
          </>
        }
        footer={
          <box flexDirection="row" flexWrap="wrap" gap={1}>
            <ModalCommand
              id="installed-skill-choice-submit"
              controls={controls}
              order={1000}
              intent="primary"
              record={modalCommand(
                "installed-skill-choice.submit",
                props.pending ? "Adding…" : `Add ${selected().length} Skills`,
                "Add to this Collection",
                !props.pending && selected().length > 0 && !conflict(),
              )}
              execute={() =>
                props.onSelect(selected().map((item) => ({ ...item, name: item.name.trim() })))
              }
            />
            <ModalCommand
              id="installed-skill-choice-cancel"
              controls={controls}
              order={1001}
              record={modalCommand(
                "installed-skill-choice.cancel",
                "Cancel",
                "Return to Collection",
              )}
              execute={props.onClose}
            />
          </box>
        }
      >
        <Input
          id="installed-skill-search"
          ref={registerSearch}
          focused={false}
          value={query()}
          placeholder="Search Skills or Source"
          onInput={setQuery}
        />
        <DataList
          id="installed-skill-source"
          ref={registerSource}
          height={1}
          focused={false}
          showDescription={false}
          options={[
            { name: "All Sources", description: "", value: "" },
            ...sources().map((value) => ({ name: value, description: "", value })),
          ]}
          selectedIndex={source() ? sources().indexOf(source()!) + 1 : 0}
          onChange={(_index, option) => option && setSource(option.value || undefined)}
        />
        <DataList
          id="installed-skill-choice"
          focused={true}
          height={Math.max(1, Math.min(matches().length * 2, terminal().height - 7))}
          ref={registerChoice}
          options={matches().map((skill, index) => ({
            name: `${included(skill.address) ? "[-]" : selected().some((item) => sameSkillAddress(item.address, skill.address)) ? "[x]" : "[ ]"} ${skill.name}  ${skill.address.source}/${skill.address.path}`,
            description: included(skill.address) ? "Already included" : skill.description,
            value: `${index}`,
          }))}
          showDescription
          onSelect={(_index, option) => {
            if (!option) return;
            toggle(Number(option.value));
          }}
        />
        <text wrapMode="word">{`Collection: ${props.collection}`}</text>
        <text wrapMode="word">{`Save to ${ownerLine(props.owner)}`}</text>
        <text>{`${selected().length} selected`}</text>
        <Index each={selected()}>
          {(item, index) => (
            <Input
              id={`installed-skill-name-${index}`}
              focused={false}
              ref={useModalControl(`installed-skill-name-${index}`, controls, 30 + index)}
              value={item().name}
              placeholder="Member name"
              onInput={(name) =>
                setSelected((items) =>
                  items.map((entry, i) => (i === index ? { ...entry, name } : entry)),
                )
              }
            />
          )}
        </Index>
        {conflict() && (
          <text>Choose unique, nonempty names; existing member names are reserved.</text>
        )}
        {props.error && (
          <>
            <text wrapMode="word">{`${props.error.code}: ${props.error.message}`}</text>
            <text wrapMode="word">{`Skills remain installed. This addition to ${props.collection} has not completed; retry keeps the current selection.`}</text>
          </>
        )}
        {props.onAcquire && (
          <ModalCommand
            id="installed-skill-acquire"
            controls={controls}
            order={900}
            record={modalCommand(
              "installed-skill.acquire",
              "Get Skills from Source…",
              "Keep this Collection and selection",
              !props.pending,
            )}
            execute={() =>
              props.onAcquire?.({ query: query(), source: source(), additions: selected() })
            }
          />
        )}
      </ModalBody>
    </ModalShell>
  );
}
