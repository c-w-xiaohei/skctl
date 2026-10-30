/** @jsxImportSource @opentui/solid */
import { For, createSignal } from "solid-js";
import type { BoxRenderable } from "@opentui/core";
import { useTheme } from "./use-theme";
export interface MetadataField {
  readonly label: string;
  readonly value: string;
  readonly wrap: "none" | "word";
}

export interface MetadataGridProps {
  readonly fields: readonly MetadataField[];
}

function MetadataValue(props: { readonly field: MetadataField }) {
  const tokens = useTheme();
  const [width, setWidth] = createSignal(0);
  let box: BoxRenderable;
  // Native text measurement can retain the previous width after a ScrollBox
  // shrinks. Size the text from its allocated column, not its intrinsic content.
  return (
    <box
      flexGrow={1}
      flexBasis={0}
      minWidth={0}
      ref={(value) => {
        box = value;
        setWidth(value.width);
      }}
      onSizeChange={() => setWidth(box.width)}
    >
      <text width={width()} wrapMode={props.field.wrap} fg={tokens().colors.foreground}>
        {props.field.value}
      </text>
    </box>
  );
}

export function MetadataGrid(props: MetadataGridProps) {
  const tokens = useTheme();
  return (
    <box flexDirection="column">
      <For each={props.fields}>
        {(field) => (
          <box flexDirection="row" gap={1}>
            <text width={14} flexShrink={0} wrapMode="word" fg={tokens().colors.mutedForeground}>
              {field.label}
            </text>
            <MetadataValue field={field} />
          </box>
        )}
      </For>
    </box>
  );
}
