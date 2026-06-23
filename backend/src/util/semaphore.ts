/** A minimal counting semaphore to bound concurrent claude invocations. */
export class Semaphore {
  private available: number;
  private waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.available = Math.max(1, permits);
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return this.release();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.available -= 1;
    return this.release();
  }

  private release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.available += 1;
      const next = this.waiters.shift();
      if (next) next();
    };
  }

  /** Run `fn` while holding a permit. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
