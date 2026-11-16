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
  ])).toEqual({ falseQuestion: false, staleQuestion: true });
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
it('the send gate gives EXTRA WRITE priority over every claimed cause', () => {
  const production: ProductionOutcome = { events: [], stored: 'Words', sends: 1, question: false, blocked: false,
    unconverged: false, dropped: ['Words'], falseRefusal: 'claimed' };
  expect(classifySend({ ...production, sends: 2 }, production)).toBe('EXTRA WRITE');
  expect(classifySend({ ...production, stored: 'New', sends: 2 }, { ...production, falseRefusal: '' })).toBe('unclassified');
});
