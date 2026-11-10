import { createMemo, createSignal, type Accessor } from "solid-js";
import type { CommandRecord, CommandRegistration, FocusOwner } from "./types";

export interface ExecutableCommand {
  readonly record: CommandRecord;
  readonly execute: () => void;
}

interface MountedCommand extends ExecutableCommand {
  readonly owner: FocusOwner;
  readonly controlId: string;
}

/** App-local command discovery and dispatch; eligibility stays with each command's owner. */
export function createCommandRegistry(context: Accessor<readonly ExecutableCommand[]>) {
  const [mounted, setMounted] = createSignal<ReadonlyMap<string, MountedCommand>>(new Map());
  const register: CommandRegistration = (record, owner, controlId, execute) => {
    const registration = { record, owner, controlId, execute };
    setMounted((current) => new Map(current).set(record.id, registration));
    return () =>
      setMounted((current) => {
        if (current.get(record.id) !== registration) return current;
        const next = new Map(current);
        next.delete(record.id);
        return next;
      });
  };
  const available = createMemo(() => {
    const current = mounted();
    const commands = new Map<string, ExecutableCommand>();
    for (const command of current.values()) {
      if (command.record.scope !== "widget") commands.set(command.record.id, command);
    }
    for (const command of context()) {
      if (!current.has(command.record.id) && !commands.has(command.record.id))
        commands.set(command.record.id, command);
    }
    return new Map([...commands].filter(([, command]) => command.record.palette !== false));
  });
  const records = createMemo(() => [...available().values()].map((command) => command.record));
  return {
    mounted,
    register,
    records,
    resolve: (id: string) => available().get(id),
    execute(id: string) {
      const command = available().get(id);
      if (!command?.record.enabled) return false;
      command.execute();
      return true;
    },
  };
}
