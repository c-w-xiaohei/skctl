import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { terminal, theme } from "../src/ui/theme";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";

test("RENDER App follows the renderer theme and loads the initial Workspace once", async () => {
  let loads = 0;
  theme.register("theme-integration", {
    light: { colors: { foreground: "#f5f5f5" } },
    dark: { colors: { foreground: "#151515" } },
  });
  theme.setActive("theme-integration");
  theme.setMode("system");
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          workspace: {
            get: async () => {
              loads += 1;
              return { value: workspaceProjection(), diagnostics: [] };
            },
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Skills"));
    expect(loads).toBe(1);

    setup.renderer.emit("theme_mode", "light");
    expect(theme.get().colors.foreground).toBe("#f5f5f5");

    setup.renderer.destroy();
    expect(theme.get().colors.foreground).toBe("#151515");
    setup.renderer.emit("theme_mode", "light");
    expect(theme.get().colors.foreground).toBe("#151515");
    theme.setActive("terminal");
    expect(theme.get().colors.foreground).toBe(terminal.colors.foreground);
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy();
    theme.setActive("terminal");
    theme.setMode("system");
  }
});
