import { applyCommand, diffFields } from '../protocol';
import { DataSession } from '../session';
import { readStudyNoteReferenceComparison } from '../studyNoteReferenceChoice';

import type { DocumentData, ResourceSnapshot } from '../types';

const resource = { collection: 'studyNotes', id: 'note' };
const opening: DocumentData = { userId: 'owner', type: 'note', title: 'Opening title', content: 'Saved words',
  scriptureRefs: [], tags: [], isDraft: false, createdAt: 'created', updatedAt: 'updated' };
const initial: ResourceSnapshot = { resource, value: opening,
  metadata: { protocol: 1, generation: 'generation', revision: 1, deleted: false } };
const john = { bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 };
const phone = { ...john, id: 'phone-reference' };
const desktop = { ...john, id: 'desktop-reference' };
const romans = { id: 'other-reference', bible: 'kjv', book: 'Romans', chapter: 8, fromVerse: 28 };

function submit(operationId: string, current: ResourceSnapshot, before: DocumentData, after: DocumentData) {
  return applyCommand({ protocol: 1, operationId, resource, owner: 'owner', generation: 'generation',
    dependsOn: [], kind: 'update', changes: diffFields(before, after) }, current);
}

function save(operationId: string, current: ResourceSnapshot, before: DocumentData, after: DocumentData): ResourceSnapshot {
  const result = submit(operationId, current, before, after);
  expect(result.kind).toBe('acknowledged');
  if (result.kind !== 'acknowledged') throw new Error('Expected acknowledgement');
  return result.snapshot;
}

describe('Study note reference reconciliation', () => {
  it.each(['phone', 'desktop'] as const)('accepts both saves and retains one exact reference when %s delivers first', first => {
    const copies = { phone: { ...opening, scriptureRefs: [phone] }, desktop: { ...opening, scriptureRefs: [desktop, romans] } };
    const second = first === 'phone' ? 'desktop' : 'phone';
    const stored = save(first, initial, opening, copies[first]);
    const result = save(second, stored, opening, copies[second]);
    expect(result.value?.scriptureRefs).toEqual(first === 'phone' ? [phone, romans] : [desktop, romans]);
    expect(result.value?.content).toBe(opening.content);
  });

  it.each(['edit', 'remove'] as const)('preserves a subsequent %s after the editor sees the retained reference', action => {
    const fromDesktop = { ...opening, scriptureRefs: [desktop, romans] };
    const stored = save('desktop', initial, opening, fromDesktop);
    const reconciled = save('phone', stored, opening, { ...opening, scriptureRefs: [phone] });
    expect(reconciled.metadata?.studyNoteReferenceAliases).toEqual([{ from: phone.id, to: desktop.id }]);
    const accepted = reconciled.value!;
    const next = { ...accepted, scriptureRefs: action === 'remove' ? [romans] : [{ ...desktop, fromVerse: 17 }, romans] };
    expect(save('follow-up', reconciled, accepted, next).value?.scriptureRefs).toEqual(next.scriptureRefs);
  });

  it.each(['edit', 'remove'] as const)('asks about an unobserved %s of the absorbed reference and keeps the saved version', action => {
    const fromPhone = { ...opening, scriptureRefs: [phone] };
    const stored = save('desktop', initial, opening, { ...opening, scriptureRefs: [desktop, romans] });
    const reconciled = save('phone', stored, opening, fromPhone);
    const next = { ...fromPhone, scriptureRefs: action === 'remove' ? [] : [{ ...phone, fromVerse: 17 }] };
    expect(submit('follow-up', reconciled, fromPhone, next)).toMatchObject({ kind: 'conflict', snapshot: reconciled,
      conflicts: expect.arrayContaining([expect.objectContaining({ path: ['scriptureRefs'], mine: { exists: true, value: action === 'remove' ? [romans] : [{ ...desktop, fromVerse: 17 }, romans] } })]) });
  });

  it.each(['edit', 'remove'] as const)('preserves the exact compared %s when keeping the local reference choice', action => {
    const fromPhone = { ...opening, scriptureRefs: [phone] };
    const stored = save('desktop', initial, opening, { ...opening, scriptureRefs: [desktop, romans] });
    const reconciled = save('phone', stored, opening, fromPhone);
    const old = { ...initial, value: fromPhone };
    const next = { ...fromPhone, content: 'Later local words',
      scriptureRefs: action === 'remove' ? [] : [{ ...phone, fromVerse: 17 }] };
    const response = submit('follow-up', reconciled, fromPhone, next);
    expect(response.kind).toBe('conflict');

    const session = new DataSession(old);
    session.edit(next);
    session.registerCommit('follow-up', 1, next);
    session.accept(response);
    session.release('follow-up');
    session.keepLocal();
    const intended = session.checkpoint().draft!;
    expect(intended).toMatchObject({ content: 'Later local words',
      scriptureRefs: action === 'remove' ? [romans] : [{ ...desktop, fromVerse: 17 }, romans] });
    const final = save('reviewed', reconciled, reconciled.value!, intended);
    expect(final.value).toMatchObject({ content: 'Later local words', scriptureRefs: intended.scriptureRefs });
  });

  it.each(['local', 'stored'] as const)('keeps other new references and words when choosing the %s reference', choice => {
    const another = { ...romans, id: 'local-neighbor', fromVerse: 29 };
    const fromPhone = { ...opening, scriptureRefs: [phone] };
    const stored = save('desktop', initial, opening, { ...opening, scriptureRefs: [desktop, romans] });
    const reconciled = save('phone', stored, opening, fromPhone);
    const local = { ...fromPhone, scriptureRefs: [another], content: 'Independent local words', tags: ['local-tag'] };
    const response = submit('pending', reconciled, fromPhone, local);
    expect(response.kind).toBe('conflict');
    const session = new DataSession({ ...initial, value: fromPhone });
    session.edit(local);
    session.registerCommit('pending', 1, local);
    session.accept(response);
    session.release('pending');
    if (choice === 'local') session.keepLocal();
    else session.acceptRemote();
    const intended = session.checkpoint().draft!;
    const expected = choice === 'local' ? [romans, another] : [desktop, romans, another];
    expect(intended).toMatchObject({ content: local.content, tags: local.tags, scriptureRefs: expected });
    expect(save('reviewed', reconciled, reconciled.value!, intended).value)
      .toMatchObject({ content: local.content, tags: local.tags, scriptureRefs: expected });
  });

  it.each(['local', 'stored'] as const)('retains references added after the request and after the saved comparison when choosing %s', choice => {
    const localNeighbor = { ...romans, id: 'local-neighbor', fromVerse: 29 };
    const localLater = { ...romans, id: 'local-later', fromVerse: 30 };
    const remoteLater = { ...romans, id: 'remote-later', fromVerse: 31 };
    const fromPhone = { ...opening, scriptureRefs: [phone] };
    const stored = save('desktop', initial, opening, { ...opening, scriptureRefs: [desktop, romans] });
    const reconciled = save('phone', stored, opening, fromPhone);
    const local = { ...fromPhone, scriptureRefs: [localNeighbor], content: 'Independent local words' };
    const response = submit('follow-up', reconciled, fromPhone, local);
    expect(response.kind).toBe('conflict');
    const session = new DataSession({ ...initial, value: fromPhone });
    session.edit(local);
    session.registerCommit('follow-up', session.checkpoint().editGeneration, local);
    session.accept(response);
    session.release('follow-up');
    session.edit({ ...local, scriptureRefs: [localNeighbor, localLater] });

    const newer = save('later-remote', reconciled, reconciled.value!, { ...reconciled.value,
      scriptureRefs: [{ ...desktop, fromVerse: 18 }, romans, remoteLater] });
    session.observe(newer, { source: 'server' });
    expect(readStudyNoteReferenceComparison(session.checkpoint())?.rows).toEqual([{
      mine: { exists: false }, stored: { exists: true, value: { ...desktop, fromVerse: 18 } },
    }]);
    if (choice === 'local') session.keepLocal();
    else session.acceptRemote();
    expect(session.checkpoint().draft).toMatchObject({ content: 'Independent local words',
      scriptureRefs: expect.arrayContaining([localNeighbor, romans, localLater, remoteLater]) });
    const refs = session.checkpoint().draft?.scriptureRefs as typeof desktop[];
    expect(refs.filter(ref => ref.id === desktop.id)).toEqual(choice === 'stored' ? [{ ...desktop, fromVerse: 18 }] : []);
    expect(refs).toHaveLength(choice === 'stored' ? 5 : 4);
  });

  it.each(['local', 'stored'] as const)('resolves a comparison of both the disputed note text and reference with %s', choice => {
    const localNeighbor = { ...romans, id: 'local-neighbor', fromVerse: 29 };
    const fromPhone = { ...opening, scriptureRefs: [phone] };
    const stored = save('desktop', initial, opening, { ...opening, scriptureRefs: [desktop, romans], content: 'Saved later words' });
    const reconciled = save('phone', stored, opening, fromPhone);
    const local = { ...fromPhone, scriptureRefs: [localNeighbor], content: 'My later words',
      dictationSourceIds: ['laptop-take'], recordingSourceIds: ['laptop-take'] };
    const response = submit('follow-up', reconciled, fromPhone, local);
    expect(response.kind).toBe('conflict');
    const session = new DataSession({ ...initial, value: fromPhone });
    session.edit(local);
    session.registerCommit('follow-up', session.checkpoint().editGeneration, local);
    session.accept(response);
    session.release('follow-up');
    const shown = readStudyNoteReferenceComparison(session.checkpoint());
    expect(shown?.fields).toMatchObject([{ path: ['content'], mine: { value: 'My later words' }, theirs: { value: 'Saved later words' } }]);
    if (choice === 'local') session.keepLocal();
    else session.acceptRemote();
    expect(session.checkpoint().draft).toMatchObject({
      content: choice === 'local' ? 'My later words' : 'Saved later words',
      scriptureRefs: expect.arrayContaining([localNeighbor, romans]),
    });
    const refs = session.checkpoint().draft?.scriptureRefs as typeof desktop[];
    expect(refs.filter(ref => ref.id === desktop.id)).toEqual(choice === 'stored' ? [desktop] : []);
    expect(refs).toHaveLength(choice === 'stored' ? 3 : 2);
    expect(session.checkpoint().draft?.recordingSourceIds).toEqual(['laptop-take']);
    expect(session.checkpoint().draft?.dictationSourceIds ?? []).toEqual(choice === 'stored' ? [] : ['laptop-take']);
  });

  it.each([false, true])('keeps one reference when the reviewed replacement already exists (different quote: %s)', withQuote => {
    const fromPhone = { ...opening, scriptureRefs: [phone] };
    const saved = { ...romans, ...(withQuote && { text: 'Saved quotation' }) };
    const local = { ...romans, ...(withQuote && { text: 'My quotation' }) };
    const stored = save('desktop', initial, opening, { ...opening, scriptureRefs: [desktop, saved] });
    const reconciled = save('phone', stored, opening, fromPhone);
    const next = { ...fromPhone, content: 'Independent words', scriptureRefs: [{ ...local, id: phone.id }] };
    const response = submit('follow-up', reconciled, fromPhone, next);
    expect(response.kind).toBe('conflict');
    const session = new DataSession({ ...initial, value: fromPhone });
    session.edit(next);
    session.registerCommit('follow-up', session.checkpoint().editGeneration, next);
    session.accept(response);
    session.release('follow-up');
    if (withQuote) expect(readStudyNoteReferenceComparison(session.checkpoint())?.rows).toContainEqual({
      mine: { exists: true, value: local }, stored: { exists: true, value: saved },
    });
    session.keepLocal();
    const intended = session.checkpoint().draft!;
    expect(intended).toMatchObject({ scriptureRefs: [local], content: next.content });
  });

  it('does not redirect an old request to an independently re-added reference with the same words', () => {
    const fromPhone = { ...opening, scriptureRefs: [phone] };
    const stored = save('desktop', initial, opening, { ...opening, scriptureRefs: [desktop, romans] });
    const reconciled = save('phone', stored, opening, fromPhone);
    const removed = save('remove-live', reconciled, reconciled.value!, { ...reconciled.value!, scriptureRefs: [romans] });
    const replacement = { ...desktop, id: 'newly-added-reference' };
    const readded = save('readd-live', removed, removed.value!, { ...removed.value!, scriptureRefs: [romans, replacement] });
    expect(readded.metadata?.studyNoteReferenceAliases).toEqual([{ from: phone.id, to: desktop.id }]);
    const staleRemoval = save('old-remove', readded, fromPhone, { ...fromPhone, scriptureRefs: [] });
    expect(staleRemoval.value?.scriptureRefs).toEqual([romans, replacement]);
    const staleEdit = submit('old-edit', readded, fromPhone, { ...fromPhone, scriptureRefs: [{ ...phone, fromVerse: 17 }] });
    expect(staleEdit).toMatchObject({ kind: 'conflict', snapshot: readded });
    expect(submit('old-add', readded, opening, fromPhone)).toMatchObject({ kind: 'conflict', snapshot: readded });
  });

  it('preserves a new reference when another device edited an existing row to the same place', () => {
    const existing = { ...desktop, fromVerse: 15 };
    const before = { ...opening, scriptureRefs: [existing] };
    const stored = save('desktop-edit', { ...initial, value: before }, before, { ...before, scriptureRefs: [desktop] });
    const result = save('phone-add', stored, before, { ...before, scriptureRefs: [existing, phone] });
    expect(result.value?.scriptureRefs).toEqual([desktop, phone]);
    expect(result.metadata?.studyNoteReferenceAliases).toBeUndefined();
  });

  it('keeps the saved insertion order when two equivalent pairs were added in different order', () => {
    const otherPhone = { ...romans, id: 'other-phone-reference' };
    const stored = save('desktop', initial, opening, { ...opening, scriptureRefs: [desktop, romans] });
    const reconciled = save('phone', stored, opening, { ...opening, scriptureRefs: [otherPhone, phone] });
    expect(reconciled.value?.scriptureRefs).toEqual([desktop, romans]);
    expect(reconciled.metadata?.studyNoteReferenceAliases).toEqual([{ from: otherPhone.id, to: romans.id }, { from: phone.id, to: desktop.id }]);
  });

  it.each([
    ['another written Bible', { ...phone, bible: 'rst' }],
    ['distinct quoted words', { ...phone, text: 'Keep these words' }],
    ['a separate verse', { ...phone, fromVerse: 17 }],
  ])('keeps independent additions with %s', (_reason, other) => {
    const stored = save('desktop', initial, opening, { ...opening, scriptureRefs: [desktop, romans] });
    const result = save('phone', stored, opening, { ...opening, scriptureRefs: [other] });
    expect(result.value?.scriptureRefs).toEqual([desktop, romans, other]);
  });
});
