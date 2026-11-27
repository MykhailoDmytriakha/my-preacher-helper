/** Report an asynchronous event failure without hiding it from the caller that owns the edit. */
export function observeRejection<T>(work: Promise<T>, onError: (error: unknown) => void = () => undefined): Promise<T> {
  void work.catch(onError);
  return work;
}
