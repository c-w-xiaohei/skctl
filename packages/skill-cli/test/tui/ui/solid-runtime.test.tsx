/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createContext, useContext } from "solid-js";
import { Tabs, TabsList, TabsTrigger } from "../../../src/tui/ui/tabs";

test("W1 runtime uses one Solid context for OpenTUI and TUIparts", async () => {
  const Context = createContext<string>();
  let observed: string | undefined;
  const setup = await testRender(
    () => (
      <Context.Provider value="shared">
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger id="tab-one" value="one" label="One" />
          </TabsList>
        </Tabs>
        {(() => {
          observed = useContext(Context);
          return null;
        })()}
      </Context.Provider>
    ),
    { width: 20, height: 2 },
  );
  try {
    expect(observed).toBe("shared");
    expect(setup.renderer.root.findDescendantById("tab-one")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
