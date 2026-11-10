import { homileticListPath, HOMILETIC_POSITION_PROJECTION, HOMILETIC_POSITION_REVIEW, HOMILETIC_TITLE_REVIEW } from '../homileticPlan';
import { projectHomileticReview } from '../homileticPlanChoice';

const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(id => ({ id, title: id }));
const document = (rows: typeof a[]) => ({ preparation: { homileticPlan: { updatedPlan: rows, sermonPlan: [d], modernTranslation: 'Keep' } } });
const field = (value: typeof a[] | string) => ({ exists: true, value });
const list = 'updatedPlan';
const path = homileticListPath(list);

it.each(['local', 'remote'] as const)('keeps both disjoint moves when choosing the %s title', choice => {
  const opening = [a, b, c, d];
  const chosen = [b, a, c, d];
  const own = { ...c, title: 'Mine' }, saved = { ...c, title: 'Saved' };
  const prior = [a, b, saved, d];
  const newer = [a, b, d, saved];
  const conflicts = [
    { path, code: HOMILETIC_POSITION_PROJECTION, base: field(opening), mine: field(chosen), theirs: field(chosen) },
    { path: [...path, 'id:c', 'title'], code: HOMILETIC_TITLE_REVIEW, base: field(c.title), mine: field(own.title), theirs: field(saved.title) },
  ];
  expect(projectHomileticReview(document(opening), document([b, a, own, d]), document(newer), document(prior), list, conflicts, choice))
    .toEqual(document([b, a, d, choice === 'local' ? own : saved]));
});

it('does not replace a newer point insertion with a stale displayed order', () => {
  const opening = [a, b, c];
  const proposed = [b, a, c];
  const live = [a, d, b, c];
  const conflicts = [{ path, code: HOMILETIC_POSITION_REVIEW, base: field(opening), mine: field(proposed), theirs: field(opening) }];
  expect(projectHomileticReview(document(opening), document(proposed), document(live), document(opening), list, conflicts, 'local'))
    .toBeUndefined();
  expect(projectHomileticReview(document(opening), document(proposed), document(live), document(opening), list, conflicts, 'remote'))
    .toEqual(document(live));
});

it('keeps the new point and its exact position when the local version is amended', () => {
  const opening = [a, b, c], sent = [b, a, c], staged = [b, c, d, a];
  const conflicts = [{ path, code: HOMILETIC_POSITION_REVIEW, base: field(opening), mine: field(sent), theirs: field(opening) }];
  expect(projectHomileticReview(document(opening), document(staged), document(opening), document(opening), list, conflicts, 'local', document(sent)))
    .toEqual(document(staged));
});
