'use client';

/**
 * The same refusal, said the same way, on both pages of the section. Kept beside them rather
 * than turned into a global error banner: what a person should do about it is specific to this
 * section, and a generic one would lose that.
 */
export function ServiceOrderFailure({ message, testId }: { message: string; testId: string }) {
  return (
    <p
      role="alert"
      data-testid={testId}
      className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200"
    >
      {message}
    </p>
  );
}
