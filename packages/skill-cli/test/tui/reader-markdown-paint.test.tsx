import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore } from "./direct-source.fixture";
import {
  readerContent,
  readerProjection,
  readerSecondAddress,
  readerSecondContent,
} from "./installed-reader.fixture";

test("RENDER Reader mounts a paintable content surface", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async (request) => ({
            value:
              request.address.path === readerSecondAddress.path
                ? readerSecondContent
                : readerContent,
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-scrollbox"));
    expect(setup.renderer.root.findDescendantById("reader-scrollbox")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
