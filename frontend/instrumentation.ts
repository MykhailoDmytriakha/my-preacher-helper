export async function register() {
  if (typeof window !== 'undefined') return;
  if (!process.stdout?.write || !process.stderr?.write) return;

  const ts = () => `[${new Date().toISOString().replace('T', ' ').slice(0, 23)}]`;
  const hasTs = /^\[20\d\d-/;

  const addTs = (chunk: string | Uint8Array): string | Uint8Array => {
    if (typeof chunk !== 'string') return chunk;
    return chunk.replace(/^.+$/gm, (line) => (hasTs.test(line) ? line : `${ts()} ${line}`));
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch = (orig: (...args: any[]) => boolean) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function (this: unknown, chunk: string | Uint8Array, ...rest: any[]): boolean {
      return orig.call(this, addTs(chunk), ...rest);
    };

  process.stdout.write = patch(process.stdout.write) as typeof process.stdout.write;
  process.stderr.write = patch(process.stderr.write) as typeof process.stderr.write;
}
