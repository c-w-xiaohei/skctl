import { createSignal, type Accessor } from "solid-js";
import type { DispatchResult, FocusOwner } from "./types";
import { isPlainNavKey, type NavKey } from "./navigation";

export interface FocusTarget {
  focus(): void;
}

export type FocusVersionListener = (version: number) => void;

export interface FocusRegistry {
  register(owner: FocusOwner, target: FocusTarget): () => void;
  /** A physical child aliases this exact canonical registration, never a later root. */
  registerMember(owner: FocusOwner, target: FocusTarget, origin: FocusTarget): () => void;
  target(owner: FocusOwner): FocusTarget | undefined;
  ownerOf(target: FocusTarget): FocusOwner | undefined;
  version(): number;
  subscribe(listener: FocusVersionListener): () => void;
  applyFocus(owner: FocusOwner): boolean;
  registerModeHandler(target: FocusTarget, handler: (key: NavKey) => DispatchResult): () => void;
  dispatchMode(target: FocusTarget | undefined, key: NavKey): DispatchResult;
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
  const [desired, setDesired] = createSignal<FocusOwner | undefined>(initial, { equals: false });
  const registry = createFocusRegistry();
  const [revision, setRevision] = createSignal(0);
  return {
    desired,
    registry,
    revision,
    request: (owner) => {
      setRevision((current) => current + 1);
      setDesired(owner);
    },
    clear: () => {
      setRevision((current) => current + 1);
      setDesired(undefined);
    },
    apply: () => {
      const owner = desired();
      const requestedRevision = revision();
      if (!owner || !registry.applyFocus(owner)) return false;
      // A focus listener may request a different, freshly mounted owner.
      // Do not clear that newer request while acknowledging this one.
      if (revision() === requestedRevision) {
        setRevision((current) => current + 1);
        setDesired(undefined);
      }
      return true;
    },
  };
}

export function createFocusRegistry(): FocusRegistry {
  const bindings = new Map<FocusOwner, { readonly token: object; readonly target: FocusTarget }>();
  const members = new WeakMap<
    FocusTarget,
    {
      readonly token: object;
      readonly owner: FocusOwner;
      readonly origin: FocusTarget;
      readonly registrationToken: object;
      active: boolean;
    }
  >();
  const listeners = new Set<FocusVersionListener>();
  const modeHandlers = new WeakMap<
    FocusTarget,
    { readonly handler: (key: NavKey) => DispatchResult; readonly memberToken?: object }
  >();
  const isDestroyed = (target: FocusTarget) =>
    "isDestroyed" in target && target.isDestroyed === true;
  const liveMember = (target: FocusTarget) => {
    const member = members.get(target);
    const binding = member && bindings.get(member.owner);
    return member?.active &&
      binding?.token === member.registrationToken &&
      binding.target === member.origin &&
      !isDestroyed(member.origin) &&
      !isDestroyed(target)
      ? member
      : undefined;
  };
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
    registerMember(owner, target, origin) {
      const binding = bindings.get(owner);
      if (!binding || binding.target !== origin || target === origin) return () => {};
      const member = {
        token: {},
        owner,
        origin,
        registrationToken: binding.token,
        active: true,
      };
      members.set(target, member);
      bump();
      return () => {
        if (members.get(target)?.token !== member.token || !member.active) return;
        // Keep a weak tombstone: an explicit handler must not revive a released member.
        member.active = false;
        bump();
      };
    },
    target: (owner) => bindings.get(owner)?.target,
    ownerOf(target) {
      let content: FocusOwner | undefined;
      for (const [owner, binding] of bindings) {
        if (binding.target !== target) continue;
        if (owner !== "work-area") return owner;
        content = owner;
      }
      return liveMember(target)?.owner ?? content;
    },
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
      if (isDestroyed(binding.target)) return false;
      binding.target.focus();
      return !("focused" in binding.target) || binding.target.focused === true;
    },
    registerModeHandler(target, handler) {
      const entry = { handler, memberToken: members.get(target)?.token };
      modeHandlers.set(target, entry);
      return () => {
        if (modeHandlers.get(target) === entry) modeHandlers.delete(target);
      };
    },
    dispatchMode(target, key) {
      if (!target || !isPlainNavKey(key)) return "declined";
      const member = liveMember(target);
      if (members.has(target) && !member) return "declined";
      const explicit = modeHandlers.get(target);
      const current =
        explicit && (!member || explicit.memberToken === member.token) ? explicit : undefined;
      const entry = current ?? (member && modeHandlers.get(member.origin));
      return entry?.handler(key) ?? "declined";
    },
  };
}
