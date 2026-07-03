import type { Repository, SettingsProfile } from "../generated/prisma/client";

/**
 * Preview settings resolved for a single build: the repository defaults,
 * optionally overridden field-by-field by a settings profile (issue #52).
 */
export interface EffectiveSettings {
  /** Newline-separated compose file paths; later files override earlier ones. */
  composePath: string;
  webService: string | null;
  internalPort: number | null;
  /** JSON-encoded rewrite rules. */
  fileRewrites: string | null;
  /** JSON-encoded overlay files. */
  overlayFiles: string | null;
  resetVolumes: boolean;
}

/**
 * Merge a settings profile over the repository defaults. Each non-null profile
 * field replaces the corresponding default (no merging within a field).
 */
export function resolveSettings(
  repo: Repository,
  profile: SettingsProfile | null | undefined,
): EffectiveSettings {
  return {
    composePath: profile?.composePath ?? repo.composePath,
    webService: profile?.webService ?? repo.webService,
    internalPort: profile?.internalPort ?? repo.internalPort,
    fileRewrites: profile?.fileRewrites ?? repo.fileRewrites,
    overlayFiles: profile?.overlayFiles ?? repo.overlayFiles,
    resetVolumes: profile?.resetVolumes ?? repo.resetVolumes,
  };
}

/**
 * Split a newline-separated compose path setting into individual file paths
 * (trimmed, empty lines dropped). A single-line value keeps working as before.
 */
export function parseComposePaths(composePath: string): string[] {
  return composePath
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Build the `-f <file>` argument list for `docker compose` from a compose path
 * setting. Later files override earlier ones per compose's merge semantics
 * (issue #52).
 */
export function composeFileArgs(composePath: string): string[] {
  return parseComposePaths(composePath).flatMap((p) => ["-f", p]);
}
