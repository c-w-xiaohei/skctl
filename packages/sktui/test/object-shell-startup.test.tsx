/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";

test("installed Skills open by default with stable workspace destinations", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 24 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    for (const page of ["skills", "collections", "sources", "updates", "agent", "settings"]) {
      expect(setup.renderer.root.findDescendantById(`shell-section-tab-${page}`)).toBeTruthy();
    }
  } finally {
    setup.renderer.destroy();
  }
});
