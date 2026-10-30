import { sameSkillAddress, type ConfigDeclarationOwner, type SkillAddress } from "@skctl/core";
import { SelectRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createSignal, Index } from "solid-js";
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
  readonly sources: readonly string[];
  readonly onSelect: (source: string, ownerPath: string) => void;
  readonly onClose: () => void;
}) {
  const controls = createModalControlRegistry();
  const [ownerPath, setOwnerPath] = createSignal("");
  const [owner, setOwner] = createSignal<string>();
  const registerSource = useModalControl("rebind-source-choice", controls, 10);
  const registerPath = useModalControl("rebind-owner-path", controls, 20);
  useModalControlTraversal(controls, props.onClose);
  const validPath = () => {
    const path = ownerPath().trim();
    return !!owner() && !!path && !path.startsWith("/") && !path.split("/").includes("..");
  };
  return (
    <ModalShell>
      <ModalBody>
        <text>Rebind Skill</text>
        <DataList
          id="rebind-source-choice"
          ref={registerSource}
          focused
          options={props.sources.map((source) => ({
            name: source,
            description: "Prove this Source owns the same Installed Skill identity",
            value: source,
          }))}
          showDescription
          onSelect={(_index, option) => {
            if (option) setOwner(option.value);
          }}
        />
        <Input
          id="rebind-owner-path"
          ref={registerPath}
          focused={false}
          placeholder="Replacement Source-root-relative Skill path"
          value={ownerPath()}
          onInput={setOwnerPath}
        />
        <box flexDirection="column" gap={1} flexShrink={0}>
          <ModalCommand
            id="rebind-preview"
            intent="primary"
            order={30}
            controls={controls}
            record={modalCommand(
              "rebind.review",
              "Review Rebind",
              "Preview identity proof",
              validPath(),
              false,
              "Select a replacement Source and enter a valid Skill path",
            )}
            execute={() => props.onSelect(owner()!, ownerPath().trim())}
          />
          <ModalCommand
            id="rebind-cancel"
            order={40}
            controls={controls}
            record={modalCommand("rebind.cancel", "Cancel", "Return to Details")}
            execute={props.onClose}
          />
        </box>
        {!validPath() && <text>Enter a valid replacement Source-root-relative Skill path.</text>}
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
  useModalControlTraversal(controls, props.onClose);
  return (
    <ModalShell>
      <ModalBody>
        <text>Add to collection</text>
        <DataList
          id="collection-handoff-choice"
          focused={true}
          showDescription
          ref={registerChoice}
          options={props.choices.map((choice, index) => ({
            name: `${choice.collection}${choice.owner ? ` (${ownerLine(choice.owner)})` : choice.level ? ` (${choice.level})` : ""}`,
            description: choice.level
              ? `Add to its ${choice.level} declaration`
              : "Create a direct contribution before adding",
            value: `${index}`,
          }))}
          onSelect={(_index, option) =>
            option && props.onSelect(props.choices[Number(option.value)]!)
          }
        />
        <ModalCommand
          id="collection-handoff-create"
          controls={controls}
          record={modalCommand(
            "collection-handoff.create",
            "New Collection…",
            "Create and continue",
            !!props.onCreate,
          )}
          execute={() => props.onCreate?.()}
        />
        <ModalCommand
          id="collection-handoff-cancel"
          controls={controls}
          record={modalCommand("collection-handoff.cancel", "Cancel", "Return to Details")}
          execute={props.onClose}
        />
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
            <text>{`Add Skills to ${props.collection}`}</text>
            <text height={1} wrapMode="none">{`Save to ${ownerLine(props.owner)}`}</text>
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
          height={Math.max(1, Math.min(matches().length * 2, Math.floor(terminal().height / 3)))}
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
        <text>{`${selected().length} selected · Space check · Tab switch controls`}</text>
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
