'use client';

import { useSermonsDataCollection } from '@/hooks/useSermonsDataCollection';

import type { Sermon } from '@/models/models';

/**
 * THERE IS NO SERMON TO SHOW HERE — one definition, because two screens ask.
 *
 * The detail page renders its "not found" panel from this, and the app nav decides from the
 * same answer whether to draw the sermon mode switcher (prep / classic / raw). Those modes
 * belong to a sermon; over an empty screen they are three buttons that lead nowhere.
 *
 * "Missing" is deliberately narrower than "no sermon in hand": while the read can still
 * arrive, the answer is not in yet and nothing may be concluded from the silence.
 *
 * It is a TYPE PREDICATE so the caller keeps the narrowing a plain `!sermon` check gives.
 */
export const sermonIsMissing = (
  sermon: Sermon | null,
  state: { loading: boolean; awaitingFirstAnswer: boolean }
): sermon is null => !state.loading && !state.awaitingFirstAnswer && !sermon;

/**
 * Read-only chrome (breadcrumbs, the mode switcher, the audio wizard) must not open its own
 * editable copy of the sermon: it reads the engine's collection on this device. A sermon absent
 * from a collection that was never received whole is still awaited, not missing.
 */
export function useSermonRead(sermonId: string) {
  const engine = useSermonsDataCollection(Boolean(sermonId));
  const sermon = sermonId ? engine.sermons.find(item => item.id === sermonId) ?? null : null;
  return {
    sermon,
    loading: Boolean(sermonId) && engine.loading,
    awaitingFirstAnswer: Boolean(sermonId) && !sermon && !engine.complete,
  };
}
