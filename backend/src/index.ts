import { createApp } from "./server.js";

const PORT = Number(process.env.PORT ?? process.env.SKILL_SMITH_PORT ?? 4000);

const { app, ctx } = createApp();
const HOST = process.env.SKILL_SMITH_HOST ?? ctx.config.host;

app.listen(PORT, HOST, () => {
  // Binds to localhost by default so the cost-incurring API isn't exposed on all interfaces.
  console.log(`[skill-smith] backend listening on http://${HOST}:${PORT}`);
  console.log(`[skill-smith] model=${ctx.config.model} workspace=${ctx.config.workspaceDir}`);
  console.log(`[skill-smith] max-parallelism=${ctx.config.maxParallelism} per-job-ceiling=${ctx.config.perJobInvocationCeiling} daily-ceiling=${ctx.config.globalDailyInvocationCeiling || "unlimited"}`);
});
