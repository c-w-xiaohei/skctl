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
type ReadCall<T> = ReturnType<typeof deferred<T>> & {
  readonly signal?: AbortSignal;
};
export function pendingReader(onAcceptedFailure?: () => void) {
  const loads: ReadCall<
    Awaited<ReturnType<typeof import("@skill-cli/core").loadInstalledSkill>>
  >[] = [];
  const lists: ReadCall<
    Awaited<ReturnType<typeof import("@skill-cli/core").listInstalledResources>>
  >[] = [];
  const reads: ReadCall<
    Awaited<ReturnType<typeof import("@skill-cli/core").readInstalledResource>>
  >[] = [];
  const core = directSourceCore(workspaceProjection(), {
    loadInstalledSkill: (
      _environment: import("@skill-cli/core").CoreOptions,
      _request,
      options,
    ) => {
      const call = {
        ...deferred<Awaited<ReturnType<typeof import("@skill-cli/core").loadInstalledSkill>>>(),
        signal: options?.signal,
      };
      loads.push(call);
      return call.promise;
    },
    listInstalledResources: (
      _environment: import("@skill-cli/core").CoreOptions,
      _request,
      options,
    ) => {
      const call = {
        ...deferred<Awaited<ReturnType<typeof import("@skill-cli/core").listInstalledResources>>>(),
        signal: options?.signal,
      };
      lists.push(call);
      return call.promise;
    },
    readInstalledResource: (
      _environment: import("@skill-cli/core").CoreOptions,
      _request,
      options,
    ) => {
      const call = {
        ...deferred<Awaited<ReturnType<typeof import("@skill-cli/core").readInstalledResource>>>(),
        signal: options?.signal,
      };
      reads.push(call);
      return call.promise;
    },
  });
  return { owner: createReaderOwner(core, onAcceptedFailure), loads, lists, reads };
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
