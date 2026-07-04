import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import type { Readable } from "node:stream";

import { prisma } from "../db/client";
import { env } from "../env";
import { emitPreviewLog } from "./events";

/**
 * Export/import of a preview's docker volumes as tar.gz archives (issue #61).
 *
 * All reads/writes go through a throwaway helper container (busybox) that
 * mounts the volume, so the orchestrator never needs direct filesystem access
 * to docker's volume storage. Archives are streamed via the helper's
 * stdin/stdout; run as root inside the container so file ownership (uid/gid)
 * is preserved across export/import (important for DB volumes).
 */

// composeが生成するボリューム名はこの形式に収まる。docker CLIへ渡す前の防御的検証。
const VOLUME_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export function isValidVolumeName(name: string): boolean {
  return VOLUME_NAME.test(name);
}

/** Run a docker command and capture combined stdout+stderr. Never rejects. */
function runDocker(
  args: string[],
  opts: { stdinFile?: string } = {},
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("docker", args);
    let output = "";
    const collect = (buf: Buffer) => {
      output += buf.toString();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    if (opts.stdinFile) {
      const file = createReadStream(opts.stdinFile);
      file.on("error", () => child.kill("SIGKILL"));
      file.pipe(child.stdin);
    }
    child.on("error", () => resolve({ code: -1, output }));
    child.on("close", (code) => resolve({ code: code ?? 0, output }));
  });
}

export interface VolumeInfo {
  name: string;
  /** Approximate content size in MB, or null when it could not be measured. */
  sizeMb: number | null;
}

/** List the docker volumes belonging to a compose project. */
export async function listComposeVolumes(project: string): Promise<VolumeInfo[]> {
  const { code, output } = await runDocker([
    "volume",
    "ls",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--format",
    "{{.Name}}",
  ]);
  if (code !== 0) throw new Error(`docker volume ls failed: ${output.trim()}`);
  const names = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
  const volumes: VolumeInfo[] = [];
  for (const name of names) {
    volumes.push({ name, sizeMb: await volumeSizeMb(name) });
  }
  return volumes;
}

/** Measure a volume's content size via `du` in the helper container. */
async function volumeSizeMb(name: string): Promise<number | null> {
  const { code, output } = await runDocker([
    "run",
    "--rm",
    "-v",
    `${name}:/data:ro`,
    env.PREVIEW_VOLUME_HELPER_IMAGE,
    "du",
    "-sm",
    "/data",
  ]);
  if (code !== 0) return null;
  const match = output.match(/(\d+)\s+\/data/);
  return match ? Number(match[1]) : null;
}

/** Whether the volume exists and belongs to the given compose project. */
export async function volumeBelongsToProject(name: string, project: string): Promise<boolean> {
  if (!isValidVolumeName(name)) return false;
  const { code, output } = await runDocker([
    "volume",
    "inspect",
    name,
    "--format",
    '{{index .Labels "com.docker.compose.project"}}',
  ]);
  return code === 0 && output.trim() === project;
}

/** Names of running containers currently using the volume. */
export async function runningContainersUsingVolume(name: string): Promise<string[]> {
  const { code, output } = await runDocker([
    "ps",
    "--filter",
    `volume=${name}`,
    "--format",
    "{{.Names}}",
  ]);
  if (code !== 0) throw new Error(`docker ps failed: ${output.trim()}`);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export const VOLUME_IN_USE_ERROR =
  "ボリュームを使用中のコンテナが実行中です。「停止(保持)」してからインポートしてください。";

/**
 * Start streaming the volume's contents as tar.gz. The caller pipes `stdout`
 * to the HTTP response and calls `kill` if the client disconnects.
 */
export function exportVolumeStream(name: string): { stdout: Readable; kill: () => void } {
  const child = spawn("docker", [
    "run",
    "--rm",
    "-v",
    `${name}:/data:ro`,
    env.PREVIEW_VOLUME_HELPER_IMAGE,
    "sh",
    "-c",
    "cd /data && tar cf - . | gzip",
  ]);
  // stderr(pullの進捗やエラー)がレスポンスに混ざらないよう捨てる。失敗時は
  // gzipストリームが途中で終わり、クライアント側の展開が失敗する形で顕在化する。
  child.stderr.resume();
  return {
    stdout: child.stdout,
    kill: () => child.kill("SIGKILL"),
  };
}

/**
 * Import a tar.gz archive into a volume, replacing its entire contents. Runs
 * as a background job: verifies the archive BEFORE wiping the volume so a
 * corrupt upload never destroys existing data. The staging file is always
 * deleted afterwards.
 */
export async function importVolume(
  previewId: string,
  volume: string,
  archivePath: string,
): Promise<void> {
  const log = (line: string) => emitPreviewLog(previewId, line);
  try {
    const preview = await prisma.previewEnvironment.findUnique({ where: { id: previewId } });
    if (!preview) throw new Error("Preview environment not found");
    if (!(await volumeBelongsToProject(volume, preview.composeProject))) {
      throw new Error("このプレビューのボリュームではありません");
    }
    // start時にも確認しているが、アップロード中にコンテナが起動された場合に備えて
    // 破壊的処理の直前で再確認する。
    const users = await runningContainersUsingVolume(volume);
    if (users.length > 0) {
      throw new Error(`${VOLUME_IN_USE_ERROR}(${users.join(", ")})`);
    }

    log(`Importing archive into volume ${volume}...`);
    log("Verifying archive...");
    const verify = await runDocker(
      [
        "run",
        "--rm",
        "-i",
        env.PREVIEW_VOLUME_HELPER_IMAGE,
        "sh",
        "-c",
        "gzip -dc | tar tf - > /dev/null",
      ],
      { stdinFile: archivePath },
    );
    if (verify.code !== 0) {
      throw new Error(
        `アーカイブの検証に失敗しました(tar.gz形式か確認してください): ${verify.output.trim()}`,
      );
    }

    log("Clearing volume...");
    const wipe = await runDocker([
      "run",
      "--rm",
      "-v",
      `${volume}:/data`,
      env.PREVIEW_VOLUME_HELPER_IMAGE,
      "sh",
      "-c",
      "find /data -mindepth 1 -delete",
    ]);
    if (wipe.code !== 0) throw new Error(`ボリュームの初期化に失敗しました: ${wipe.output.trim()}`);

    log("Restoring archive into volume...");
    const restore = await runDocker(
      [
        "run",
        "--rm",
        "-i",
        "-v",
        `${volume}:/data`,
        env.PREVIEW_VOLUME_HELPER_IMAGE,
        "sh",
        "-c",
        "gzip -dc | tar xf - -C /data",
      ],
      { stdinFile: archivePath },
    );
    if (restore.code !== 0) throw new Error(`インポートに失敗しました: ${restore.output.trim()}`);

    log(`Volume ${volume} imported successfully.`);
  } catch (e) {
    log(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  } finally {
    await rm(archivePath, { force: true });
  }
}
