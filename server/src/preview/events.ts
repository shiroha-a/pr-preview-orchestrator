import { EventEmitter } from "node:events";

export interface PreviewEvent {
  type: "log" | "status";
  status?: string;
  line?: string;
  at: string;
}

/**
 * In-process pub/sub bus for preview build logs and status changes. The SSE
 * route subscribes per preview id; the worker publishes as it runs.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0);

export function subscribePreview(
  previewId: string,
  listener: (event: PreviewEvent) => void,
): () => void {
  bus.on(previewId, listener);
  return () => {
    bus.off(previewId, listener);
  };
}

export function emitPreviewLog(previewId: string, line: string): void {
  bus.emit(previewId, { type: "log", line, at: new Date().toISOString() } satisfies PreviewEvent);
}

export function emitPreviewStatus(previewId: string, status: string): void {
  bus.emit(previewId, {
    type: "status",
    status,
    at: new Date().toISOString(),
  } satisfies PreviewEvent);
}
