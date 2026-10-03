/**
 * WHAT A FAILED ACTION SAYS ON SCREEN (.howto/show-an-error-once.md).
 *
 * A read-only refusal (`code: 'read-only'`) already speaks the interface language — it explains that
 * device storage is not answering. Any other error carries a sentence written for developers, so the
 * action's own translated line stands in for it and the original goes to the console.
 */
export function actionFailureMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && (error as { code?: unknown }).code === 'read-only' && error.message) return error.message;
  console.error(error);
  return fallback;
}
