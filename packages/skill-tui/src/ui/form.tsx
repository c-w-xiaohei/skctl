/** @jsxImportSource @opentui/solid */
import type { BoxProps, JSX } from "@opentui/solid";
import { children, createMemo, Show, splitProps } from "solid-js";
import { useTheme } from "./use-theme";

type LayoutProps = Pick<
  BoxProps,
  | "id"
  | "width"
  | "height"
  | "minWidth"
  | "minHeight"
  | "maxWidth"
  | "maxHeight"
  | "flexGrow"
  | "flexShrink"
  | "alignSelf"
>;

export interface FormProps extends LayoutProps {
  readonly header?: JSX.Element;
  readonly children: JSX.Element;
  readonly error?: string;
  readonly actions?: JSX.Element;
}

export interface FormFieldProps extends LayoutProps {
  readonly label?: string;
  readonly labelPosition?: "above" | "beside";
  /** Label column width in terminal cells when beside the controls; defaults to 16. */
  readonly labelWidth?: number;
  readonly help?: string;
  readonly error?: string;
  /**
   * Presentation only. Consumers own native disablement/activation; this does
   * not cascade to children, including DataList.
   */
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly children: JSX.Element;
}

/** Groups terminal controls without owning values, validation, scrolling or focus. */
export function Form(props: FormProps) {
  const [slots, layout] = splitProps(props, ["header", "children", "error", "actions"]);
  const header = children(() => slots.header);
  const body = children(() => slots.children);
  const actions = children(() => slots.actions);
  const tokens = useTheme();
  return (
    <box minWidth={0} minHeight={0} {...layout} flexDirection="column">
      <Show when={header()}>
        <box flexShrink={0} minWidth={0} flexDirection="column">
          {header()}
        </box>
      </Show>
      <box flexGrow={1} minWidth={0} minHeight={0} flexDirection="column">
        {body()}
      </box>
      <Show when={slots.error}>
        <text flexShrink={0} wrapMode="word" fg={tokens().colors.destructive}>
          {`Error: ${slots.error}`}
        </text>
      </Show>
      <Show when={actions()}>
        <box flexShrink={0} minWidth={0} flexDirection="column">
          {actions()}
        </box>
      </Show>
    </box>
  );
}

/** A nonfocusable label and message beside an unchanged tree of real controls. */
export function FormField(props: FormFieldProps) {
  const [field, layout] = splitProps(props, [
    "label",
    "labelPosition",
    "labelWidth",
    "help",
    "error",
    "disabled",
    "disabledReason",
    "children",
  ]);
  const controls = children(() => field.children);
  const tokens = useTheme();
  const beside = () => field.labelPosition === "beside" && !!field.label;
  const message = createMemo(() => {
    if (field.error)
      return { content: `Error: ${field.error}`, color: tokens().colors.destructive };
    if (field.disabled && field.disabledReason)
      return {
        content: `Unavailable: ${field.disabledReason}`,
        color: tokens().colors.disabledForeground,
      };
    if (field.help) return { content: field.help, color: tokens().colors.mutedForeground };
    return undefined;
  });
  return (
    <box
      minWidth={0}
      minHeight={0}
      flexShrink={0}
      {...layout}
      flexDirection={beside() ? "row" : "column"}
    >
      <Show when={field.label}>
        <text
          width={beside() ? Math.max(1, field.labelWidth ?? 16) : "100%"}
          marginRight={beside() ? 1 : 0}
          flexShrink={0}
          wrapMode="word"
          fg={field.disabled ? tokens().colors.disabledForeground : tokens().colors.foreground}
        >
          {field.label}
        </text>
      </Show>
      <box flexGrow={1} minWidth={0} minHeight={0} flexDirection="column">
        <box flexGrow={1} minWidth={0} minHeight={0} flexDirection="column">
          {controls()}
        </box>
        <Show when={message()}>
          <text flexShrink={0} wrapMode="word" fg={message()?.color}>
            {message()?.content}
          </text>
        </Show>
      </box>
    </box>
  );
}
