import { spawn } from "node:child_process";

export interface DockerRunResult {
  /** Exit code; -1 when the process failed to spawn or was killed on timeout. */
  code: number;
  /** Combined stdout+stderr. */
  output: string;
}

/**
 * Run a docker command and capture combined stdout+stderr. Never rejects.
 *
 * The idle timeout kills the process only when it produces no output for the
 * given duration, so long-running prunes are not cut off while they still make
 * progress (same policy as the build runner, issue #14).
 */
export function runDocker(
  args: string[],
  opts: { idleTimeoutMs?: number } = {},
): Promise<DockerRunResult> {
  return new Promise((resolve) => {
    const child = spawn("docker", args);
    let output = "";
    let settled = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const armTimer = () => {
      if (!opts.idleTimeoutMs) return;
      clearTimer();
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, opts.idleTimeoutMs);
    };
    const finish = (result: DockerRunResult) => {
      if (settled) return;
      settled = true;
      clearTimer();
      resolve(result);
    };

    const collect = (buf: Buffer) => {
      output += buf.toString();
      armTimer();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    armTimer();

    child.on("error", () => finish({ code: -1, output }));
    child.on("close", (code) => {
      if (timedOut) {
        finish({ code: -1, output: `${output}\ndocker ${args[0]} timed out (no output)` });
        return;
      }
      finish({ code: code ?? 0, output });
    });
  });
}
