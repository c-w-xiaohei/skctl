import { expect, test } from "bun:test";
import type { Renderable } from "@opentui/core";
import { createModalControlRegistry } from "../src/modal-controls";

const target = (
  id: string,
  options: { readonly parent?: Renderable | null; readonly destroyed?: boolean } = {},
) => {
  const calls: string[] = [];
  return {
    id,
    ...(options.parent === undefined ? {} : { parent: options.parent }),
    ...(options.destroyed === undefined ? {} : { isDestroyed: options.destroyed }),
    focus() {
      calls.push(id);
    },
    calls,
  } as unknown as Renderable & { readonly calls: string[] };
};

const next = (
  registry: ReturnType<typeof createModalControlRegistry>,
  current: Renderable | null,
  reverse = false,
) => {
  expect(registry.focusNext(current, reverse)).toBe(true);
};

test("replacing an existing control keeps its physical slot and stale cleanup is target-safe", () => {
  const registry = createModalControlRegistry();
  const first = target("first");
  const second = target("second");
  const replacement = target("replacement");
  const unregisterFirst = registry.register("field", first);
  registry.register("next", second);
  registry.register("field", replacement);

  next(registry, replacement);
  expect(second.calls).toEqual(["second"]);
  registry.unregister("field", first);
  unregisterFirst();
  next(registry, second, true);
  expect(replacement.calls).toEqual(["replacement"]);
});

test("explicit order sorts new controls and changing order moves an existing slot", () => {
  const registry = createModalControlRegistry();
  const unordered = target("unordered");
  const late = target("late");
  const early = target("early");
  const moved = target("moved");
  registry.register("unordered", unordered);
  registry.register("late", late, 90);
  registry.register("early", early, 10);
  registry.register("late", moved, 20);

  next(registry, early);
  expect(moved.calls).toEqual(["moved"]);
  next(registry, moved);
  expect(late.calls).toEqual([]);
  expect(unordered.calls).toEqual(["unordered"]);
});

test("equal ordered entries and unordered entries retain insertion order", () => {
  const registry = createModalControlRegistry();
  const first = target("first");
  const second = target("second");
  const third = target("third");
  const fourth = target("fourth");
  registry.register("first", first, 20);
  registry.register("second", second, 20);
  registry.register("third", third);
  registry.register("fourth", fourth);

  next(registry, first);
  next(registry, second);
  next(registry, third);
  expect(second.calls).toEqual(["second"]);
  expect(third.calls).toEqual(["third"]);
  expect(fourth.calls).toEqual(["fourth"]);
});

test("dynamic removal skips disabled, destroyed, or detached controls without rejecting late refs", () => {
  const registry = createModalControlRegistry();
  const first = target("first");
  const detached = target("detached", { parent: first });
  const destroyed = target("destroyed", { parent: first, destroyed: true });
  const disabled = target("disabled", { parent: first });
  const live = target("live", { parent: first });
  registry.register("first", first);
  registry.register("detached", detached);
  registry.register("destroyed", destroyed);
  registry.register("disabled", disabled, undefined, () => false);
  registry.register("live", live);
  (detached as unknown as { parent: Renderable | null }).parent = null;

  next(registry, first);
  expect(live.calls).toEqual(["live"]);
  expect(detached.calls).toEqual([]);
  expect(destroyed.calls).toEqual([]);
  expect(disabled.calls).toEqual([]);
});

test("registration accepts a valid ref before OpenTUI attaches it", () => {
  const registry = createModalControlRegistry();
  const late = target("late");
  registry.register("late", late);

  next(registry, null);

  expect(late.calls).toEqual(["late"]);
});

test("an unrelated focused target does not enter this registry's Tab order", () => {
  const registry = createModalControlRegistry();
  const command = target("command");
  const unrelated = target("unrelated");
  registry.register("command", command);

  expect(registry.focusNext(unrelated, false)).toBe(false);
  expect(command.calls).toEqual([]);
});

test("a disabled command leaves and re-enters Tab order without stale registration", () => {
  const registry = createModalControlRegistry();
  const first = target("first");
  const command = target("command");
  let enabled = false;
  registry.register("first", first);
  registry.register("command", command, undefined, () => enabled);

  next(registry, first);
  expect(first.calls).toEqual(["first"]);

  enabled = true;
  next(registry, first);
  expect(command.calls).toEqual(["command"]);

  enabled = false;
  next(registry, first);
  expect(command.calls).toEqual(["command"]);
  expect(first.calls).toEqual(["first", "first"]);
});
