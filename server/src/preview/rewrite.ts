import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface RewriteRule {
  /** Path to the target file, relative to the repository root. */
  file: string;
  /** Regular expression to match. */
  pattern: string;
  /** Replacement string; supports {{VAR}} placeholders. */
  replacement: string;
  /** Regex flags (default "gm"). */
  flags?: string;
}

/** Parse the JSON-encoded rewrite rules stored on a repository. */
export function parseRewriteRules(json: string | null | undefined): RewriteRule[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RewriteRule =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as RewriteRule).file === "string" &&
        typeof (r as RewriteRule).pattern === "string" &&
        typeof (r as RewriteRule).replacement === "string",
    );
  } catch {
    return [];
  }
}

/** Expand {{VAR}} placeholders in a template using the given variables. */
export function expandTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    key in vars ? vars[key] : `{{${key}}}`,
  );
}

/**
 * Apply file rewrite rules to a cloned workspace before starting the preview.
 *
 * Each rule replaces regex matches in a file; the replacement supports
 * {{PREVIEW_URL}}, {{PREVIEW_HOST}}, {{HOST_PORT}}, {{PR_NUMBER}}, {{PR_TITLE}}
 * and {{PROFILE_NAME}} placeholders (issue #75). Missing files are skipped with
 * a warning rather than failing the build.
 */
export function applyRewrites(
  dir: string,
  rules: RewriteRule[],
  vars: Record<string, string>,
  log: (line: string) => void,
): void {
  for (const rule of rules) {
    const target = join(dir, rule.file);
    if (!existsSync(target)) {
      log(`WARN: rewrite target not found, skipping: ${rule.file}`);
      continue;
    }
    const content = readFileSync(target, "utf8");
    const replacement = expandTemplate(rule.replacement, vars);
    let regex: RegExp;
    try {
      regex = new RegExp(rule.pattern, rule.flags ?? "gm");
    } catch {
      log(`WARN: invalid regex for ${rule.file}, skipping: ${rule.pattern}`);
      continue;
    }
    const updated = content.replace(regex, replacement);
    if (updated !== content) {
      writeFileSync(target, updated);
      log(`Rewrote ${rule.file}`);
    } else {
      log(`No change in ${rule.file} (pattern did not match)`);
    }
  }
}
