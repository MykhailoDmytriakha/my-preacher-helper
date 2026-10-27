/**
 * Whether this machine says its shortcuts with ⌘ (a Mac, an iPad with a keyboard) or with Ctrl (Windows, Linux, a
 * Chromebook): the people of this app work on all of them, and a hint speaks the words of the keyboard in front of them.
 */
export function usesCommandKey(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** A shortcut as this machine's keyboard writes it: «⌘C» or «Ctrl+C». */
export const withModifier = (key: string): string => (usesCommandKey() ? `⌘${key}` : `Ctrl+${key}`);
