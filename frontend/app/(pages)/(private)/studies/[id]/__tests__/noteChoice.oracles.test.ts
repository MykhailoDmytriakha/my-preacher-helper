import { choiceVerdicts, type ChoiceObservation, type Answer } from '@test-utils/noteChoiceOracles';

function observation(answer?: Partial<Answer>): ChoiceObservation {
  return {
    events: [], questions: [], arrived: [], typed: [{ word: 'Localword', sequence: 1 }], remoteEpoch: 1,
    steps: [{ event: 0, sequence: 5, editor: 'Localword', page: 'Localword', stored: 'Localword',
      dom: 'Localword', editorMounted: true, confirmed: 'Older', saved: true, unsaved: false, question: false,
      coveredWords: [], sends: 1, renders: 1, collectionHeld: false }],
    answers: answer ? [{ kind: 'take', event: 0, sequence: 4, local: 'Localword', remote: 'Localword',
      captureSequence: 2, newer: [], sendStart: 0, remoteEpoch: 1, surface: 'notice',
      noRenderRefusal: false, collectionHeldAtChoice: false, completed: true, rejectedShown: false,
      ...answer }] : [],
    continuation: { nextSaved: true, cleanArrival: true, nextEditor: 'Localword Continuationword',
      nextStored: 'Localword Continuationword', question: false },
  };
}

it('does not call an unexercised choice oracle a pass', () => {
  const row = choiceVerdicts(observation());
  expect([row.C1, row.C2, row.C3, row.C4, row.C5]).toEqual(Array(5).fill('not applicable'));
});
it('a completed Take with a remaining question fails rather than becoming inapplicable', () => {
  const row = observation({ kind: 'take' });
  row.steps[0].question = true;
  expect(choiceVerdicts(row).C2).toBe('violation');
});
it('requires actual completion before judging Take', () => {
  const row = observation({ kind: 'take', completed: false });
  row.steps[0].editor = 'Wrong';
  expect(choiceVerdicts(row).C2).toBe('not applicable');
});
it('does not reject a Keep solely because internal confirmation differs', () => {
  expect(choiceVerdicts(observation({ kind: 'keep', replacement: 'accepted' })).C3).toBe('pass');
});
it('cannot distinguish equal texts for rejected-version display', () => {
  expect(choiceVerdicts(observation({ kind: 'keep' })).C1).toBe('not applicable');
});
it('an unrelated question does not cover newer words', () => {
  const row = observation({ captureSequence: 0, newer: ['Localword'] });
  row.steps[0].question = true;
  row.steps[0].stored = 'Remote';
  expect(choiceVerdicts(row).C4).toBe('violation');
  row.steps[0].coveredWords = ['Localword'];
  expect(choiceVerdicts(row).C4).toBe('pass');
});

it('does not judge an unmounted old editor as the visible editor after Done', () => {
  const row = observation({ kind: 'take' });
  row.steps[0].editorMounted = false;
  row.steps[0].editor = 'Destroyed editor';
  expect(choiceVerdicts(row).C2).toBe('not applicable');
});

it('does not treat an empty-queue intermediate frame as a settled-choice failure', () => {
  const row = observation({ kind: 'take' });
  row.violatedAtSteps = { C2: [0] };
  expect(choiceVerdicts(row).C2).toBe('pass');
});

it('a later answered question replaces the previous capture boundary', () => {
  const row = observation({ captureSequence: 0, newer: ['Localword'] });
  row.steps[0].stored = row.steps[0].editor = row.steps[0].page = 'Remote';
  row.answers.push({ ...row.answers[0], surface: 'inline', captureSequence: undefined, newer: [], event: 1 });
  expect(choiceVerdicts(row).C4).toBe('not applicable');
});
