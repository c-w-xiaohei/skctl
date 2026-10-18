import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { TextRenderable } from "@opentui/core";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerAddress, readerContent, readerProjection } from "./installed-reader.fixture";
import {
  enterInstalledAddress,
  live,
  openAllInstalledSkills,
  waitForReaderBody,
} from "./reader-test-controls";

test("RENDER Reader mounts a paintable content surface", async () => {
  const reads: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          installed: {
            load: async (request) => {
              reads.push(request);
              return readerContent;
            },
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterInstalledAddress(setup, readerAddress);
    await waitForReaderBody(setup, "const needle = true;");
    expect(reads).toEqual([{ address: readerAddress }]);
    expect((live(setup, "reader-identity") as TextRenderable).plainText).toBe("guide");
    const frame = setup.captureCharFrame();
    for (const text of ["Guide", "needle in prose", "first", "second", "const needle = true;"])
      expect(frame).toContain(text);
  } finally {
    setup.renderer.destroy();
  }
});
