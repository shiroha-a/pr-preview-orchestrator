import { spawn } from "node:child_process";
import type { Readable } from "node:stream";

export interface DockerLoadResult {
  /** Exit code; -1 when the process failed to spawn or was killed on timeout. */
  code: number;
  /** Combined stdout+stderr (lists the loaded image tags on success). */
  output: string;
}

/**
 * Pipe a (possibly gzipped) image tar stream into `docker load` (issue #80).
 * Never rejects; the caller inspects the exit code.
 *
 * The idle timeout fires only when neither input data nor docker output arrives
 * for the given duration, so large uploads keep going as long as bytes flow
 * (same policy as the build runner, issue #14).
 */
export function dockerLoadFromStream(
  stream: Readable,
  opts: { idleTimeoutMs?: number; onChunk?: () => void } = {},
): Promise<DockerLoadResult> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["load"]);
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
    const finish = (result: DockerLoadResult) => {
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

    // 入力データの到着でもアイドルタイマーを更新する(docker load は完了までほぼ
    // 無出力のため、出力だけを見ると大きな転送中に誤って打ち切ってしまう)。
    stream.on("data", () => {
      armTimer();
      opts.onChunk?.();
    });
    stream.on("error", () => {
      // アップロード切断時はdocker loadを止めて失敗として返す。
      child.kill("SIGKILL");
    });
    stream.pipe(child.stdin);

    child.on("error", () => finish({ code: -1, output }));
    child.on("close", (code) => {
      if (timedOut) {
        finish({ code: -1, output: `${output}\ndocker load timed out (no data)` });
        return;
      }
      finish({ code: code ?? 0, output });
    });
  });
}
