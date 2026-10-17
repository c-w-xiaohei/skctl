import type { ContentCapability } from "@skill-cli/core";
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
  value: {
    address,
    name: address.path,
    description: address.path,
    markdownText: text,
    rawText: text,
  },
  diagnostics: [],
});
type ReadCall<T> = ReturnType<typeof deferred<T>> & { readonly signal?: AbortSignal };
export function pendingReader(onAcceptedFailure?: () => void) {
  const loads: ReadCall<Awaited<ReturnType<ContentCapability["loadInstalled"]>>>[] = [];
  const lists: ReadCall<Awaited<ReturnType<ContentCapability["listInstalledResources"]>>>[] = [];
  const reads: ReadCall<Awaited<ReturnType<ContentCapability["readInstalled"]>>>[] = [];
  const core = directSourceCore(workspaceProjection(), {
    loadInstalled: (_request, options) => {
      const call = {
        ...deferred<Awaited<ReturnType<ContentCapability["loadInstalled"]>>>(),
        signal: options?.signal,
      };
      loads.push(call);
      return call.promise;
    },
    listInstalledResources: (_request, options) => {
      const call = {
        ...deferred<Awaited<ReturnType<ContentCapability["listInstalledResources"]>>>(),
        signal: options?.signal,
      };
      lists.push(call);
      return call.promise;
    },
    readInstalled: (_request, options) => {
      const call = {
        ...deferred<Awaited<ReturnType<ContentCapability["readInstalled"]>>>(),
        signal: options?.signal,
      };
      reads.push(call);
      return call.promise;
    },
  });
  return { owner: createReaderOwner(core.content, onAcceptedFailure), loads, lists, reads };
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
