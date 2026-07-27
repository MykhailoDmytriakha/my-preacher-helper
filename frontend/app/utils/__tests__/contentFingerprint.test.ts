import { contentFingerprint } from '@/utils/contentFingerprint';
import { normalizeSeriesItems } from '@/utils/seriesItems';

/**
 * The detector's job is to notice that the server holds something different.
 * Counting items cannot do that: adversarial review pointed out that editing a
 * thought, reordering a series or rewriting a group block leaves every length
 * identical, so the stale screen declared itself fresh.
 */
describe('contentFingerprint', () => {
  it('changes when an item is EDITED, though the count does not', () => {
    const before = [{ id: 't1', text: 'first' }];
    const after = [{ id: 't1', text: 'first, rewritten on the phone' }];

    expect(before.length).toBe(after.length);
    expect(contentFingerprint(before)).not.toBe(contentFingerprint(after));
  });

  it('changes when items are REORDERED, though the count does not', () => {
    const before = [{ id: 'a' }, { id: 'b' }];
    const after = [{ id: 'b' }, { id: 'a' }];

    expect(contentFingerprint(before)).not.toBe(contentFingerprint(after));
  });

  it('changes when one item is swapped for another of the same size', () => {
    expect(contentFingerprint([{ id: 'a' }])).not.toBe(contentFingerprint([{ id: 'z' }]));
  });

  it('does NOT change on key order alone — no phantom "changed elsewhere"', () => {
    expect(contentFingerprint({ a: 1, b: 2 })).toBe(contentFingerprint({ b: 2, a: 1 }));
  });

  it('treats an absent field and an explicitly undefined one alike', () => {
    // Firestore simply has no undefined, so the local object must match remote.
    expect(contentFingerprint({ a: 1, b: undefined })).toBe(contentFingerprint({ a: 1 }));
  });

  it('survives nesting, which is where sermon plans and group flows live', () => {
    const before = { intro: [{ id: 'p1', subPoints: [{ id: 's1', text: 'x' }] }] };
    const after = { intro: [{ id: 'p1', subPoints: [{ id: 's1', text: 'y' }] }] };

    expect(contentFingerprint(before)).not.toBe(contentFingerprint(after));
  });

  it('gives a LEGACY series the same fingerprint on both sides', () => {
    // The page holds items derived from `sermonIds`; the raw document has none.
    // Fingerprinting the raw side produced a permanent phantom "changed on
    // another device" that no refresh could clear — both sides must normalize.
    const rawLegacyDoc = { items: undefined, sermonIds: ['s1', 's2'] };
    const whatThePageHolds = normalizeSeriesItems(undefined, ['s1', 's2']);

    expect(contentFingerprint(normalizeSeriesItems(rawLegacyDoc.items, rawLegacyDoc.sermonIds))).toBe(
      contentFingerprint(whatThePageHolds)
    );
  });
});
