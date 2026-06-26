import fsp from "node:fs/promises";
import path from "node:path";
import type { LibrarySkill, SkillPlanItem } from "../jobs/types.js";

/** Minimum overlap score (0–1) for an existing skill to count as a reuse match. */
export const REUSE_THRESHOLD = 0.5;

const STOP = new Set([
  "the", "a", "an", "and", "or", "for", "with", "this", "that", "skill", "use",
  "when", "to", "of", "in", "on", "its", "it", "covers", "only", "not", "trigger",
]);

/** Lowercase, split on non-alphanumerics, drop stop-words and 1-char tokens. */
function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length > 1 && !STOP.has(raw)) out.add(raw);
  }
  return out;
}

/**
 * Deterministic relevance score in [0,1] between a planned skill and an existing
 * library skill. Overlap is normalised by the smaller token set so a short, focused
 * skill can still strongly match a longer one. No LLM call — free and predictable.
 */
export function matchScore(target: SkillPlanItem, lib: LibrarySkill): number {
  const t = tokenize([target.name, target.slug, target.scopeBoundaries, ...target.sourceDomains].join(" "));
  const l = tokenize([lib.name, lib.slug, lib.description].join(" "));
  if (t.size === 0 || l.size === 0) return 0;
  let inter = 0;
  for (const tok of t) if (l.has(tok)) inter += 1;
  return inter / Math.min(t.size, l.size);
}

/**
 * Best reuse candidate for `target` from `library`, excluding the current job and
 * anything below the threshold. Returns the match plus its score, or null.
 */
export function bestMatch(
  target: SkillPlanItem,
  library: LibrarySkill[],
  excludeJobId: string,
): { skill: LibrarySkill; score: number } | null {
  let best: { skill: LibrarySkill; score: number } | null = null;
  for (const lib of library) {
    if (lib.jobId === excludeJobId) continue;
    const score = matchScore(target, lib);
    if (score >= REUSE_THRESHOLD && (!best || score > best.score)) best = { skill: lib, score };
  }
  return best;
}

/**
 * Copy a matched skill directory into `destDir` as a starting point ("seed").
 * The original is never touched. Returns true on success.
 */
export async function seedFromMatch(srcDir: string, destDir: string): Promise<boolean> {
  try {
    await fsp.rm(destDir, { recursive: true, force: true });
    await fsp.cp(srcDir, destDir, { recursive: true });
    // Drop any prior self-test report so the adapted skill is re-validated cleanly.
    await fsp.rm(path.join(destDir, "report.json"), { force: true }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
