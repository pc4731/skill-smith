import { createApp } from "./server.js";
import { reconcileOrphans } from "./runtime/reconcile.js";

const PORT = Number(process.env.PORT ?? process.env.SKILL_SMITH_PORT ?? 4000);

const { app, ctx } = createApp();
const HOST = process.env.SKILL_SMITH_HOST ?? ctx.config.host;

async function main(): Promise<void> {
  // In-memory stage runners don't survive a restart: auto-resume interrupted
  // research/generate/test jobs from disk, and flip any other interrupted job to failed.
  const { reconciled, resumed } = await reconcileOrphans(ctx).catch(() => ({ reconciled: 0, resumed: 0 }));
  if (resumed > 0) console.log(`[skill-smith] auto-resumed ${resumed} interrupted job(s) after restart`);
  if (reconciled > 0) console.log(`[skill-smith] reconciled ${reconciled} interrupted job(s) after restart`);

  app.listen(PORT, HOST, () => {
    // Binds to localhost by default so the cost-incurring API isn't exposed on all interfaces.
    console.log(`[skill-smith] backend listening on http://${HOST}:${PORT}`);
    console.log(`[skill-smith] model=${ctx.config.model} workspace=${ctx.config.workspaceDir}`);
    console.log(`[skill-smith] max-parallelism=${ctx.config.maxParallelism} per-job-ceiling=${ctx.config.perJobInvocationCeiling} daily-ceiling=${ctx.config.globalDailyInvocationCeiling || "unlimited"}`);
  });
}

void main();
