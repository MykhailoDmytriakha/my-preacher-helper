import { requestUserSettings } from '@/services/userSettingsTransport.client';
const HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const LAST_SEEN_STORAGE_KEY_PREFIX = 'my-preacher-helper:last-seen-at:';

/**
 * Records a best-effort activity heartbeat without delaying the UI.
 * The server supplies lastSeenAt through the shared settings protocol. This remains
 * optional admin information and never influences authorization or entitlements.
 */
export function recordLastSeen(userId: string): void {
  if (typeof window === 'undefined' || !userId) return;

  try {
    const now = Date.now();
    const storageKey = `${LAST_SEEN_STORAGE_KEY_PREFIX}${userId}`;
    const lastHeartbeatAt = Number(window.localStorage.getItem(storageKey));

    if (
      Number.isFinite(lastHeartbeatAt)
      && lastHeartbeatAt > 0
      && now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS
    ) {
      return;
    }

    // Reserve this device's throttle window before starting the async write so
    // repeated auth callbacks cannot race into duplicate heartbeats.
    window.localStorage.setItem(storageKey, String(now));
    void requestUserSettings(userId, { operation: 'heartbeat', patch: {} }).catch(() => {
      // Best-effort/offline-safe admin metadata must never surface into the UI.
    });
  } catch {
    // localStorage can be unavailable in privacy modes; this signal is optional.
  }
}
