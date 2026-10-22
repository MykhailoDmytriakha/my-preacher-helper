interface CaptureAttempt {
  run(): Promise<unknown>;
  retire(): void;
  failed: boolean;
}

/**
 * Remember an explicit Save until its owner transfers it to the canonical request.
 * The owner supplies serialization; this has no runner, storage or delivery policy.
 */
export class CaptureContinuations {
  private attempts = new Set<CaptureAttempt>();

  get pending(): boolean { return this.attempts.size > 0; }
  get failed(): boolean { return [...this.attempts].some(attempt => attempt.failed); }
  /** Queued or running captures still own the checkpoint; a failed capture must not block later drafts. */
  get capturing(): boolean { return [...this.attempts].some(attempt => !attempt.failed); }

  register<T>(operation: (captured: () => void) => Promise<T>): () => Promise<T> {
    let running: Promise<T> | null = null;
    let captured = false, retired = false;
    const run = (): Promise<T> => {
      if (running) return running;
      if (retired) return Promise.reject(new Error('The Save capture was retired'));
      const predecessors = [...this.attempts];
      running = (async () => {
        // Later explicit Saves cannot pass an earlier failed capture.
        for (const predecessor of predecessors) {
          if (predecessor === attempt) break;
          await predecessor.run();
        }
        if (retired) throw new Error('The Save capture was retired');
        attempt.failed = false;
        return operation(() => {
          captured = true;
          attempt.failed = false;
          this.attempts.delete(attempt);
        });
      })();
      void running.catch(() => {
        if (!captured && !retired) { attempt.failed = true; running = null; }
      });
      return running;
    };
    const attempt: CaptureAttempt = { run, failed: false, retire: () => { retired = true; this.attempts.delete(attempt); } };
    this.attempts.add(attempt);
    return run;
  }

  async retry(): Promise<void> {
    for (const attempt of [...this.attempts]) await attempt.run();
  }

  /** Capture this boundary before an asynchronous explicit choice, preserving later Saves. */
  boundary(): ReadonlySet<object> { return new Set(this.attempts); }

  retire(boundary: ReadonlySet<object> = this.boundary()): void {
    for (const attempt of this.attempts) if (boundary.has(attempt)) attempt.retire();
  }
}
