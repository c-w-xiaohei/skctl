/** @jsxImportSource @opentui/solid */
import { For } from "solid-js";
import { useTheme } from "./use-theme";
export interface MetadataField {
  readonly label: string;
  readonly value: string;
  readonly wrap: "none" | "word";
}

export interface MetadataGridProps {
  readonly fields: readonly MetadataField[];
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
            <text
              flexGrow={1}
              minWidth={0}
              wrapMode={field.wrap === "none" ? "none" : "word"}
              fg={tokens().colors.foreground}
            >
              {field.value}
            </text>
          </box>
        )}
      </For>
    </box>
  );
}
