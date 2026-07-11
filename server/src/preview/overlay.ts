import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { expandTemplate } from "./rewrite";

export interface OverlayFile {
  /** Destination path, relative to the repository root (the clone directory). */
  path: string;
  /** File content; supports template variables ({{PREVIEW_URL}}, {{PR_TITLE}}, ...). */
  content: string;
}

/**
 * Overlay entry stored on a settings profile (issue #56). Applied on top of the
 * repository default overlays: adds a file (replacing the default with the same
 * path), or removes a default file when `delete` is true.
 */
export interface ProfileOverlayEntry {
  path: string;
  content?: string;
  delete?: boolean;
}

/** Parse the JSON-encoded overlay files stored on a repository. */
export function parseOverlayFiles(json: string | null | undefined): OverlayFile[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (o): o is OverlayFile =>
        typeof o === "object" &&
        o !== null &&
        typeof (o as OverlayFile).path === "string" &&
        typeof (o as OverlayFile).content === "string",
    );
  } catch {
    return [];
  }
}

/** Parse the JSON-encoded overlay entries stored on a settings profile (issue #56). */
export function parseProfileOverlayEntries(json: string | null | undefined): ProfileOverlayEntry[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (o): o is ProfileOverlayEntry =>
        typeof o === "object" && o !== null && typeof (o as ProfileOverlayEntry).path === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Write overlay files into the cloned workspace before starting the preview.
 *
 * This lets a test-specific compose file, config (e.g. default.yml), or volume
 * setup live outside the target repository and be injected at build time.
 * Content supports {{PREVIEW_URL}} / {{PREVIEW_HOST}} / {{HOST_PORT}} plus
 * {{PR_NUMBER}} / {{PR_TITLE}} / {{PROFILE_NAME}} (issue #75). Parent
 * directories are created and existing files overwritten. Paths that escape the
 * workspace (e.g. via "..") are skipped.
 */
export function applyOverlays(
  dir: string,
  overlays: OverlayFile[],
  vars: Record<string, string>,
  log: (line: string) => void,
): void {
  const root = resolve(dir);
  for (const overlay of overlays) {
    if (!overlay.path.trim()) continue;
    const target = resolve(dir, overlay.path);
    if (target !== root && !target.startsWith(root + "/")) {
      log(`WARN: overlay path escapes the workspace, skipping: ${overlay.path}`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, expandTemplate(overlay.content, vars));
    log(`Wrote overlay ${overlay.path}`);
  }
}
