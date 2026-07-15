import type { Repository, SettingsProfile } from "../generated/prisma/client";

import {
  type OverlayFile,
  parseOverlayFiles,
  parseProfileOverlayEntries,
  type ProfileOverlayEntry,
} from "./overlay";

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
  /** Resolved overlay files: repository defaults merged with the profile (issue #56). */
  overlayFiles: OverlayFile[];
  resetVolumes: boolean;
  /**
   * Where images are built (issue #80): "auto" / "remote" / "local", or null to
   * inherit the global default (BUILD_MODE_DEFAULT).
   */
  buildMode: string | null;
}

/**
 * Apply a profile's overlay entries on top of the repository default overlays
 * (issue #56). An entry adds a file (replacing a default with the same path in
 * place), or removes the default file when `delete` is true. Entries are
 * applied in order; new paths are appended.
 */
export function mergeOverlayFiles(
  defaults: OverlayFile[],
  entries: ProfileOverlayEntry[],
): OverlayFile[] {
  const merged = new Map(defaults.map((o) => [o.path, o]));
  for (const entry of entries) {
    if (entry.delete) {
      merged.delete(entry.path);
    } else {
      merged.set(entry.path, { path: entry.path, content: entry.content ?? "" });
    }
  }
  return [...merged.values()];
}

/**
 * Merge a settings profile over the repository defaults. Each non-null profile
 * field replaces the corresponding default, except overlayFiles which is
 * additive: the profile's entries add to / remove from the defaults (issue #56).
 */
export function resolveSettings(
  repo: Repository,
  profile: SettingsProfile | null | undefined,
): EffectiveSettings {
  const defaultOverlays = parseOverlayFiles(repo.overlayFiles);
  return {
    composePath: profile?.composePath ?? repo.composePath,
    webService: profile?.webService ?? repo.webService,
    internalPort: profile?.internalPort ?? repo.internalPort,
    fileRewrites: profile?.fileRewrites ?? repo.fileRewrites,
    overlayFiles:
      profile?.overlayFiles != null
        ? mergeOverlayFiles(defaultOverlays, parseProfileOverlayEntries(profile.overlayFiles))
        : defaultOverlays,
    resetVolumes: profile?.resetVolumes ?? repo.resetVolumes,
    buildMode: profile?.buildMode ?? repo.buildMode,
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
