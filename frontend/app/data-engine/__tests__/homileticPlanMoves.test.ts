import { homileticMovesInList, matchesHomileticMoveSequence, stageHomileticMove } from '../homileticPlanMoves';

const [a, b, c] = ['a', 'b', 'c'].map(id => ({ id, title: id }));
const move = { stepId: 'b', opening: { previous: 'a', next: 'c' }, destination: { previous: null, next: 'a' } };

it('does not let a real arrow certify a no-op for another point', () => {
  const noOp = { stepId: 'a', opening: { previous: null, next: 'b' }, destination: { previous: null, next: 'b' } };
  expect(matchesHomileticMoveSequence([a, b, c], [b, a, c], [move])).toBe(true);
  expect(matchesHomileticMoveSequence([a, b, c], [b, a, c], [noOp, move])).toBe(false);
});

it.each(['added', 'removed'] as const)('certifies a move when its neighboring point is %s before Save', membership => {
  const d = { id: 'd', title: 'd' };
  const original = [a, b, c];
  const document = (rows: typeof original) => ({ preparation: { homileticPlan: { updatedPlan: rows } } });
  const before = membership === 'added' ? [a, d, b, c] : original;
  const after = membership === 'added' ? [a, d, c, b] : [b, a, c];
  const final = membership === 'added' ? after : [b, a];
  const gesture = stageHomileticMove(document(before), document(after), { list: 'updatedPlan', rowId: membership === 'added' ? 'c' : 'a' });
  expect(gesture).toBeDefined();
  const moves = homileticMovesInList([gesture!], 'updatedPlan', original, final);
  expect(matchesHomileticMoveSequence(original, final, moves)).toBe(true);
});
