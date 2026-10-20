/** Blocks concurrent button actions by one user on the same message. */
export class ButtonInteractionGuard {
  private readonly active = new Set<string>();

  constructor(private readonly cooldownMs = 1000) {}

  acquire(key: string): (() => void) | undefined {
    if (this.active.has(key)) return undefined;
    this.active.add(key);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      // Keep a short cooldown even when the handler finishes immediately.
      setTimeout(() => this.active.delete(key), this.cooldownMs).unref();
    };
  }
}
