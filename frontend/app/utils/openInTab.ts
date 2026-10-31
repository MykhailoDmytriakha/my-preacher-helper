/*
 * WHETHER SOMETHING IS OPEN IN A TAB OF THIS BROWSER — a Web Lock held while it is open (Codex, 31.10: «Новая проповедь»
 * open in two tabs — the second one's clean-up cancelled the sermon being written in the first). A lock goes with its tab:
 * a closed or crashed tab holds nothing, so what no tab holds was left by a page that is gone. Without the Web Locks API
 * nothing is known, and the caller takes it as «may be open».
 */
const supported = (): boolean => typeof navigator !== 'undefined' && Boolean(navigator.locks);

/** Holds `name` while something is open in this tab; the returned function lets it go. */
export function holdWhileOpen(name: string): () => void {
  if (!supported()) return () => undefined;
  let release: () => void = () => undefined;
  const open = new Promise<void>((resolve) => { release = resolve; });
  void navigator.locks.request(name, () => open).catch(() => undefined);
  return release;
}

/** True when `name` is held — open in a tab of this browser; null when this browser cannot tell. */
export async function heldInSomeTab(name: string): Promise<boolean | null> {
  if (!supported()) return null;
  try {
    const { held = [] } = await navigator.locks.query();
    return held.some((lock) => lock.name === name);
  } catch {
    return null;
  }
}
