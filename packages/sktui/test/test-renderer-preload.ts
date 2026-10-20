import { afterAll, afterEach, mock } from "bun:test";
import * as solid from "@opentui/solid";
import { destroyTrackedRenderers, trackTestRenderer } from "./test-renderer-lifecycle";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Tests never write the user's automatic-check schedule.
const scheduleDirectory = await mkdtemp(join(tmpdir(), "sktui-schedule-suite-"));
process.env.SKTUI_UPDATE_SCHEDULE_DIR = scheduleDirectory;
afterAll(() => rm(scheduleDirectory, { recursive: true, force: true }));

const originalTestRender = solid.testRender;

mock.module("@opentui/solid", () => ({
  ...solid,
  testRender: async (...args: Parameters<typeof solid.testRender>) =>
    trackTestRenderer(await originalTestRender(...args)),
}));

afterEach(destroyTrackedRenderers);
