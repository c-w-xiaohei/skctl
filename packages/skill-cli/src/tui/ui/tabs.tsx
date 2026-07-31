/** @jsxImportSource @opentui/solid */
// Source: https://tuiparts.sh/r/solid/tabs.json, @tuiparts/solid@0.0.5 (MIT).
import { Tabs as TabsPrimitive } from "@tuiparts/solid/tabs";
import { splitProps } from "solid-js";
import { useTheme } from "./use-theme";
export type TabsProps = TabsPrimitive.Root.Props;
export type TabsListProps = TabsPrimitive.List.Props;
export interface TabsTriggerProps extends Omit<TabsPrimitive.Tab.Props, "children"> {
  label: string;
}
export type TabsContentProps = TabsPrimitive.Panel.Props;
export function Tabs(props: TabsProps) {
  const [recipe, root] = splitProps(props, ["orientation", "flexDirection", "gap", "children"]);
  const orientation = () => recipe.orientation ?? "horizontal";
  return (
    <TabsPrimitive.Root
      flexDirection={recipe.flexDirection ?? (orientation() === "vertical" ? "row" : "column")}
      gap={recipe.gap ?? 1}
      orientation={orientation()}
      {...root}
    >
      {recipe.children}
    </TabsPrimitive.Root>
  );
}
export function TabsList(props: TabsListProps) {
  const state = TabsPrimitive.useRootState();
  const [recipe, list] = splitProps(props, ["flexDirection", "gap"]);
  return (
    <TabsPrimitive.List
      flexDirection={recipe.flexDirection ?? (state.orientation === "vertical" ? "column" : "row")}
      gap={recipe.gap ?? 1}
      {...list}
    />
  );
}
export function TabsTrigger(props: TabsTriggerProps) {
  const [recipe, tab] = splitProps(props, ["label"]);
  const tokens = useTheme();
  return (
    <TabsPrimitive.Tab {...tab}>
      {(state: TabsPrimitive.Tab.State) => (
        <box
          backgroundColor={
            state.selected
              ? tokens().colors.primary
              : state.focused
                ? tokens().colors.surface
                : "transparent"
          }
          paddingX={tokens().density.paddingX}
        >
          <text
            content={recipe.label}
            selectable={false}
            fg={
              state.disabled
                ? tokens().colors.disabledForeground
                : state.selected
                  ? tokens().colors.primaryForeground
                  : tokens().colors.foreground
            }
          />
        </box>
      )}
    </TabsPrimitive.Tab>
  );
}
export function TabsContent(props: TabsContentProps) {
  return <TabsPrimitive.Panel {...props} />;
}
