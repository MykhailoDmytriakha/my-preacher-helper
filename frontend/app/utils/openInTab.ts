/*
 * WHETHER SOMETHING IS OPEN IN A TAB OF THIS BROWSER — a Web Lock held while it is open (Codex, 31.10: «Новая проповедь»
 * open in two tabs — the second one's clean-up cancelled the sermon being written in the first). A lock goes with its tab:
 * a closed or crashed tab holds nothing, so what no tab holds was left by a page that is gone. Without the Web Locks API
 * nothing is known, and the caller takes it as «may be open».
 */
const supported = (): boolean => typeof navigator !== 'undefined' && Boolean(navigator.locks);

/** Holds `name` while something is open in this tab; the returned function lets it go. */
export function holdWhileOpen(name: string): () => void {
  const release = holdUntilReleased(name);
  return () => { void release(); };
}

/**
 * Holds `name` like `holdWhileOpen`; the promise of the returned function settles once the lock is
 * really released — from then on other tabs asking about it see it gone.
 */
export function holdUntilReleased(name: string): () => Promise<void> {
  if (!supported()) return () => Promise.resolve();
  let release: () => void = () => undefined;
  const open = new Promise<void>((resolve) => { release = resolve; });
  const gone = navigator.locks.request(name, () => open).then(() => undefined, () => undefined);
  return () => { release(); return gone; };
}

/** The names held in some tab of this browser right now; null when this browser cannot tell. */
async function heldNames(): Promise<string[] | null> {
  if (!supported()) return null;
  try {
    const { held = [] } = await navigator.locks.query();
    return held.map((lock) => lock.name).filter((name): name is string => typeof name === 'string');
  } catch {
    return null;
  }
}

/** The names held in some tab of this browser right now; empty when this browser cannot tell. */
export async function heldLockNames(): Promise<string[]> {
  return (await heldNames()) ?? [];
}

/** True when `name` is held — open in a tab of this browser; null when this browser cannot tell. */
export async function heldInSomeTab(name: string): Promise<boolean | null> {
  const held = await heldNames();
  return held && held.includes(name);
}
