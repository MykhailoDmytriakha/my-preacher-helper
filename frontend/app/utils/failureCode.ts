/** Technical exceptions carry diagnostics, not instructions for the person. */
export const TECHNICAL_FAILURE = 'technical-failure';

/** An adapter's own technical fallback when the browser provided no native exception. */
export class TechnicalFailure extends Error {
  readonly code = TECHNICAL_FAILURE;
}

export function isTechnicalFailure(error: unknown): boolean {
  return error instanceof TechnicalFailure
    || (typeof DOMException !== 'undefined' && error instanceof DOMException)
    || [TypeError, RangeError, ReferenceError, SyntaxError, URIError, EvalError].some(type => error instanceof type);
}

/** Preserve explicit domain codes; retain a native exception's category across plain state. */
export function failureCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code;
  return isTechnicalFailure(error) ? TECHNICAL_FAILURE : null;
}
