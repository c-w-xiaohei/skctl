/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, For, onCleanup } from "solid-js";
import type { TabsTabRenderable } from "@tuiparts/core/tabs";
import { useRenderer } from "@opentui/solid";
import type { FocusRegistry, FocusTarget } from "../focus";
import type { FocusOwner } from "../types";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

export interface SectionTabOption<Value extends string> {
  readonly label: string;
  readonly value: Value;
}

export function SectionTabs<Value extends string>(props: {
  readonly id: string;
  readonly options: readonly SectionTabOption<Value>[];
  readonly value: Value;
  readonly owner: FocusOwner;
  readonly focusRegistry?: FocusRegistry;
  readonly compact?: boolean;
  readonly onPrimaryPointerEntry?: () => void;
  readonly onNavigate: (value: Value) => void;
}) {
  const renderer = useRenderer();
  const triggers = new Map<Value, TabsTabRenderable>();
  const triggerSubscriptions = new Map<TabsTabRenderable, () => void>();
  const [triggerVersion, setTriggerVersion] = createSignal(0);
  let registered: FocusTarget | undefined;
  let dispose: (() => void) | undefined;
  const bindFocus = () => {
    triggerVersion();
    const target =
      [...triggers.values()].find((trigger) => renderer.currentFocusedRenderable === trigger) ??
      triggers.get(props.value);
    if (target === registered) return;
    dispose?.();
    dispose = undefined;
    registered = target;
    if (target) dispose = props.focusRegistry?.register(props.owner, target);
  };
  createEffect(bindFocus);
  onCleanup(() => {
    dispose?.();
    dispose = undefined;
    registered = undefined;
    for (const unsubscribe of triggerSubscriptions.values()) unsubscribe();
    triggerSubscriptions.clear();
  });
  return (
    <box flexDirection="row" height={1}>
      <Tabs
        value={props.value}
        activationMode="automatic"
        onValueChange={(value) => {
          if (value !== props.value) {
            const next = value as Value;
            props.onNavigate(next);
          }
        }}
      >
        <TabsList>
          <For each={props.options.map((option) => option.value)}>
            {(value) => {
              const option = () => props.options.find((option) => option.value === value)!;
              let assigned: TabsTabRenderable | undefined;
              return (
                <TabsTrigger
                  id={`${props.id}-tab-${value}`}
                  ref={(target: TabsTabRenderable | undefined) => {
                    if (target && target !== assigned) {
                      if (assigned && triggers.get(value) === assigned) {
                        triggers.delete(value);
                        triggerSubscriptions.get(assigned)?.();
                        triggerSubscriptions.delete(assigned);
                      }
                      assigned = target;
                      triggers.set(value, target);
                      triggerSubscriptions.set(
                        target,
                        target.subscribe(() => {
                          bindFocus();
                          setTriggerVersion((version) => version + 1);
                        }),
                      );
                    } else if (assigned && triggers.get(value) === assigned) {
                      triggers.delete(value);
                      triggerSubscriptions.get(assigned)?.();
                      triggerSubscriptions.delete(assigned);
                      assigned = undefined;
                    }
                    setTriggerVersion((version) => version + 1);
                  }}
                  value={value}
                  label={option().label}
                  onKeyDown={(event) => {
                    if (
                      ["left", "right", "home", "end"].includes(event.name) &&
                      !event.shift &&
                      !event.ctrl &&
                      !event.meta &&
                      !event.option &&
                      !event.super &&
                      !event.hyper
                    ) {
                      for (const trigger of triggers.values()) {
                        if (trigger.getState().focused) trigger.blur();
                      }
                    }
                  }}
                  onMouseDown={(event) => {
                    if (event.button !== 0) return;
                    props.onPrimaryPointerEntry?.();
                    if (assigned?.getState().focused) return;
                    for (const trigger of triggers.values()) {
                      if (trigger !== assigned && trigger.getState().focused) trigger.blur();
                    }
                  }}
                />
              );
            }}
          </For>
        </TabsList>
      </Tabs>
      {!props.compact && <text> ←/→</text>}
    </box>
  );
}
