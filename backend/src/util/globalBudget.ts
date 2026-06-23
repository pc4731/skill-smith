export interface BudgetSnapshot {
  /** UTC day (YYYY-MM-DD) the count applies to. */
  day: string;
  /** Invocations consumed today. */
  count: number;
  /** Daily ceiling (0 = unlimited). */
  ceiling: number;
}

/**
 * Process-wide guard on how many claude invocations may run per UTC day, so a
 * burst of jobs can't run up unbounded API cost. A ceiling of 0 disables it.
 * In-memory by design (resets on restart) — a coarse cost backstop, not billing.
 */
export class GlobalBudget {
  private day = today();
  private count = 0;

  constructor(private readonly ceiling: number) {}

  /** Reserve one invocation; returns false if that would exceed today's ceiling. */
  tryConsume(): boolean {
    this.rollover();
    if (this.ceiling > 0 && this.count >= this.ceiling) return false;
    this.count += 1;
    return true;
  }

  snapshot(): BudgetSnapshot {
    this.rollover();
    return { day: this.day, count: this.count, ceiling: this.ceiling };
  }

  private rollover(): void {
    const now = today();
    if (now !== this.day) {
      this.day = now;
      this.count = 0;
    }
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
