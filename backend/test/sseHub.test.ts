import type { Response } from "express";
import { describe, expect, it } from "vitest";
import { SseHub } from "../src/sse/sseHub.js";

/** Minimal fake of the bits of express.Response the hub touches. */
function fakeRes() {
  const frames: string[] = [];
  const headers: Record<string, string> = {};
  const handlers: Record<string, () => void> = {};
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    flushHeaders: () => {},
    write: (s: string) => {
      frames.push(s);
      return true;
    },
    on: (ev: string, cb: () => void) => {
      handlers[ev] = cb;
    },
  } as unknown as Response;
  return { res, frames, headers, handlers };
}

describe("SseHub", () => {
  it("replays buffered events to a late subscriber, then streams live ones", () => {
    const hub = new SseHub(2000, 0);
    hub.broadcast("job-1", "stage", { stageKey: "scope", status: "running" });

    const { res, frames } = fakeRes();
    hub.subscribe("job-1", res); // should replay the earlier event
    expect(frames.join("")).toContain("event: stage");

    hub.broadcast("job-1", "log", { text: "hello" });
    expect(frames.join("")).toContain("event: log");
    expect(frames.join("")).toContain("hello");
    hub.close();
  });

  it("sets the SSE content-type header on subscribe", () => {
    const hub = new SseHub(2000, 0);
    const { res, headers } = fakeRes();
    hub.subscribe("j", res);
    expect(headers["Content-Type"]).toBe("text/event-stream");
    hub.close();
  });
});
