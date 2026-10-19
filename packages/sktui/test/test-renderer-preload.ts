import { afterEach, mock } from "bun:test";
import * as solid from "@opentui/solid";
import { destroyTrackedRenderers, trackTestRenderer } from "./test-renderer-lifecycle";

const originalTestRender = solid.testRender;

mock.module("@opentui/solid", () => ({
  ...solid,
  testRender: async (...args: Parameters<typeof solid.testRender>) =>
    trackTestRenderer(await originalTestRender(...args)),
}));

afterEach(destroyTrackedRenderers);
