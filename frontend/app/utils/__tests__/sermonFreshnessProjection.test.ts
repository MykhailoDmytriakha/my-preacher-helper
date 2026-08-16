import {
  planFreshnessProjection,
  sermonFreshnessProjection,
} from '@/utils/sermonFreshnessProjection';

/**
 * BUG-20260809-false-remote-edit-banner
 *
 * The preacher added a thought on his own device and immediately got the
 * "changed on another device" banner. The content was not different — the ORDER
 * was: Firestore appends a new thought to the end of the array (`arrayUnion`)
 * while the screen inserts it at the front. The freshness projection compared
 * position rather than content, so the two sides could never converge again.
 *
 * Array position carries no meaning for thoughts — the list is sorted by date on
 * screen. Outline order does carry meaning, and must stay visible.
 */
describe('sermonFreshnessProjection', () => {
  const thoughtA = { id: 'a', text: 'first thought', date: '2026-08-09T10:00:00.000Z', tags: [] };
  const thoughtB = { id: 'b', text: 'second thought', date: '2026-08-09T11:00:00.000Z', tags: [] };

  it('projects the same thoughts identically regardless of their order', () => {
    const asServerStoresIt = sermonFreshnessProjection({ thoughts: [thoughtA, thoughtB] });
    const asScreenHoldsIt = sermonFreshnessProjection({ thoughts: [thoughtB, thoughtA] });

    expect(asScreenHoldsIt.thoughts).toBe(asServerStoresIt.thoughts);
  });

  it('still notices a thought the screen does not have — otherwise there is nothing to warn about', () => {
    const withBoth = sermonFreshnessProjection({ thoughts: [thoughtA, thoughtB] });
    const withOne = sermonFreshnessProjection({ thoughts: [thoughtA] });

    expect(withOne.thoughts).not.toBe(withBoth.thoughts);
  });

  it('still notices edited text, even though the count and the set are the same', () => {
    const before = sermonFreshnessProjection({ thoughts: [thoughtA, thoughtB] });
    const after = sermonFreshnessProjection({
      thoughts: [thoughtA, { ...thoughtB, text: 'rewritten thought' }],
    });

    expect(after.thoughts).not.toBe(before.thoughts);
  });

  it('keeps outline order meaningful — reordering points there IS an edit', () => {
    const one = sermonFreshnessProjection({
      outline: { introduction: [{ id: 'p1', text: 'one' }, { id: 'p2', text: 'two' }] },
    });
    const reordered = sermonFreshnessProjection({
      outline: { introduction: [{ id: 'p2', text: 'two' }, { id: 'p1', text: 'one' }] },
    });

    expect(reordered.outline).not.toBe(one.outline);
  });

  it('notices a change made only to plan text', () => {
    const before = sermonFreshnessProjection({ planText: { p1: 'First version' } });
    const after = sermonFreshnessProjection({ planText: { p1: 'Edited elsewhere' } });

    expect(after.planText).not.toBe(before.planText);
  });

  it('treats a storage-only plan-text migration as the same readable plan', () => {
    const legacyPlan = {
      introduction: { outline: '', outlinePoints: { p1: 'Same paragraph' } },
      main: { outline: '' },
      conclusion: { outline: '' },
    };
    const beforeMigration = sermonFreshnessProjection({ plan: legacyPlan });
    const afterMigration = sermonFreshnessProjection({
      plan: legacyPlan,
      planText: { p1: 'Same paragraph' },
    });

    expect(afterMigration.planText).toBe(beforeMigration.planText);
  });

  it('treats a sparse server map and the screen\'s merged mirror as the same readable plan', () => {
    const legacyPlan = {
      introduction: { outline: '', outlinePoints: { p1: 'Moved', p2: 'Still legacy' } },
      main: { outline: '' },
      conclusion: { outline: '' },
    };
    const fromServer = sermonFreshnessProjection({
      plan: legacyPlan,
      planText: { p1: 'Moved' },
    });
    const fromScreen = sermonFreshnessProjection({
      plan: legacyPlan,
      planText: { p1: 'Moved', p2: 'Still legacy' },
    });

    expect(fromScreen.planText).toBe(fromServer.planText);
  });

  it('is the single rule for both sides of the comparison', () => {
    // The screen holds a sermon entity, the listener hands over a raw document.
    // This used to be written twice, and the two copies could drift apart silently.
    const fromScreen = sermonFreshnessProjection({
      title: 'City of God',
      verse: 'Psalm 86',
      thoughts: [thoughtA],
    });
    const fromServer = sermonFreshnessProjection({
      title: 'City of God',
      verse: 'Psalm 86',
      thoughts: [thoughtA],
    });

    expect(fromServer).toEqual(fromScreen);
  });

  /**
   * Scratch notes carry the same divergence as thoughts: the screen prepends a new
   * note while the offline writer appends it with `arrayUnion`. Same class, found by
   * sweeping the codebase after the thoughts fix rather than by a second report.
   */
  it('projects scratch notes by content, not by position', () => {
    const noteA = { id: 's1', text: 'first note' };
    const noteB = { id: 's2', text: 'second note' };

    const asServerStoresIt = sermonFreshnessProjection({ scratch: [noteA, noteB] });
    const asScreenHoldsIt = sermonFreshnessProjection({ scratch: [noteB, noteA] });

    expect(asScreenHoldsIt.scratch).toBe(asServerStoresIt.scratch);
  });

  it('still notices a scratch note the screen does not have', () => {
    const noteA = { id: 's1', text: 'first note' };
    const noteB = { id: 's2', text: 'second note' };

    expect(sermonFreshnessProjection({ scratch: [noteA] }).scratch).not.toBe(
      sermonFreshnessProjection({ scratch: [noteA, noteB] }).scratch
    );
  });

  it('orders by the whole item, so entries alike in id, date and text still sort stably', () => {
    // A partial key would compare these equal, leave them in arrival order, and let
    // position creep back into the comparison.
    const twinOne = { id: 'x', date: 'd', text: 't', tags: ['a'] };
    const twinTwo = { id: 'x', date: 'd', text: 't', tags: ['b'] };

    expect(sermonFreshnessProjection({ thoughts: [twinOne, twinTwo] }).thoughts).toBe(
      sermonFreshnessProjection({ thoughts: [twinTwo, twinOne] }).thoughts
    );
  });

  it('treats an empty thought list and a missing one the same way', () => {
    expect(sermonFreshnessProjection({ thoughts: [] }).thoughts).toBe(
      sermonFreshnessProjection({}).thoughts
    );
  });

  /**
   * The plan screen watches the same document and carried the same defect: a thought
   * added on the sermon screen sits at the front of the cached array while the server
   * holds it at the end, so opening the plan warned about the person's own writing.
   */
  describe('planFreshnessProjection', () => {
    it('projects the same thoughts identically regardless of their order', () => {
      const asServerStoresIt = planFreshnessProjection({ thoughts: [thoughtA, thoughtB] });
      const asScreenHoldsIt = planFreshnessProjection({ thoughts: [thoughtB, thoughtA] });

      expect(asScreenHoldsIt.thoughts).toBe(asServerStoresIt.thoughts);
    });

    it('compares thoughts by exactly the same rule as the sermon screen', () => {
      // One rule, two screens — a second copy is how this defect appeared in the
      // first place.
      const fromPlan = planFreshnessProjection({ thoughts: [thoughtB, thoughtA] });
      const fromSermon = sermonFreshnessProjection({ thoughts: [thoughtA, thoughtB] });

      expect(fromPlan.thoughts).toBe(fromSermon.thoughts);
    });

    it('keeps plan and outline order meaningful', () => {
      const one = planFreshnessProjection({
        outline: { introduction: [{ id: 'p1' }, { id: 'p2' }] },
      });
      const reordered = planFreshnessProjection({
        outline: { introduction: [{ id: 'p2' }, { id: 'p1' }] },
      });

      expect(reordered.outline).not.toBe(one.outline);
    });

    it('notices a change made only to plan text', () => {
      const before = planFreshnessProjection({ planText: { p1: 'First version' } });
      const after = planFreshnessProjection({ planText: { p1: 'Edited elsewhere' } });

      expect(after.planText).not.toBe(before.planText);
    });
  });
});
