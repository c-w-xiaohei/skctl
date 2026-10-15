/** @jsxImportSource @opentui/solid */
// Source: https://tuiparts.sh/r/solid/dialog.json, @tuiparts/solid@0.0.5 (MIT).
import { Dialog as DialogPrimitive } from "@tuiparts/solid/dialog";
import { useTerminalDimensions } from "@opentui/solid";
import { children, splitProps } from "solid-js";
import { tint } from "./theme";
import { useTheme } from "./use-theme";
export interface DialogProps extends DialogPrimitive.Root.Props {}
export interface DialogContentProps extends DialogPrimitive.Popup.Props {
  backdropColor?: DialogPrimitive.Backdrop.Props["backgroundColor"];
}
export function Dialog(props: DialogProps) {
  return <DialogPrimitive.Root {...props} />;
}
export function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  const tokens = useTheme();
  return (
    <DialogPrimitive.Trigger
      backgroundColor={tokens().colors.surface}
      paddingLeft={tokens().density.paddingX}
      paddingRight={tokens().density.paddingX}
      {...props}
    />
  );
}
export function DialogContent(props: DialogContentProps) {
  const [recipe, popup] = splitProps(props, ["backdropColor", "children"]);
  // The primitive spreads reactive geometry together with children. Resolve
  // the child tree once so resizing does not recreate controls or their drafts.
  const content = children(() => recipe.children);
  const tokens = useTheme();
  const terminal = useTerminalDimensions();
  return (
    <DialogPrimitive.Portal
      position="absolute"
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
    >
      {/* OpenTUI Portal hosts children in an auto-sized layout box. Give the
          overlay an explicit viewport so its backdrop covers outside the popup. */}
      <box
        width={terminal().width}
        height={terminal().height}
        alignItems="center"
        justifyContent="center"
      >
        <DialogPrimitive.Backdrop
          position="absolute"
          width="100%"
          height="100%"
          backgroundColor={
            recipe.backdropColor ??
            tint(tokens().colors.background, tokens().colors.foreground, 0.25)
          }
        />
        <DialogPrimitive.Popup
          width="80%"
          maxWidth={56}
          flexDirection="column"
          backgroundColor={tokens().colors.surface}
          border
          borderColor={tokens().colors.border}
          borderStyle={tokens().borders.style}
          paddingLeft={tokens().density.paddingX}
          paddingRight={tokens().density.paddingX}
          {...popup}
        >
          {content()}
        </DialogPrimitive.Popup>
      </box>
    </DialogPrimitive.Portal>
  );
}
export function DialogTitle(props: DialogPrimitive.Title.Props) {
  const tokens = useTheme();
  return <DialogPrimitive.Title fg={tokens().colors.foreground} {...props} />;
}
export function DialogDescription(props: DialogPrimitive.Description.Props) {
  const tokens = useTheme();
  return <DialogPrimitive.Description fg={tokens().colors.mutedForeground} {...props} />;
}
export function DialogClose(props: DialogPrimitive.Close.Props) {
  const tokens = useTheme();
  return (
    <DialogPrimitive.Close
      backgroundColor={tokens().colors.surface}
      paddingLeft={tokens().density.paddingX}
      paddingRight={tokens().density.paddingX}
      {...props}
    />
  );
}
