import type { CoreOptions } from "../../../shared";
import type { SourceNetwork } from "../../types";

export interface RemoteRequest extends SourceNetwork {
  readonly origin: string;
  readonly kind: "git" | "github";
  readonly ref: string;
  readonly transport?: CoreOptions["sourceTransport"];
  readonly githubApiBaseUrl?: string;
  readonly signal?: AbortSignal;
  readonly budgetMs?: number;
}

export interface Revision {
  readonly commit: string;
  readonly tree: string;
  readonly observedAt?: number;
  readonly refreshError?: string;
}

export interface Repository {
  revision(
    target:
      | { readonly commit: string; readonly offline?: boolean }
      | { readonly current: true }
      | { readonly retained: true },
  ): Promise<RepositoryReader | undefined>;
}

/** One fixed revision and access policy; another view cannot grant it network access. */
export interface RepositoryReader {
  readonly version: Revision;
  readTree(oid: string): Promise<import("isomorphic-git").TreeObject>;
  blobSize(oid: string): number | undefined;
  blobs(ids: readonly string[], maxBytes?: number): Promise<ReadonlyMap<string, Uint8Array>>;
}
