import { Router, type Request, type Response } from "express";
import type { AppContext } from "../context.js";
import { emitJob } from "../runtime/broadcast.js";
import { runSayHi } from "../runtime/sayHi.js";
import { applyAnswers, runStage0 } from "../stages/stage0Scope.js";

export function createRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true, model: ctx.config.model });
  });

  // Create a job and kick off Stage 0 scoping (runs in the background).
  router.post("/jobs", async (req: Request, res: Response) => {
    const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
    if (!description) {
      res.status(400).json({ error: "description is required" });
      return;
    }
    const job = await ctx.jobStore.create({
      description,
      kind: "skill",
      ceiling: ctx.config.perJobInvocationCeiling,
    });
    await emitJob(ctx, job);
    void runStage0(ctx, job.id);
    res.status(201).json({ id: job.id });
  });

  // The round-trip proof: `claude -p "say hi"` streamed live.
  router.post("/say-hi", async (_req: Request, res: Response) => {
    const job = await ctx.jobStore.create({
      description: 'Round-trip proof: claude -p "say hi"',
      kind: "sayhi",
      ceiling: ctx.config.perJobInvocationCeiling,
    });
    await emitJob(ctx, job);
    void runSayHi(ctx, job.id);
    res.status(201).json({ id: job.id });
  });

  router.get("/jobs", async (_req, res) => {
    const jobs = await ctx.jobStore.list();
    res.json(jobs);
  });

  router.get("/jobs/:id", async (req, res) => {
    const job = await ctx.jobStore.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    res.json(job);
  });

  // SSE stream — replays buffered events then streams live ones.
  router.get("/jobs/:id/stream", async (req, res) => {
    const job = await ctx.jobStore.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    ctx.sse.subscribe(req.params.id, res);
    // Seed the connection with the authoritative snapshot.
    ctx.sse.broadcast(req.params.id, "job", job);
  });

  router.post("/jobs/:id/answers", async (req, res) => {
    const job = await ctx.jobStore.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    try {
      const useDefaults = req.body?.useDefaults === true;
      const answers = req.body?.answers as Record<string, string | string[]> | undefined;
      const scope = await applyAnswers(ctx, req.params.id, { useDefaults, answers });
      res.json({ ok: true, scope });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
