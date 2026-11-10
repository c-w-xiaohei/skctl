import { createSignal, For, Show } from "solid-js";
import { useRenderer } from "@opentui/solid";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { ExecutableCommand } from "./commands";
import { Button } from "./ui/button";
import { useTheme } from "./ui/use-theme";

/** Menu geometry and keyboard traversal; the caller owns closing and execution. */
export function CommandMenuBody(props: {
  id: string;
  items: readonly (ExecutableCommand & { id: string })[];
  onExecute: (command: ExecutableCommand) => void;
}) {
  const renderer = useRenderer();
  const theme = useTheme();
  const [width, setWidth] = createSignal(25);
  let body: ScrollBoxRenderable | undefined;
  const enabled = () => props.items.filter((item) => item.record.enabled);
  return (
    <scrollbox
      id={props.id}
      minHeight={0}
      flexShrink={1}
      scrollX={false}
      scrollY
      ref={(target: ScrollBoxRenderable) => {
        body = target;
      }}
    >
      <For each={props.items}>
        {(item) => (
          <box
            flexShrink={0}
            marginTop={item.record.danger ? 1 : 0}
            onSizeChange={() => setWidth(body?.viewport.width ?? 25)}
          >
            <Button
              id={item.id}
              intent="menu"
              label={item.record.verb}
              wrapLabel
              width="100%"
              flexShrink={0}
              disabled={!item.record.enabled}
              onPress={() => {
                if (item.record.enabled) props.onExecute(item);
              }}
              onKeyDown={(event) => {
                if (!["up", "down"].includes(event.name)) return;
                const items = enabled();
                const current = items.findIndex(
                  (entry) => entry.id === renderer.currentFocusedRenderable?.id,
                );
                const next =
                  items[(current + (event.name === "down" ? 1 : items.length - 1)) % items.length];
                if (next) {
                  renderer.root.findDescendantById(next.id)?.focus();
                  body?.scrollChildIntoView(next.id);
                }
                event.preventDefault();
                event.stopPropagation();
              }}
              ref={(target) => {
                if (enabled()[0]?.id === item.id)
                  queueMicrotask(() => {
                    if (!target.isDestroyed) target.focus();
                  });
              }}
            />
            <Show when={!item.record.enabled && item.record.disabledReason}>
              <text
                width={width()}
                flexShrink={0}
                wrapMode="word"
                fg={theme().colors.mutedForeground}
                content={item.record.disabledReason}
              />
            </Show>
          </box>
        )}
      </For>
    </scrollbox>
  );
}
