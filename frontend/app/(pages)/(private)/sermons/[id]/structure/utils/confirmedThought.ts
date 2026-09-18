import type { Sermon, Thought } from '@/models/models';
import type { Dispatch, SetStateAction } from 'react';

/**
 * A WRITE THAT CHANGED A THOUGHT PUTS THE CONFIRMED THOUGHT BACK ON THE SERMON.
 *
 * Not bookkeeping — it is the screen's half of the freshness comparison. The banner that says
 * "edited on another device" compares the sermon the screen holds with the sermon the server
 * sent, and `sermon.thoughts` IS that held copy (see `sermonFreshnessProjection`, which
 * fingerprints each thought whole). A path that writes a thought and does not mirror the
 * result leaves the screen holding the pre-write version, so the server's answer differs for a
 * reason the screen itself caused — and the preacher, alone in one tab, is told his own move
 * was somebody else's edit. It never clears on its own, because nothing re-syncs that copy.
 *
 * The rule lived inline in the text-edit path only, which is why dragging a thought raised the
 * banner while retyping one did not. It lives here now, and every writer of a thought calls it.
 */
export function applyConfirmedThought(
  setSermon: Dispatch<SetStateAction<Sermon | null>>,
  confirmed: Thought,
): void {
  setSermon((previous) => (previous
    ? {
      ...previous,
      thoughts: previous.thoughts.map((thought) => (thought.id === confirmed.id ? confirmed : thought)),
    }
    : previous));
}
