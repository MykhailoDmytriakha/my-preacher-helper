/** Bound reads that cannot be aborted (including Firestore and token acquisition). */
export async function readWithDeadline<T>(read: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Read timed out'), { code: 'deadline-exceeded' })), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
