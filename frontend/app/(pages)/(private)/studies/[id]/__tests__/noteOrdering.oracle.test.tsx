import { hasNoteQuestion, runHistory } from '@test-utils/noteOrdering';
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

import { evaluateQuestionHistory, type QuestionSnapshot } from '@test-utils/noteOrderingOracles';

const values = { title: 'Original', content: 'Words', tags: [], scriptureRefs: [], type: 'note' as const };
const snapshot = (overrides: Partial<QuestionSnapshot> = {}): QuestionSnapshot => ({ eventIndex: 0,
  pageValues: values, storedValues: values, question: false, blocked: false, ...overrides });

it('I3 permits a real question to persist after later equality and counts the stale final state', () => {
  expect(evaluateQuestionHistory([{ kind: 'arriveOther' }, { kind: 'arriveLive' }], [
    snapshot(), snapshot({ question: true, blocked: true, storedValues: { ...values, content: 'Different' } }),
    snapshot({ eventIndex: 1, question: true, blocked: true }),
  ])).toEqual({ falseQuestion: false, staleQuestion: true, lateRefusalQuestion: false, offlineQuestion: false });
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
  expect(evaluateQuestionHistory([{ kind: 'arriveLive' }], steps)).toEqual({ falseQuestion: false, staleQuestion: false, lateRefusalQuestion: true, offlineQuestion: false });
  expect(evaluateQuestionHistory([{ kind: 'type' }], steps).falseQuestion).toBe(true);
  // G2 bounds issuance, not refusal delivery: rendering may lag a refusal received before equality.
  expect(evaluateQuestionHistory([{ kind: 'arriveLive' }], [
    steps[0], steps[1], { ...steps[2], refusedRequests: [{ issued: 2, refused: 2.5 }] },
  ]).lateRefusalQuestion).toBe(true);
  expect(evaluateQuestionHistory([{ kind: 'arriveLive' }], [steps[0], steps[1], { ...steps[2], refusedRequests: [{ issued: 3, refused: 4 }] }]).falseQuestion).toBe(true);
});
it('I3 judges an offline question against the last received row, without treating offline as an exemption', () => {
  const events = [{ kind: 'type' }, { kind: 'arriveOther' }, { kind: 'offline' }, { kind: 'arriveLive' }, { kind: 'timer' }];
  const different = { ...values, content: 'Phone words' };
  const steps = [snapshot({ eventIndex: 1, storedValues: different }),
    snapshot({ eventIndex: 2, online: false, receivedValues: different, storedValues: different }),
    snapshot({ eventIndex: 4, online: false, receivedValues: different, question: true, blocked: true })];
  expect(evaluateQuestionHistory(events, steps)).toEqual({ falseQuestion: false, staleQuestion: false,
    lateRefusalQuestion: false, offlineQuestion: true });
  // Offline is no exemption: asking about the row this device knows to be equal fails.
  expect(evaluateQuestionHistory(events, [snapshot({ eventIndex: 2, storedValues: values }),
    snapshot({ eventIndex: 4, online: false, receivedValues: values, question: true })]).falseQuestion).toBe(true);
});

it('I3 records the five-event offline question against the last known row', async () => {
  const row = await runHistory([{ kind: 'type', word: 'Localword' }, { kind: 'arriveOther', word: 'Phoneword' },
    { kind: 'offline' }, { kind: 'arriveLive' }, { kind: 'timer' }], 'I3:offline-last-known');
  expect(row.falseQuestion).toBe(false);
  expect(row.offlineQuestion).toBe(true);
  expect(row.final).toMatchObject({ question: false, saved: true, engineWrites: 1 });
  expect(row.final.editor).toContain('Localword');
  expect(row.final.stored).toBe(row.final.page);
});
