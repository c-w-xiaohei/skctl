import type { ConfigDeclarationOwner } from "@skctl/core";
import { createSignal } from "solid-js";
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
  readonly skills: readonly {
    readonly address: { readonly source: string; readonly path: string };
    readonly name: string;
    readonly description: string;
  }[];
  readonly onSelect: (
    address: { readonly source: string; readonly path: string },
    name: string,
  ) => void;
  readonly onClose: () => void;
}) {
  const controls = createModalControlRegistry();
  const registerChoice = useModalControl("installed-skill-choice", controls);
  useModalControlTraversal(controls, props.onClose);
  return (
    <ModalShell>
      <ModalBody>
        <text>Select Installed Skill</text>
        <DataList
          id="installed-skill-choice"
          focused={true}
          height={Math.max(1, Math.min(props.skills.length * 2, 6))}
          ref={registerChoice}
          options={props.skills.map((skill, index) => ({
            name: `${skill.name}  ${skill.address.source}/${skill.address.path}`,
            description: skill.description,
            value: `${index}`,
          }))}
          showDescription
          onSelect={(_index, option) => {
            if (!option) return;
            const skill = props.skills[Number(option.value)];
            if (skill) props.onSelect(skill.address, skill.name);
          }}
        />
        <ModalCommand
          id="installed-skill-choice-cancel"
          controls={controls}
          record={modalCommand("installed-skill-choice.cancel", "Cancel", "Return to Collection")}
          execute={props.onClose}
        />
      </ModalBody>
    </ModalShell>
  );
}
