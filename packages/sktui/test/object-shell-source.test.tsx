/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { enterLive, focusLive } from "./reader-test-controls";

test("entering a Source with installed Skills opens its workspace and acquisition action", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    await openMainPage(setup, "sources");
    await focusLive(setup, "source-browser");
    await enterLive(setup, "source-browser");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-details-pane"));
    expect(setup.renderer.root.findDescendantById("workspace-action-add-skills")).toBeTruthy();
    expect(setup.renderer.root.findDescendantById("source-installed-skills")).toBeTruthy();
  } finally {
    setup.renderer.destroy();
  }
});
