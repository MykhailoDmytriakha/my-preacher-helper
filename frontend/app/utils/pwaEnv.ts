/**
 * Detects whether the app is running as an installed PWA (standalone display mode)
 * or inside a regular browser tab.
 */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    Boolean((navigator as Navigator & { standalone?: boolean })?.standalone)
  );
}

/**
 * Detects whether the current device is an iPad.
 * Modern iPadOS (13+) reports userAgent as Macintosh with touch support (maxTouchPoints > 1),
 * while older iPads or mobile user-agent configurations include 'iPad'.
 */
export function isIPadDevice(
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  maxTouchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0
): boolean {
  if (!userAgent && maxTouchPoints <= 0) return false;
  const hasIPadUa = /iPad/i.test(userAgent);
  const isIPadOsDesktopUa = /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
  return hasIPadUa || isIPadOsDesktopUa;
}

/**
 * Convenience check for iPad running in standalone PWA mode.
 * On iPadOS PWA, native pull-to-refresh is disabled by WebKit and there is no
 * browser reload button in the address bar.
 */
export function isIPadStandalonePwa(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return isIPadDevice() && isStandalonePwa();
}
