import { type ChildProcess, spawn } from "node:child_process";

import { emitPreviewLog } from "./events";

const streams = new Map<string, ChildProcess>();

interface LogStreamOptions {
  previewId: string;
  dir: string;
  composePath: string;
  overrideFile: string;
  project: string;
}

/**
 * Follow a preview's container logs (`docker compose logs -f`) and stream each
 * line to the preview's SSE feed, so runtime logs appear right after the build
 * logs (issue #16). Replaces any existing stream for the preview.
 */
export function startLogStream(opts: LogStreamOptions): void {
  stopLogStream(opts.previewId);

  const child = spawn(
    "docker",
    [
      "compose",
      "-f",
      opts.composePath,
      "-f",
      opts.overrideFile,
      "-p",
      opts.project,
      "logs",
      "-f",
      "--tail",
      "20",
      "--no-color",
    ],
    { cwd: opts.dir },
  );
  streams.set(opts.previewId, child);

  const handle = (buf: Buffer) => {
    for (const line of buf.toString().split(/\r?\n/)) {
      if (line.length > 0) emitPreviewLog(opts.previewId, line);
    }
  };
  child.stdout.on("data", handle);
  child.stderr.on("data", handle);
  child.on("close", () => streams.delete(opts.previewId));
  child.on("error", () => streams.delete(opts.previewId));
}

/** Stop following a preview's container logs, if active. */
export function stopLogStream(previewId: string): void {
  const child = streams.get(previewId);
  if (child) {
    child.kill();
    streams.delete(previewId);
  }
}
