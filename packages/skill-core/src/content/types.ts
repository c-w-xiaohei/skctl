import type { SkillAddress } from "../source/schema";
import type { SkillProvenance } from "../source/types";
import type { SkillMetadata } from "./text";

export interface LoadSkillRequest {
  readonly selector: string;
}

export interface ReadResourceRequest extends LoadSkillRequest {
  readonly path: string;
}

export interface DownloadResourceRequest extends ReadResourceRequest {
  readonly output: string;
  readonly force: boolean;
}

export interface RunSkillRequest extends LoadSkillRequest {
  readonly argv: readonly [string, ...string[]];
}

export interface LoadedSkill extends LoadSkillRequest, SkillMetadata {
  readonly path: "SKILL.md";
  readonly text: string;
  readonly provenance: SkillProvenance;
}

export interface ResourceDescriptor {
  readonly path: string;
  readonly kind: "file" | "symlink" | "gitlink" | "directory";
  readonly size?: number;
  readonly executable?: boolean;
  readonly gitlinkCommit?: string;
}

export interface ReadResourceResult extends ReadResourceRequest {
  readonly text: string;
  readonly provenance: SkillProvenance;
}

export interface DownloadResourceResult extends Omit<DownloadResourceRequest, "force"> {
  readonly bytesWritten: number;
  readonly provenance: SkillProvenance;
}

export interface RunSkillResult extends LoadSkillRequest {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly cancelled: boolean;
}

export interface LoadedInstalledSkill extends SkillMetadata {
  readonly address: SkillAddress;
  readonly rawText: string;
  readonly markdownText: string;
}

export type InstalledResourceResult =
  | {
      readonly kind: "text";
      readonly path: string;
      readonly text: string;
      readonly format: "markdown" | "text";
    }
  | {
      readonly kind: "not-text";
      readonly path: string;
      readonly reason: "binary" | "too-large" | "unsupported";
      readonly metadata: ResourceDescriptor;
    };
