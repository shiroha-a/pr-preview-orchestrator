import { prisma } from "../db/client";

export type JobType = "build" | "destroy" | "restart" | "stop" | "volume-import";

export interface JobPayload {
  /** The preview environment this job operates on (PR or branch, issue #25). */
  previewId: string;
  /** When true, rebuild Docker images without using the build cache (issue #20). */
  noCache?: boolean;
  /** When true, destroy volumes before building for a fresh DB (issue #41). */
  resetVolumes?: boolean;
  /** When true, keep the existing tunnel/URL instead of creating a new one (issue #42). */
  keepTunnel?: boolean;
  /** Restart jobs: discard the tunnel and create a new one (URL changes; issue #58). */
  resetTunnel?: boolean;
  /** volume-import jobs: full docker volume name to import into (issue #61). */
  volume?: string;
  /** volume-import jobs: staging file holding the uploaded tar.gz (issue #61). */
  uploadPath?: string;
}

/** Enqueue a background job for the worker to process. */
export async function enqueueJob(type: JobType, payload: JobPayload): Promise<string> {
  const job = await prisma.job.create({
    data: { type, payload: JSON.stringify(payload), status: "queued" },
  });
  return job.id;
}
