import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJobStream } from "../hooks/useJobStream.js";
import type { Job } from "../types.js";

/** A controllable EventSource stand-in for tests. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners: Record<string, Array<(ev: { data: string }) => void>> = {};
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, cb: (ev: { data: string }) => void) {
    (this.listeners[name] ||= []).push(cb);
  }
  emit(name: string, data: unknown) {
    for (const cb of this.listeners[name] ?? []) cb({ data: JSON.stringify(data) });
  }
  close() {}
  static last() {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }
}

const sampleJob: Job = {
  id: "j1",
  kind: "skill",
  status: "active",
  description: "persist me",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  stages: [
    { key: "scope", status: "running" },
    { key: "research", status: "pending" },
    { key: "design", status: "pending" },
    { key: "generate", status: "pending" },
    { key: "test", status: "pending" },
    { key: "package", status: "pending" },
  ],
  meter: { calls: 0, inputTokens: 0, outputTokens: 0, totalCostUsd: 0, ceiling: 40, ceilingHit: false },
};

describe("useJobStream", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    (globalThis as any).EventSource = FakeEventSource;
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => sampleJob })) as any;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("seeds job state from GET on cold load (refresh-safety), then applies live SSE events", async () => {
    const { result } = renderHook(() => useJobStream("j1"));

    // Seeded from the backend via GET /api/jobs/:id — proves a cold load with only the URL works.
    await waitFor(() => expect(result.current.state.job?.id).toBe("j1"));
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe("/api/jobs/j1");

    // A live SSE 'stage' event updates the view.
    act(() => {
      FakeEventSource.last().emit("stage", { stageKey: "scope", status: "awaiting_input" });
    });
    await waitFor(() =>
      expect(result.current.state.job?.stages.find((s) => s.key === "scope")?.status).toBe("awaiting_input"),
    );
  });

  it("appends streamed log lines from SSE", async () => {
    const { result } = renderHook(() => useJobStream("j1"));
    await waitFor(() => expect(result.current.state.job?.id).toBe("j1"));
    act(() => {
      FakeEventSource.last().emit("log", { stageKey: "scope", text: "hi there" });
    });
    await waitFor(() => expect(result.current.state.consoleLines.some((l) => l.text === "hi there")).toBe(true));
  });
});
