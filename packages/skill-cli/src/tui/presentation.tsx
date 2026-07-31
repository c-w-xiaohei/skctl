import type { SelectRenderable } from "@opentui/core";

export function EmptyState(props: {
  readonly title: string;
  readonly lines: readonly string[];
  readonly action?: {
    readonly id?: string;
    readonly name: string;
    readonly description: string;
    readonly registerRef?: (value: SelectRenderable | undefined) => void;
    readonly onSelect: () => void;
  };
  readonly hint?: string;
}) {
  return (
    <box flexDirection="column" paddingTop={1}>
      <text>{props.title}</text>
      {props.lines.map((line) => (
        <text>{line}</text>
      ))}
      {props.action && (
        <select
          {...(props.action.id ? { id: props.action.id } : {})}
          ref={(value: SelectRenderable | undefined) => props.action!.registerRef?.(value)}
          height={1}
          options={[
            { name: props.action.name, description: props.action.description, value: "action" },
          ]}
          showDescription={false}
          onMouseDown={() => props.action!.onSelect()}
          onSelect={() => props.action!.onSelect()}
        />
      )}
      {props.hint && <text>{props.hint}</text>}
    </box>
  );
}
