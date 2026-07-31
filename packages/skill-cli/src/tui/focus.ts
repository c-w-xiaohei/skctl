import { createSignal, type Accessor } from "solid-js";
import type { FocusOwner } from "./types";

export interface FocusTarget {
  focus(): void;
}

export type FocusVersionListener = (version: number) => void;

export interface FocusRegistry {
  register(owner: FocusOwner, target: FocusTarget): () => void;
  target(owner: FocusOwner): FocusTarget | undefined;
  version(): number;
  subscribe(listener: FocusVersionListener): () => void;
  applyFocus(owner: FocusOwner): boolean;
}

export interface Focus {
  readonly desired: Accessor<FocusOwner | undefined>;
  readonly registry: FocusRegistry;
  revision(): number;
  request(owner: FocusOwner): void;
  clear(): void;
  apply(): boolean;
}

export function createFocus(initial?: FocusOwner): Focus {
  const [desired, setDesired] = createSignal<FocusOwner | undefined>(initial);
  const registry = createFocusRegistry();
  let revision = 0;
  return {
    desired,
    registry,
    revision: () => revision,
    request: (owner) => {
      revision += 1;
      setDesired(owner);
    },
    clear: () => {
      revision += 1;
      setDesired(undefined);
    },
    apply: () => {
      const owner = desired();
      return owner ? registry.applyFocus(owner) : false;
    },
  };
}

export function createFocusRegistry(): FocusRegistry {
  const bindings = new Map<FocusOwner, { readonly token: object; readonly target: FocusTarget }>();
  const listeners = new Set<FocusVersionListener>();
  let version = 0;
  const bump = () => {
    version += 1;
    for (const listener of listeners) listener(version);
  };
  return {
    register(owner, target) {
      const token = {};
      bindings.set(owner, { token, target });
      bump();
      return () => {
        if (bindings.get(owner)?.token === token) {
          bindings.delete(owner);
          bump();
        }
      };
    },
    target: (owner) => bindings.get(owner)?.target,
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applyFocus(owner) {
      const binding = bindings.get(owner);
      if (!binding) return false;
      binding.target.focus();
      return true;
    },
  };
}
