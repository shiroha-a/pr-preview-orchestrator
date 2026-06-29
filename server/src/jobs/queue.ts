import { prisma } from "../db/client";

export type JobType = "build" | "destroy" | "restart";

export interface JobPayload {
  /** The preview environment this job operates on (PR or branch, issue #25). */
  previewId: string;
  /** When true, rebuild Docker images without using the build cache (issue #20). */
  noCache?: boolean;
}

/** Enqueue a background job for the worker to process. */
export async function enqueueJob(type: JobType, payload: JobPayload): Promise<string> {
  const job = await prisma.job.create({
    data: { type, payload: JSON.stringify(payload), status: "queued" },
  });
  return job.id;
}
