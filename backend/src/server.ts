import express, { type Express } from "express";
import { buildContext, type AppContext, type BuildContextOptions } from "./context.js";
import { createRouter } from "./routes/index.js";

export interface AppHandle {
  app: Express;
  ctx: AppContext;
}

/** Build the Express app (does not call listen — tests import this directly). */
export function createApp(opts: BuildContextOptions = {}): AppHandle {
  const ctx = buildContext(opts);
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", createRouter(ctx));
  return { app, ctx };
}
