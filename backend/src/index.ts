import { createApp } from "./server.js";

const PORT = Number(process.env.PORT ?? process.env.SKILL_SMITH_PORT ?? 4000);

const { app, ctx } = createApp();

app.listen(PORT, () => {
  // stderr-style startup log; the frontend talks to /api on this port.
  console.log(`[skill-smith] backend listening on http://localhost:${PORT}`);
  console.log(`[skill-smith] model=${ctx.config.model} workspace=${ctx.config.workspaceDir}`);
  console.log(`[skill-smith] max-parallelism=${ctx.config.maxParallelism} per-job-ceiling=${ctx.config.perJobInvocationCeiling}`);
});
