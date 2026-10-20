import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import type { Renderable } from "@opentui/core";
import { createSignal, onCleanup } from "solid-js";
import { ModalCommand } from "./operations";
import { useModalControl, useModalControlTraversal } from "./modal-controls";
import { useTheme } from "./ui/use-theme";
import { keyboardGuidance } from "./keyboard-guidance";
import type { CommandRecord } from "./types";

/** Optional technical history. It never replaces task-facing update feedback. */
export function DiagnosticLog(props: {
  readonly title?: string;
  readonly text: string;
  readonly onClose: () => void;
}) {
  const terminal = useTerminalDimensions();
  const renderer = useRenderer();
  const tokens = useTheme();
  const register = useModalControl("diagnostic-log-content");
  useModalControlTraversal(undefined, props.onClose);
  const closeCommand: CommandRecord = {
    id: "diagnostics.close",
    verb: "Close",
    keys: ["enter"],
    destination: "Return to your work",
    scope: "modal",
    enabled: true,
    danger: false,
  };
  const [reading, setReading] = createSignal(true);
  const trackFocus = (target: Renderable | null) =>
    setReading(target?.id === "diagnostic-log-content");
  renderer.on("focused_renderable", trackFocus);
  onCleanup(() => renderer.off("focused_renderable", trackFocus));
  const guidance = () =>
    keyboardGuidance({
      mode: reading() ? "scroll" : "command",
      width: Math.max(1, terminal().width - 6),
      command: reading() ? undefined : closeCommand,
      modal: true,
    });
  return (
    <box
      id="diagnostic-log"
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      backgroundColor={tokens().colors.background}
    >
      <box
        border
        borderColor={tokens().colors.border}
        margin={1}
        paddingX={1}
        height={Math.max(1, terminal().height - 2)}
        flexDirection="column"
        flexGrow={1}
        minHeight={0}
      >
        <text height={1} flexShrink={0} fg={tokens().colors.foreground}>
          <strong>{props.title ?? "Diagnostic logs"}</strong>
        </text>
        <scrollbox
          id="diagnostic-log-content"
          ref={register}
          focused
          flexGrow={1}
          minHeight={1}
          scrollX={false}
        >
          <text selectable wrapMode="word" fg={tokens().colors.mutedForeground}>
            {props.text || "No diagnostic logs captured in this session."}
          </text>
        </scrollbox>
        <ModalCommand id="diagnostic-log-close" record={closeCommand} execute={props.onClose} />
        <text height={1} flexShrink={0} wrapMode="none" fg={tokens().colors.mutedForeground}>
          {[guidance().local, guidance().global].filter(Boolean).join("   ")}
        </text>
      </box>
    </box>
  );
}
