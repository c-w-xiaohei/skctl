import type { JSXElement } from "solid-js";

export function EmptyState(props: {
  readonly title: string;
  readonly lines: readonly string[];
  readonly children?: JSXElement;
  readonly hint?: string;
}) {
  return (
    <box flexDirection="column" paddingTop={1}>
      <text>{props.title}</text>
      {props.lines.map((line) => (
        <text>{line}</text>
      ))}
      {props.children}
      {props.hint && <text>{props.hint}</text>}
    </box>
  );
}
