import { prisma } from "../db/client";

export type JobType = "build" | "destroy" | "restart";

export interface JobPayload {
  pullRequestId: string;
}

/** Enqueue a background job for the worker to process. */
export async function enqueueJob(type: JobType, payload: JobPayload): Promise<string> {
  const job = await prisma.job.create({
    data: { type, payload: JSON.stringify(payload), status: "queued" },
  });
  return job.id;
}
