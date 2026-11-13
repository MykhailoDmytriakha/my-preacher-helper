export class BibleAssetHttpError extends Error {
  readonly retryWhileReachable: boolean;

  constructor(message: string, response: Response) {
    super(message);
    this.retryWhileReachable = response.status === 503;
  }
}

export class BibleAssetDeadlineError extends Error {}

/** The whole answer — headers and body — within the deadline, or an error; a silent network never hangs the reader. */
export async function fetchBibleJson(fetchFn: typeof fetch, url: string, deadlineMs: number): Promise<{ response: Response; data: unknown }> {
  const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new BibleAssetDeadlineError(`No answer within ${deadlineMs} ms: ${url}`));
    }, deadlineMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchFn(url, controller ? { signal: controller.signal } : undefined);
        if (!response.ok) return { response, data: undefined };
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
