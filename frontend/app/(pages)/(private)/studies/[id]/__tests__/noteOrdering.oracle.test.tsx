import { hasNoteQuestion } from '@test-utils/noteOrdering';
import { render } from '@testing-library/react';
import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import { NoteDraftRecovery } from '../NoteDraftRecovery';

it('does not accept unrelated alerts, dialogs or save errors as a note question', () => {
  render(<div data-note-workspace><div role="alert">Microphone failed</div><div role="dialog" aria-modal="true">Other dialog</div>
    <div role="status">common.saveError</div></div>);
  expect(hasNoteQuestion()).toBe(false);
});

it('accepts the real actionable note conflict banner', () => {
  render(<div data-note-workspace><SaveConflictBanner entityKey="entityNote" onKeepMine={() => undefined} onTakeTheirs={() => undefined} /></div>);
  expect(hasNoteQuestion()).toBe(true);
});

it('accepts an actionable note draft offer but not its read only preview', () => {
  const draft = { title: 'Draft', content: 'Words', type: 'note' as const, tags: [], scriptureRefs: [] };
  const props = { draft, copies: [], selectedKey: '', onSelect: () => undefined, onRestore: () => undefined, onDiscard: () => undefined };
  const view = render(<div data-note-workspace><NoteDraftRecovery {...props} readOnly /></div>);
  expect(hasNoteQuestion()).toBe(false);
  view.rerender(<div data-note-workspace><NoteDraftRecovery {...props} /></div>);
  expect(hasNoteQuestion()).toBe(true);
});

it('does not accept a real conflict banner outside the current note workspace', () => {
  render(<SaveConflictBanner entityKey="entitySermon" onKeepMine={() => undefined} onTakeTheirs={() => undefined} />);
  expect(hasNoteQuestion()).toBe(false);
});

import { evaluateQuestionHistory, classifySend, type QuestionSnapshot, type ProductionOutcome } from '@test-utils/noteOrderingOracles';

const values = { title: 'Original', content: 'Words', tags: [], scriptureRefs: [], type: 'note' as const };
const snapshot = (overrides: Partial<QuestionSnapshot> = {}): QuestionSnapshot => ({ eventIndex: 0,
  pageValues: values, storedValues: values, question: false, blocked: false, ...overrides });

it('I3 permits a real question to persist after later equality and counts the stale final state', () => {
  expect(evaluateQuestionHistory([{ kind: 'arriveOther' }, { kind: 'arriveLive' }], [
    snapshot(), snapshot({ question: true, blocked: true, storedValues: { ...values, content: 'Different' } }),
    snapshot({ eventIndex: 1, question: true, blocked: true }),
  ])).toEqual({ falseQuestion: false, staleQuestion: true, lateRefusalQuestion: false });
});
it.each(['question', 'blocked'] as const)('I3 rejects a newly arising %s at equality, including a later rise', field => {
  expect(evaluateQuestionHistory([{ kind: 'arriveOther' }], [snapshot(), snapshot({ [field]: true })]).falseQuestion).toBe(true);
  expect(evaluateQuestionHistory([{ kind: 'arriveOther' }], [
    snapshot({ [field]: true, storedValues: { ...values, title: 'Different' } }), snapshot(), snapshot({ [field]: true }),
  ]).falseQuestion).toBe(true);
});
it('I3 rejects refusals in a history without any other-device arrival', () => {
  expect(evaluateQuestionHistory([{ kind: 'type' }], [
    snapshot({ question: true, storedValues: { ...values, content: 'Different' } }),
  ]).falseQuestion).toBe(true);
});
it('G2 counts a proven late refusal separately without exempting no-arrival histories', () => {
  const steps = [snapshot({ sequence: 1, storedValues: { ...values, content: 'Different' } }),
    snapshot({ sequence: 3 }), snapshot({ sequence: 5, question: true, blocked: true, refusedRequests: [{ issued: 2, refused: 4 }] })];
  expect(evaluateQuestionHistory([{ kind: 'arriveLive' }], steps)).toEqual({ falseQuestion: false, staleQuestion: false, lateRefusalQuestion: true });
  expect(evaluateQuestionHistory([{ kind: 'type' }], steps).falseQuestion).toBe(true);
  // G2 bounds issuance, not refusal delivery: rendering may lag a refusal received before equality.
  expect(evaluateQuestionHistory([{ kind: 'arriveLive' }], [
    steps[0], steps[1], { ...steps[2], refusedRequests: [{ issued: 2, refused: 2.5 }] },
  ]).lateRefusalQuestion).toBe(true);
  expect(evaluateQuestionHistory([{ kind: 'arriveLive' }], [steps[0], steps[1], { ...steps[2], refusedRequests: [{ issued: 3, refused: 4 }] }]).falseQuestion).toBe(true);
});
it('G4 permits exactly the five recorded causes and rejects every other send increase', () => {
  const production: ProductionOutcome = { events: [], stored: 'Words', sends: 1, question: false, blocked: false,
    unconverged: false, dropped: [], falseRefusal: '' };
  const candidate = { ...production, sends: 2 };
  expect(classifySend(candidate, production)).toBe('EXTRA WRITE');
  expect(classifySend(candidate, { ...production, falseRefusal: 'recorded refusal' })).toBe('false-question');
  expect(classifySend(candidate, { ...production, dropped: ['Words'] })).toBe('stored-dropped-words');
  expect(classifySend(candidate, { ...production, unconverged: true })).toBe('converged');
  expect(classifySend(candidate, { ...production, question: true, blocked: true })).toBe('converged');
  expect(classifySend({ ...candidate, question: true }, { ...production, unconverged: true })).toBe('EXTRA WRITE');
  expect(classifySend({ ...candidate, keptWordsLateRefusal: true }, production)).toBe('kept-words-late-refusal');
  expect(classifySend({ ...candidate, splitDictations: true }, production)).toBe('split-dictations');
});
