export class AiResultPendingError extends Error {
  constructor(cause?: unknown) {
    super('The AI operation is still pending', { cause });
    this.name = 'AiResultPendingError';
  }
}

export class AiResultUnavailableError extends Error {
  constructor() {
    super('The AI operation ended without a recoverable result');
    this.name = 'AiResultUnavailableError';
  }
}

export class AiResultReceiptConflict extends Error {
  constructor() {
    super('The AI operation does not match the original request');
    this.name = 'AiResultReceiptConflict';
  }
}

export function isAiResultRecoveryError(error: unknown): boolean {
  return error instanceof AiResultPendingError ||
    error instanceof AiResultUnavailableError ||
    error instanceof AiResultReceiptConflict;
}
