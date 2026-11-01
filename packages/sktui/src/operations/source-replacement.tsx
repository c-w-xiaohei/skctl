import { For, Show } from "solid-js";
import type { SkillAddress } from "@skctl/core";
import {
  createModalControlRegistry,
  useModalControl,
  useModalControlTraversal,
} from "../modal-controls";
import { DataList } from "../ui/data-list";
import { Input } from "../ui/input";
import { ModalBody, ModalCommand, modalCommand, ModalShell } from "./modal";

export function SourceReplacementOverlay(props: {
  readonly oldSource: string;
  readonly newSource?: string;
  readonly addresses: readonly SkillAddress[];
  readonly receipt: readonly string[];
  readonly registered?: boolean;
  readonly uncertain?: string;
  readonly pending: boolean;
  readonly selectedAddress?: SkillAddress;
  readonly targetPath?: string;
  readonly onDraft: (address: SkillAddress | undefined, path: string) => void;
  readonly onPreview: (address: SkillAddress, ownerPath: string) => void;
  readonly onInspect: () => void;
  readonly onAcquire: () => void;
  readonly onRemove: () => void;
  readonly onClose: () => void;
}) {
  const controls = createModalControlRegistry();
  useModalControlTraversal(controls, props.onClose);
  return (
    <ModalShell>
      <ModalBody
        controls={controls}
        header={<text>{`Replace Source: ${props.oldSource} → ${props.newSource ?? "?"}`}</text>}
        footer={
          <box flexDirection="row" flexWrap="wrap" gap={1}>
            <ModalCommand
              id="replacement-close"
              controls={controls}
              order={90}
              record={modalCommand("replacement.close", "Close", "Keep progress", !props.pending)}
              execute={props.onClose}
            />
            <ModalCommand
              id="replacement-inspect"
              controls={controls}
              order={80}
              record={modalCommand(
                "replacement.inspect",
                "Inspect / refresh",
                "Recheck workspace",
                !props.pending,
              )}
              execute={props.onInspect}
            />
          </box>
        }
      >
        <text wrapMode="word">
          Old Source and installed Skills remain until explicitly removed. Registration and
          completed changes are not rolled back.
        </text>
        <For each={props.receipt}>{(line) => <text wrapMode="word">{line}</text>}</For>
        <Show when={props.uncertain}>
          <text wrapMode="word">{props.uncertain}</text>
        </Show>
        <text>Remaining old installed Skills</text>
        <DataList
          id="replacement-skills"
          ref={useModalControl("replacement-skills", controls, 10)}
          height={Math.max(1, Math.min(4, props.addresses.length))}
          options={props.addresses.map((address) => ({
            name: `${address.source}/${address.path}`,
            description: "Select exact installed Skill",
            value: address,
          }))}
          showDescription={false}
          onChange={(_index, option) => {
            if (option) props.onDraft(option.value, option.value.path);
          }}
          onSelect={(_index, option) => {
            if (
              option &&
              (option.value.source !== props.selectedAddress?.source ||
                option.value.path !== props.selectedAddress?.path)
            )
              props.onDraft(option.value, option.value.path);
          }}
        />
        <text>Replacement Source-relative path</text>
        <Input
          id="replacement-path"
          ref={useModalControl("replacement-path", controls, 20)}
          value={props.targetPath ?? ""}
          onInput={(path) => props.onDraft(props.selectedAddress, path)}
        />
        <ModalCommand
          id="replacement-preview"
          controls={controls}
          order={30}
          record={modalCommand(
            "replacement.preview",
            "Preview rebind",
            "Prove same identity",
            !!props.selectedAddress &&
              !!props.targetPath?.trim() &&
              !!props.registered &&
              !props.uncertain &&
              !props.pending,
          )}
          execute={() => props.onPreview(props.selectedAddress!, props.targetPath!.trim())}
        />
        <ModalCommand
          id="replacement-acquire"
          controls={controls}
          order={40}
          record={modalCommand(
            "replacement.acquire",
            "Find and install separately…",
            "Different or unprovable identity",
            !!props.registered && !props.uncertain && !props.pending,
          )}
          execute={props.onAcquire}
        />
        <ModalCommand
          id="replacement-remove"
          controls={controls}
          order={50}
          record={modalCommand(
            "replacement.remove",
            "Review old Source removal…",
            props.oldSource,
            !props.uncertain && !props.pending,
          )}
          execute={props.onRemove}
        />
      </ModalBody>
    </ModalShell>
  );
}
