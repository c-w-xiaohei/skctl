import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { superviseTui } from "../src/tui-launcher";

test("supervision converts numeric signal numbers to shell exit status", async () => {
  const signals = new EventEmitter();
  expect(
    await superviseTui({ exited: Promise.resolve(0), signalCode: 35, kill: () => {} }, signals),
  ).toBe(163);
});

test("supervision preserves named signals, nonzero exits and normal zero exits", async () => {
  const signals = new EventEmitter();
  expect(
    await superviseTui(
      { exited: Promise.resolve(0), signalCode: "SIGTERM", kill: () => {} },
      signals,
    ),
  ).toBe(143);
  expect(
    await superviseTui({ exited: Promise.resolve(7), signalCode: 35, kill: () => {} }, signals),
  ).toBe(7);
  expect(
    await superviseTui({ exited: Promise.resolve(0), signalCode: null, kill: () => {} }, signals),
  ).toBe(0);
  expect(
    await superviseTui({ exited: Promise.resolve(0), signalCode: 0, kill: () => {} }, signals),
  ).toBe(0);
});

test("supervision cleans signal listeners and ignores captured late forwarding", async () => {
  const signals = new EventEmitter();
  const received: unknown[] = [];
  let finish!: (status: number) => void;
  const exited = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const result = superviseTui(
    {
      exited,
      signalCode: null,
      kill: (signal) => {
        received.push(signal);
      },
    },
    signals,
    "linux",
  );
  const lateForward = signals.listeners("SIGTERM")[0];
  expect(lateForward).toBeDefined();
  signals.emit("SIGTERM");
  expect(received).toEqual(["SIGTERM"]);
  finish(7);
  expect(await result).toBe(7);
  lateForward?.();
  signals.emit("SIGTERM");
  expect(received).toEqual(["SIGTERM"]);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGWINCH"])
    expect(signals.listenerCount(signal)).toBe(0);
});
