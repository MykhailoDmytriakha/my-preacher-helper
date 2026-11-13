import { openingReferenceDraft, updateNoteReferenceDraft } from '../noteReferenceDraft';

import type { ScriptureReference } from '@/models/models';

const phone = { id: 'phone-ref', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 } satisfies ScriptureReference;
const desktop = { ...phone, id: 'desktop-ref' };
const remote = { id: 'other-remote', bible: 'kjv', book: 'Romans', chapter: 8, fromVerse: 28 } satisfies ScriptureReference;
const local = { id: 'other-local', bible: 'kjv', book: 'Luke', chapter: 1, fromVerse: 1 } satisfies ScriptureReference;
const later = { id: 'later-local', bible: 'kjv', book: 'Mark', chapter: 1, fromVerse: 1 } satisfies ScriptureReference;
const aliases = [{ from: phone.id, to: desktop.id }];

it.each(['mine', 'stored'] as const)('preserves reference input on both sides of an acknowledgement when choosing %s', side => {
    let draft = updateNoteReferenceDraft(openingReferenceDraft, { type: 'adopt', references: [phone] });
    draft = updateNoteReferenceDraft(draft, { type: 'edit', value: () => [local] });
    draft = updateNoteReferenceDraft(draft, { type: 'acknowledge', submitted: [phone], accepted: [desktop, remote], aliases });
    expect(draft.aliases.get(phone.id)).toBe(desktop.id);
    expect(draft.review?.rows).toEqual([{ mine: { exists: false }, stored: { exists: true, value: desktop } }]);

    draft = updateNoteReferenceDraft(draft, { type: 'edit', value: current => [...current, later] });
    expect(draft.review?.rows).toEqual([{ mine: { exists: false }, stored: { exists: true, value: desktop } }]);

    draft = updateNoteReferenceDraft(draft, { type: 'choose', side, review: draft.review });
    expect(draft.review).toBeUndefined();
    expect(draft.references).toEqual(expect.arrayContaining([local, remote, later]));
    expect(draft.references.some(ref => ref.id === desktop.id)).toBe(side === 'stored');
    expect(draft.references).toHaveLength(side === 'stored' ? 4 : 3);
});

it('rejects a choice for rows that have changed since they were shown', () => {
    let draft = updateNoteReferenceDraft(openingReferenceDraft, { type: 'adopt', references: [{ ...phone, fromVerse: 17 }] });
    draft = updateNoteReferenceDraft(draft, { type: 'acknowledge', submitted: [phone], accepted: [desktop, remote], aliases });
    const shown = draft.review;
    expect(shown?.rows).toEqual([{ mine: { exists: true, value: { ...desktop, fromVerse: 17 } }, stored: { exists: true, value: desktop } }]);

    draft = updateNoteReferenceDraft(draft, { type: 'edit', value: current => current.map(ref => ref.id === desktop.id ? { ...ref, fromVerse: 18 } : ref) });
    expect(draft.review?.rows).toEqual([{ mine: { exists: true, value: { ...desktop, fromVerse: 18 } }, stored: { exists: true, value: desktop } }]);
    expect(updateNoteReferenceDraft(draft, { type: 'choose', side: 'stored', review: shown })).toBe(draft);
    expect(draft.references).toContainEqual({ ...desktop, fromVerse: 18 });
});

it.each(['mine', 'stored'] as const)('leaves both independent additions in a choice between two edits of a known reference: %s', side => {
    let draft = updateNoteReferenceDraft(openingReferenceDraft, { type: 'adopt', references: [{ ...desktop, fromVerse: 17 }, local] });
    draft = updateNoteReferenceDraft(draft, { type: 'acknowledge', submitted: [desktop],
        accepted: [{ ...desktop, fromVerse: 19 }, remote], aliases: [] });
    expect(draft.review?.rows).toEqual([{
        mine: { exists: true, value: { ...desktop, fromVerse: 17 } },
        stored: { exists: true, value: { ...desktop, fromVerse: 19 } },
    }]);

    draft = updateNoteReferenceDraft(draft, { type: 'choose', side, review: draft.review });
    expect(draft.references).toEqual(expect.arrayContaining([local, remote, { ...desktop, fromVerse: side === 'mine' ? 17 : 19 }]));
});

it('targets the clicked reference when a preceding acknowledgement inserts a neighbor', () => {
    let draft = updateNoteReferenceDraft(openingReferenceDraft, { type: 'adopt', references: [phone, local] });
    draft = updateNoteReferenceDraft(draft, { type: 'acknowledge', submitted: [phone], accepted: [desktop, remote], aliases });
    draft = updateNoteReferenceDraft(draft, { type: 'edit-opening', opening: { reference: local, uniqueId: true } });
    expect(draft.references).toEqual([desktop, remote]);
});

it('retains an open picker edit against the same reference after an acknowledgement changes its ID', () => {
    let draft = updateNoteReferenceDraft(openingReferenceDraft, { type: 'adopt', references: [phone] });
    draft = updateNoteReferenceDraft(draft, { type: 'acknowledge', submitted: [phone], accepted: [desktop, remote], aliases });
    draft = updateNoteReferenceDraft(draft, { type: 'edit-opening', opening: { reference: phone, uniqueId: true },
        value: { ...phone, fromVerse: 17 } });
    expect(draft.references).toEqual([{ ...desktop, fromVerse: 17 }, remote]);
});

it.each(['mine', 'stored'] as const)('restores an unanswered comparison and retains later saved references when choosing %s', side => {
    let draft = updateNoteReferenceDraft(openingReferenceDraft, { type: 'adopt', references: [phone] });
    draft = updateNoteReferenceDraft(draft, { type: 'edit', value: [local] });
    draft = updateNoteReferenceDraft(draft, { type: 'acknowledge', submitted: [phone], accepted: [desktop, remote], aliases, revision: 2 });
    const held = JSON.parse(JSON.stringify({ references: draft.references, recovery: draft.review?.recovery }));

    const stale = updateNoteReferenceDraft(openingReferenceDraft, { type: 'restore', ...held, observed: { references: [phone], revision: 1, aliases: [] } });
    expect(stale.review?.recovery).toEqual(held.recovery);
    const observed = { references: [{ ...desktop, fromVerse: 19 }, remote, later], revision: 3, aliases };
    const restored = updateNoteReferenceDraft(openingReferenceDraft, { type: 'restore', ...held, observed });
    expect(restored.review?.rows).toEqual([{ mine: { exists: false },
        stored: { exists: true, value: { ...desktop, fromVerse: 19 } } }]);
    expect(restored.review?.recovery.acceptedRevision).toBe(3);

    const decided = updateNoteReferenceDraft(restored, { type: 'choose', side, review: restored.review });
    expect(decided.review).toBeUndefined();
    expect(decided.references).toEqual(expect.arrayContaining([remote, later, local]));
    expect(decided.references.filter(ref => ref.id === desktop.id)).toEqual(side === 'stored' ? [{ ...desktop, fromVerse: 19 }] : []);
});

it.each(['remove', 'edit'] as const)('keeps the action time across a same-reference acknowledgement before a timed %s is sent', change => {
    let draft = updateNoteReferenceDraft(openingReferenceDraft, { type: 'adopt', references: [phone] });
    const time = { earliestMs: 1_800_000_000_110, latestMs: 1_800_000_000_120 };
    const next = change === 'edit' ? { ...phone, fromVerse: 17 } : undefined;
    draft = updateNoteReferenceDraft(draft, { type: 'edit-opening', opening: { reference: phone, uniqueId: true }, value: next, time });
    draft = updateNoteReferenceDraft(draft, { type: 'acknowledge', submitted: [phone], accepted: [desktop, remote], aliases, revision: 3, engineRevision: 3 });
    expect(draft.review).toBeUndefined();
    const canonical = next && { ...next, id: desktop.id };
    expect(draft.references).toEqual(canonical ? [canonical, remote] : [remote]);
    expect(draft.edits.get(desktop.id)).toEqual({ reference: canonical, time, observedRevision: undefined });
    expect(draft.edits.has(phone.id)).toBe(false);
});

it('does not skip a comparison when the accepted reference has different words', () => {
    let draft = updateNoteReferenceDraft(openingReferenceDraft, { type: 'adopt', references: [phone] });
    const time = { earliestMs: 1_800_000_000_110, latestMs: 1_800_000_000_120 };
    draft = updateNoteReferenceDraft(draft, { type: 'edit-opening', opening: { reference: phone, uniqueId: true }, time });
    const different = { ...desktop, text: 'A different quotation' };
    draft = updateNoteReferenceDraft(draft, { type: 'acknowledge', submitted: [phone], accepted: [different, remote], aliases });
    expect(draft.review?.rows).toEqual([{ mine: { exists: false }, stored: { exists: true, value: different } }]);
    expect(draft.edits.get(desktop.id)).toBeUndefined();
});

it('requires a choice when a timed replacement would duplicate a reference from the acknowledgement', () => {
    let draft = updateNoteReferenceDraft(openingReferenceDraft, { type: 'adopt', references: [phone] });
    const time = { earliestMs: 1_800_000_000_110, latestMs: 1_800_000_000_120 };
    draft = updateNoteReferenceDraft(draft, { type: 'edit-opening', opening: { reference: phone, uniqueId: true },
        value: { ...remote, id: phone.id }, time });
    draft = updateNoteReferenceDraft(draft, { type: 'acknowledge', submitted: [phone], accepted: [desktop, remote], aliases });
    expect(draft.review?.ids).toEqual([desktop.id]);
    expect(draft.edits.get(desktop.id)).toBeUndefined();
});
