import type { FailureAddress } from './types';

export interface AddressedFailure {
  error: unknown;
  /** The document or collection the failed work was for; absent when it was for nothing in particular. */
  about?: FailureAddress;
}

/**
 * FAILURES GATHERED FROM MANY OPERATIONS KEEP WHAT EACH WAS ABOUT
 * (BUG-20261003-background-failure-without-address).
 *
 * A drain advances many requests and a retry repairs many editors; their failures used to leave
 * as one error about nothing in particular, and every screen waiting for something else was told.
 * They leave as a list instead, each with its own address. The object is made fresh for each
 * gathering and the original errors are not touched: storage hands one cached rejection to many
 * operations, so a mark on the error itself would end up on another document's failure.
 *
 * It speaks with the first failure's words and code, so a person whose Retry failed reads what
 * they read before.
 */
export class AddressedFailures extends Error {
  readonly failures: readonly AddressedFailure[];
  readonly code?: string;

  constructor(failures: readonly AddressedFailure[]) {
    const first = failures[0]?.error;
    super(first instanceof Error ? first.message : 'Background work failed', { cause: first });
    this.name = 'AddressedFailures';
    this.failures = failures;
    const code = (first as { code?: unknown } | undefined)?.code;
    if (typeof code === 'string') this.code = code;
  }
}

/** Each failure with its address: the list's entries, or the error itself with the address given. */
export function eachFailure(error: unknown, about?: FailureAddress): AddressedFailure[] {
  return error instanceof AddressedFailures ? [...error.failures] : [{ error, ...(about ? { about } : {}) }];
}
