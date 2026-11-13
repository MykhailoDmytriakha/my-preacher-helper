/** The whole answer — headers and body — within the deadline, or an error; a silent network never hangs the reader. */
export async function fetchBibleJson(fetchFn: typeof fetch, url: string, deadlineMs: number): Promise<{ response: Response; data: unknown }> {
  const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error(`No answer within ${deadlineMs} ms: ${url}`));
    }, deadlineMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchFn(url, controller ? { signal: controller.signal } : undefined);
        const data: unknown = response.ok ? await response.clone().json().catch(() => undefined) : undefined;
        return { response, data };
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
