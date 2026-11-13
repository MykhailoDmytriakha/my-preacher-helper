import { isBibleAssetNetworkFailure } from './bibleAssetResponse';

export class BibleAssetHttpError extends Error {
  readonly retryWhileReachable: boolean;
  readonly networkFailure: boolean;

  constructor(message: string, response: Response) {
    super(message);
    this.retryWhileReachable = response.status === 503;
    this.networkFailure = isBibleAssetNetworkFailure(response);
  }
}

export class BibleAssetDeadlineError extends Error {}

export function canRetryBibleAsset(error: unknown): boolean {
  return error instanceof TypeError || error instanceof BibleAssetDeadlineError
    || (error instanceof BibleAssetHttpError && error.retryWhileReachable);
}

/** The whole answer — headers and body — within the deadline, or an error; a silent network never hangs the reader. */
export async function fetchBibleJson(fetchFn: typeof fetch, url: string, deadlineMs: number, bodyDeadlineMs?: number): Promise<{ response: Response; data: unknown }> {
  const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expire!: (error: BibleAssetDeadlineError) => void;
  const deadline = new Promise<never>((_, reject) => { expire = reject; });
  const wait = (milliseconds: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      controller?.abort();
      expire(new BibleAssetDeadlineError(`No answer within ${milliseconds} ms: ${url}`));
    }, milliseconds);
  };
  wait(deadlineMs);
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchFn(url, controller ? { signal: controller.signal } : undefined);
        if (!response.ok) return { response, data: undefined };
        if (controller?.signal.aborted) throw controller.signal.reason;
        if (bodyDeadlineMs !== undefined) wait(bodyDeadlineMs);
        const data: unknown = await response.clone().json().catch((error: unknown) => {
          if (!(error instanceof TypeError)) return undefined;
          // Headers arrived, but the stream failed. Use the original request's connectivity report.
          controller?.abort(error);
          throw error;
        });
        return { response, data };
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
