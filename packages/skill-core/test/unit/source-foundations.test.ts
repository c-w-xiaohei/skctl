import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runProcess } from "../../src/runtime/process";
import { withFileLock } from "../../src/storage/file-lock";

const fixture = async () => {
  return mkdtemp(join(tmpdir(), "skctl-foundations-"));
};

test("file lock serializes independent callers and permits same-task reentry", async () => {
  const path = join(await fixture(), "operation.lock");
  const order: number[] = [];
  await Promise.all(
    [1, 2, 3].map((id) =>
      withFileLock(path, async () => {
        order.push(id);
        await withFileLock(path, async () => {
          order.push(-id);
        });
        await Bun.sleep(10);
      }),
    ),
  );
  expect(order).toHaveLength(6);
  for (let index = 0; index < order.length; index += 2)
    expect(order[index + 1]).toBe(-order[index]!);
  await expect(readFile(path)).rejects.toHaveProperty("code", "ENOENT");
});

test("unknown lock ownership is retained, and a cancelled waiter cannot remove a live lock", async () => {
  const path = join(await fixture(), "operation.lock");
  await writeFile(path, "unreadable owner");
  await expect(withFileLock(path, async () => {}, { timeoutMs: 25 })).rejects.toHaveProperty(
    "code",
    "LOCK_TIMEOUT",
  );
  expect(await readFile(path, "utf8")).toBe("unreadable owner");
  const controller = new AbortController();
  controller.abort();
  await expect(
    withFileLock(path, async () => {}, { signal: controller.signal }),
  ).rejects.toHaveProperty("code", "CANCELLED");
  expect(await readFile(path, "utf8")).toBe("unreadable owner");
});

test("process runner returns binary output and cancels an owned child", async () => {
  const normal = await runProcess({
    cmd: [process.execPath, "-e", "process.stdout.write(new Uint8Array([0,255,10]))"],
  });
  expect([...normal.stdout]).toEqual([0, 255, 10]);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40);
  try {
    await expect(
      runProcess({
        cmd: [process.execPath, "-e", "setInterval(()=>{},1000)"],
        signal: controller.signal,
      }),
    ).rejects.toHaveProperty("code", "CANCELLED");
  } finally {
    clearTimeout(timer);
  }
});
