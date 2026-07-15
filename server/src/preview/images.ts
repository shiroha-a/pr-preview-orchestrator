import { spawn } from "node:child_process";

import { composeArgs } from "./engine";

/**
 * Compose image inventory helpers (issue #80). Used by the orchestrator to
 * compute the tags a remote build is expected to produce (from its own local
 * checkout), and to verify what `docker load` actually imported. DB-free so
 * the agent runtime can share it.
 */

/** Run a command and capture raw stdout (stderr is forwarded to onLine). */
function collectOutput(
  command: string,
  args: string[],
  opts: { cwd?: string; onLine?: (line: string) => void } = {},
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd: opts.cwd });
    let stdout = "";
    child.stdout.on("data", (buf: Buffer) => {
      stdout += buf.toString();
    });
    child.stderr.on("data", (buf: Buffer) => {
      for (const line of buf.toString().split(/\r?\n/)) {
        if (line.length > 0) opts.onLine?.(line);
      }
    });
    child.on("error", () => resolvePromise({ code: -1, stdout }));
    child.on("close", (code) => resolvePromise({ code: code ?? 0, stdout }));
  });
}

/**
 * Extract the image tags of services that are BUILT (have a `build:` section)
 * from `docker compose config --format json` output. Pull-only images are
 * excluded: the orchestrator can pull those itself, so transferring them would
 * only waste bandwidth.
 */
export function parseBuiltImages(configJson: string, project: string): string[] {
  const parsed = JSON.parse(configJson) as {
    services?: Record<string, { image?: string; build?: unknown } | null>;
  };
  const images: string[] = [];
  for (const [serviceName, service] of Object.entries(parsed.services ?? {})) {
    if (!service || service.build == null) continue;
    // compose の既定イメージ名は <project>-<service>(issue #67 と同じ前提)。
    images.push(service.image ?? `${project}-${serviceName}`);
  }
  return images;
}

export interface ListBuiltImagesOptions {
  dir: string;
  composePath: string;
  composeProject: string;
  onLine: (line: string) => void;
}

/** Resolve the built-image tags for a prepared workspace via `compose config`. */
export async function listComposeBuiltImages(opts: ListBuiltImagesOptions): Promise<string[]> {
  const { code, stdout } = await collectOutput(
    "docker",
    [...composeArgs(opts.composePath, opts.composeProject), "config", "--format", "json"],
    { cwd: opts.dir, onLine: opts.onLine },
  );
  if (code !== 0) throw new Error(`docker compose config exited with code ${code}`);
  return parseBuiltImages(stdout, opts.composeProject);
}

/**
 * Return the tags reported by `docker load` output that are NOT in the
 * expected list (issue #80 review 2). Untagged loads ("Loaded image ID:") are
 * always unexpected: the agent should only ship the tags the orchestrator
 * asked for, so anything else indicates a bug or a tampered upload.
 */
export function unexpectedLoadedImages(output: string, expected: string[]): string[] {
  const unexpected: string[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const tag = /^Loaded image: (.+)$/.exec(line)?.[1]?.trim();
    if (tag && !expected.includes(tag)) unexpected.push(tag);
    if (/^Loaded image ID: /.test(line)) unexpected.push(line);
  }
  return unexpected;
}
