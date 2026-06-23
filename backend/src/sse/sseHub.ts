import type { Response } from "express";

interface BufferedEvent {
  name: string;
  data: unknown;
}

/**
 * Per-job Server-Sent-Events fan-out.
 *
 * A bounded ring buffer of recent events is kept per job so a browser that
 * connects late (or reconnects after a refresh) is replayed the current state,
 * then receives live events. The buffer is a convenience cache only — the
 * authoritative state is always job.json on disk.
 */
export class SseHub {
  private clients = new Map<string, Set<Response>>();
  private buffers = new Map<string, BufferedEvent[]>();
  private heartbeat?: NodeJS.Timeout;

  constructor(private readonly bufferLimit = 2000, heartbeatMs = 15000) {
    if (heartbeatMs > 0) {
      this.heartbeat = setInterval(() => this.ping(), heartbeatMs);
      this.heartbeat.unref?.();
    }
  }

  /** Attach a response as an SSE stream for a job; replays the buffer first. */
  subscribe(jobId: string, res: Response): () => void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    for (const ev of this.buffers.get(jobId) ?? []) {
      this.writeFrame(res, ev.name, ev.data);
    }

    let set = this.clients.get(jobId);
    if (!set) {
      set = new Set();
      this.clients.set(jobId, set);
    }
    set.add(res);

    const cleanup = () => {
      this.clients.get(jobId)?.delete(res);
    };
    res.on("close", cleanup);
    return cleanup;
  }

  /** Buffer and broadcast an event to all subscribers of a job. */
  broadcast(jobId: string, name: string, data: unknown): void {
    const buf = this.buffers.get(jobId) ?? [];
    buf.push({ name, data });
    if (buf.length > this.bufferLimit) buf.splice(0, buf.length - this.bufferLimit);
    this.buffers.set(jobId, buf);

    for (const res of this.clients.get(jobId) ?? []) {
      this.writeFrame(res, name, data);
    }
  }

  /** Drop the buffer for a job (e.g. on delete). */
  clear(jobId: string): void {
    this.buffers.delete(jobId);
    this.clients.delete(jobId);
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
  }

  private writeFrame(res: Response, name: string, data: unknown): void {
    try {
      res.write(`event: ${name}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* client gone; close handler will clean up */
    }
  }

  private ping(): void {
    for (const set of this.clients.values()) {
      for (const res of set) {
        try {
          res.write(": ping\n\n");
        } catch {
          /* ignore */
        }
      }
    }
  }
}
