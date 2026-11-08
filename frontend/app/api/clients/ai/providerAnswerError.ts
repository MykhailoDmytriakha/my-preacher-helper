/** The provider accepted the request and started a successful response. Its cost is unknown. */
export class ProviderAnswerError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'ProviderAnswerError';
    this.cause = cause;
  }
}

/** The chain can wrap the interrupted answer in its own deadline error. */
export function providerStartedAnswer(error: unknown): boolean {
  return error instanceof ProviderAnswerError
    || (error instanceof Error && 'cause' in error && error.cause instanceof ProviderAnswerError);
}

/** Call only once the HTTP request has returned successful headers. */
export async function readStartedProviderAnswer<T>(read: () => PromiseLike<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new ProviderAnswerError(error);
  }
}

/** The SDK exposes headers before it parses the same response's body. */
export async function readProviderAnswer<T>(
  completion: PromiseLike<T> & { asResponse(): Promise<unknown> },
  check?: (answer: T) => void,
): Promise<T> {
  await completion.asResponse();
  return readStartedProviderAnswer(async () => {
    const answer = await completion;
    check?.(answer);
    return answer;
  });
}
