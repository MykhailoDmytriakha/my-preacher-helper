import { readHardQuestionThemeOrderReview, resolveHardQuestionThemeOrderReview } from '../hardQuestionThemeOrderReview';
import { mergeDocumentFields } from '../protocol';

import type { SessionCheckpoint } from '../session';
import type { DocumentData, ResourceSnapshot } from '../types';

const resource = { collection: 'hardQuestionThemes', id: 'theme' };
const a = { id: 'a', title: 'A', text: 'Original words', scriptureRefs: ['John 3:16'] };
const b = { id: 'b', title: 'B', scriptureRefs: ['John 3:17'] };
const c = { id: 'c', title: 'C', scriptureRefs: ['John 3:18'] };
const initial = { title: 'Theme', bases: [a, b, c] };
const mine = { ...initial, bases: [c, { ...a, text: 'Local words' }, b] };
const saved = { ...initial, bases: [{ ...b, legacyWording: 'Keep untouched fields' }, { ...a, text: 'Saved words' }, c] };
const snapshot = (revision: number, value: DocumentData): ResourceSnapshot =>
  ({ resource, value, metadata: { protocol: 1, generation: 'g', revision, deleted: false } });

function checkpoint(): SessionCheckpoint {
  return { confirmed: snapshot(1, initial), remoteCandidate: snapshot(2, saved),
    draft: mine, pending: {}, editGeneration: 1, dirty: true, conflicts: mergeDocumentFields(initial, mine, saved).conflicts };
}

it('lets the person keep their placement and the saved words independently', () => {
  const pending = checkpoint();
  const review = readHardQuestionThemeOrderReview(pending)!;
  expect(review.fields.map(({ path }) => path)).toEqual([['bases'], ['bases', 'id:a', 'text']]);
  expect(resolveHardQuestionThemeOrderReview(pending, review.identity, {
    [review.fields[0].id]: 'local', [review.fields[1].id]: 'remote',
  }).value).toEqual({ ...initial, bases: [c, saved.bases[1], saved.bases[0]] });
});

it('lets the person keep their words and independently use the saved placement', () => {
  const pending = checkpoint();
  const review = readHardQuestionThemeOrderReview(pending)!;
  expect(resolveHardQuestionThemeOrderReview(pending, review.identity, {
    [review.fields[0].id]: 'remote', [review.fields[1].id]: 'local',
  }).value).toEqual({ ...initial, bases: [saved.bases[0], mine.bases[1], c] });
});

it('shows a deliberate return to the original basis words beside the disputed order', () => {
  const pending = checkpoint();
  const returned = { ...pending, draft: { ...mine, bases: [c, a, b] },
    conflicts: [pending.conflicts[0], {
      path: ['bases', 'id:a', 'text'], code: 'hard-question-basis-field-review',
      base: { exists: true, value: a.text }, mine: { exists: true, value: a.text },
      theirs: { exists: true, value: 'Saved words' },
    }],
  };
  const review = readHardQuestionThemeOrderReview(returned);
  expect(review?.fields.map(({ path }) => path)).toEqual([['bases'], ['bases', 'id:a', 'text']]);
  expect(review?.fields[1]).toMatchObject({ mine: { value: a.text }, theirs: { value: 'Saved words' } });
  const result = resolveHardQuestionThemeOrderReview(returned, review!.identity, {
    [review!.fields[0].id]: 'local', [review!.fields[1].id]: 'local',
  });
  expect((result.value.bases as DocumentData[]).find(row => row.id === a.id)?.text).toBe(a.text);
});

it.each(['local', 'remote'] as const)('keeps compatible stored references when choosing %s basis references with the order', side => {
  const local = { ...b, scriptureRefs: ['John 3:21'] };
  const remote = { ...b, scriptureRefs: [...b.scriptureRefs, 'John 3:22'] };
  const draft = { ...initial, bases: [c, a, local] };
  const stored = { ...initial, bases: [remote, a, c] };
  const field = (value: string[]) => ({ exists: true, value });
  const versions = { local: field(['John 3:21', 'John 3:22']), remote: field(remote.scriptureRefs), undecided: ['John 3:21'] };
  const pending: SessionCheckpoint = { ...checkpoint(), draft, remoteCandidate: snapshot(2, stored), conflicts: [
    ...mergeDocumentFields(initial, draft, stored).conflicts.filter(({ path }) => path.length === 1),
    { path: ['bases', 'id:b', 'scriptureRefs'], code: 'hard-question-basis-field-review', base: field(b.scriptureRefs),
      mine: field(local.scriptureRefs), theirs: field(remote.scriptureRefs), hardQuestionListVersions: versions },
  ] };
  const review = readHardQuestionThemeOrderReview(pending);
  expect(review?.fields.map(({ path }) => path)).toEqual([['bases'], ['bases', 'id:b', 'scriptureRefs']]);
  expect(review?.fields[1]).toMatchObject({ mine: versions.local, theirs: versions.remote });
  const result = resolveHardQuestionThemeOrderReview(pending, review!.identity, {
    [review!.fields[0].id]: 'local', [review!.fields[1].id]: side,
  });
  expect(result.value.bases).toEqual([c, a, { ...b, scriptureRefs: versions[side].value }]);
  expect(result.reviewedBases).toEqual([{ id: 'b', field: 'scriptureRefs', side, referenceItems: versions.undecided }]);
});

it('requires all choices and a current review identity', () => {
  const pending = checkpoint();
  const review = readHardQuestionThemeOrderReview(pending)!;
  expect(() => resolveHardQuestionThemeOrderReview(pending, review.identity, { [review.fields[0].id]: 'local' }))
    .toThrow('changed');
  const newer = { ...pending, remoteCandidate: snapshot(3, { ...saved, bases: [saved.bases[0], { ...a, text: 'New saved words' }, c] }) };
  expect(readHardQuestionThemeOrderReview(newer)?.identity).not.toBe(review.identity);
  expect(() => resolveHardQuestionThemeOrderReview(newer, review.identity, {
    [review.fields[0].id]: 'local', [review.fields[1].id]: 'remote',
  })).toThrow('changed');
});

it('chooses whether a disputed row stays independently of the surviving list order', () => {
  const d = { id: 'd', title: 'D', scriptureRefs: ['John 3:19'] };
  const before = { ...initial, bases: [a, b, c, d] };
  const local = { ...initial, bases: [d, a, c] };
  const updated = { ...b, text: 'A saved edit to the removed row' };
  const remote = { ...initial, bases: [c, a, updated, d] };
  const pending: SessionCheckpoint = { ...checkpoint(), confirmed: snapshot(1, before), draft: local,
    remoteCandidate: snapshot(2, remote), conflicts: mergeDocumentFields(before, local, remote).conflicts };
  const review = readHardQuestionThemeOrderReview(pending)!;
  expect(review.fields.map(({ path }) => path)).toEqual([['bases'], ['bases', 'id:b']]);
  const { value: kept } = resolveHardQuestionThemeOrderReview(pending, review.identity, {
    [review.fields[0].id]: 'local', [review.fields[1].id]: 'remote',
  });
  expect((kept.bases as typeof before.bases).filter(row => row.id !== 'b')).toEqual(local.bases);
  expect(kept.bases).toContainEqual(updated);
  expect(resolveHardQuestionThemeOrderReview(pending, review.identity, {
    [review.fields[0].id]: 'remote', [review.fields[1].id]: 'local',
  }).value.bases).toEqual([c, a, d]);
});
