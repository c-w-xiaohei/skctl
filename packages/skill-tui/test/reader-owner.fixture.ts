import type { InstalledCapability } from "@skill-cli/core";
import { createComputed, createRoot, untrack } from "solid-js";
import { createReaderOwner, type ReaderAddress } from "../src/reader/state";
import type { ReaderState } from "../src/types";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";

export const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
export const installedContent = (address: ReaderAddress, text: string) => ({
  address,
  name: address.path,
  description: address.path,
  markdownText: text,
  rawText: text,
});
type ReadCall<T> = ReturnType<typeof deferred<T>> & { readonly signal?: AbortSignal };
export function pendingReader(onAcceptedFailure?: () => void) {
  const loads: ReadCall<Awaited<ReturnType<InstalledCapability["load"]>>>[] = [];
  const lists: ReadCall<Awaited<ReturnType<InstalledCapability["listResources"]>>>[] = [];
  const reads: ReadCall<Awaited<ReturnType<InstalledCapability["read"]>>>[] = [];
  const core = directSourceCore(workspaceProjection(), {
    installed: {
      load: (_request, options) => {
        const call = {
          ...deferred<Awaited<ReturnType<InstalledCapability["load"]>>>(),
          signal: options?.signal,
        };
        loads.push(call);
        return call.promise;
      },
      listResources: (_request, options) => {
        const call = {
          ...deferred<Awaited<ReturnType<InstalledCapability["listResources"]>>>(),
          signal: options?.signal,
        };
        lists.push(call);
        return call.promise;
      },
      read: (_request, options) => {
        const call = {
          ...deferred<Awaited<ReturnType<InstalledCapability["read"]>>>(),
          signal: options?.signal,
        };
        reads.push(call);
        return call.promise;
      },
    },
  });
  return { owner: createReaderOwner(core.installed, onAcceptedFailure), loads, lists, reads };
}

/** Observe the production signal, not a duplicate event dispatcher or test store. */
export function observeReader(
  owner: ReturnType<typeof createReaderOwner>,
  onWrite?: (value: ReaderState) => void,
) {
  const values: ReaderState[] = [];
  const dispose = createRoot((dispose) => {
    createComputed(() => {
      const value = owner.current();
      if (value) values.push(value);
    });
    if (onWrite)
      createComputed(() => {
        const value = owner.current();
        if (value) untrack(() => onWrite(value));
      });
    return dispose;
  });
  return { values, dispose };
}
