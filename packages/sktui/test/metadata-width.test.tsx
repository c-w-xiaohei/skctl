import { expect, test } from "bun:test";
import { TextBufferRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { MetadataGrid } from "../src/ui/metadata-grid";

test("metadata values wrap within their row without clipping address characters", async () => {
  const address = "production-shared-skills-source-id/domains/authoring/long-form-guides";
  const setup = await testRender(
    () => (
      <scrollbox id="bounds" width="100%" height={5}>
        <MetadataGrid fields={[{ label: "Address", value: address, wrap: "word" }]} />
        <text>{"overflow\n".repeat(12)}</text>
      </scrollbox>
    ),
    { width: 74, height: 12 },
  );
  try {
    await setup.flush();
    setup.resize(73, 12);
    await setup.flush();
    const bounds = setup.renderer.root.findDescendantById("bounds")!;
    const row = bounds.getChildren()[0]!.getChildren()[0]!;
    const value = row.getChildren()[1]!.getChildren()[0] as TextBufferRenderable;
    expect(value.screenX + value.width).toBeLessThanOrEqual(row.screenX + row.width);
    const painted = setup
      .captureCharFrame()
      .split("\n")
      .slice(value.screenY, value.screenY + value.height)
      .map((line) => line.slice(value.screenX, value.screenX + value.width))
      .join("")
      .replace(/\s/g, "");
    expect(painted).toBe(address);
  } finally {
    setup.renderer.destroy();
  }
});
