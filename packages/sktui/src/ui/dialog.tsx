/** @jsxImportSource @opentui/solid */
// Source: https://tuiparts.sh/r/solid/dialog.json, @tuiparts/solid@0.0.5 (MIT).
import { Dialog as DialogPrimitive } from "@tuiparts/solid/dialog";
import type { DialogPopupRenderable } from "@tuiparts/core/dialog";
import type { Renderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { useTerminalSize } from "./terminal-size";
import { children, createSignal, onCleanup, splitProps } from "solid-js";
import { tint } from "./theme";
import { useTheme } from "./use-theme";
export interface DialogProps extends DialogPrimitive.Root.Props {}
export interface DialogContentProps extends DialogPrimitive.Popup.Props {
  backdropColor?: DialogPrimitive.Backdrop.Props["backgroundColor"];
  /** Optional trigger-relative placement; other dialogs retain centered layout. */
  anchor?: () => Renderable | undefined;
}
export function Dialog(props: DialogProps) {
  // The primitive destroys its own root on cleanup. Let Solid reconcile this
  // host, rather than attempt to remove that already-detached native root.
  return (
    <box flexShrink={0}>
      <DialogPrimitive.Root {...props} />
    </box>
  );
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
  const [recipe, popup] = splitProps(props, ["backdropColor", "children", "anchor", "ref"]);
  // The primitive spreads reactive geometry together with children. Resolve
  // the child tree once so resizing does not recreate controls or their drafts.
  const content = children(() => recipe.children);
  const tokens = useTheme();
  const terminal = useTerminalSize();
  const renderer = useRenderer();
  let target: DialogPopupRenderable | undefined;
  const [position, setPosition] = createSignal(
    { left: 0, top: 0 },
    {
      equals: (left, right) => left.left === right.left && left.top === right.top,
    },
  );
  const place = () => {
    const anchor = recipe.anchor?.();
    if (!anchor || anchor.isDestroyed || !target || target.isDestroyed) return;
    const below = anchor.screenY + anchor.height;
    setPosition({
      left: Math.max(0, Math.min(anchor.screenX, renderer.width - target.width)),
      top: Math.max(
        0,
        Math.min(
          below + target.height <= renderer.height ? below : anchor.screenY - target.height,
          renderer.height - target.height,
        ),
      ),
    });
  };
  if (recipe.anchor) {
    renderer.on("frame", place);
    onCleanup(() => renderer.off("frame", place));
  }
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
          position={recipe.anchor ? "absolute" : popup.position}
          left={recipe.anchor ? position().left : popup.left}
          top={recipe.anchor ? position().top : popup.top}
          ref={(value) => {
            target = value;
            if (typeof recipe.ref === "function") recipe.ref(value);
          }}
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
