import traces from '@test-utils/noteOrdering.promptSave.production.json';
import { provePromptSaveLateRefusal, type PromptSaveProductionTrace } from '@test-utils/noteOrderingPromptSave';
import type { runHistory } from '@test-utils/noteOrdering';

type Row = Awaited<ReturnType<typeof runHistory>>;
function example(key: keyof typeof traces) {
  const production = JSON.parse(JSON.stringify(traces[key])) as PromptSaveProductionTrace;
  const row = { events: production.events, unconverged: true,
    final: { ...production.final, question: false, blocked: false, unsaved: true,
      pending: [{ state: 'conflict', command: { operationId: 'sent' } }] },
    requests: [{ operationId: 'sent', issued: 2, refused: 10, response: { kind: 'conflict' } }],
    steps: production.events.map(event => ({ kind: event.kind, held: 1 })),
  } as unknown as Row;
  return { row, production };
}

it.each([
  ['extended:11:207', 'i-remount-false-question'],
  ['extended:3418:222', 'ii-delayed-dictation'],
  ['exhaustive:exhaustive:arriveLive:1437', 'ii-delayed-dictation'],
  ['exhaustive:exhaustive:arriveLive:1450', 'ii-delayed-dictation'],
  ['exhaustive:exhaustive:arriveLive:1521', 'ii-delayed-dictation'],
  ['exhaustive:exhaustive:arriveLive:1522', 'ii-delayed-dictation'],
] as const)('proves the production delay reason for %s', (key, reason) => {
  const { row, production } = example(key);
  expect(provePromptSaveLateRefusal(row, production)).toBe(reason);
});

it.each(['not-sent-before', 'not-refused', 'not-retained', 'other-operation', 'different-words',
  'different-dom', 'different-storage', 'production-sent', 'missing-reason', 'missing-editor-observation', 'different-events'])(
  'rejects prompt-save classification when %s', missing => {
    const { row, production } = example('exhaustive:exhaustive:arriveLive:1437');
    if (missing === 'not-sent-before') (row.steps[1] as { held: number }).held = 0;
    if (missing === 'not-refused') row.requests[0].refused = undefined;
    if (missing === 'not-retained') row.final.pending = [];
    if (missing === 'other-operation') row.requests[0].operationId = 'different';
    if (missing === 'different-words') row.final.editor += ' lost';
    if (missing === 'different-dom') row.final.dom += ' lost';
    if (missing === 'different-storage') row.final.stored += ' changed';
    if (missing === 'production-sent') production.final.engineWrites = 1;
    if (missing === 'missing-reason') production.attempts = [];
    if (missing === 'missing-editor-observation') production.steps = [];
    if (missing === 'different-events') row.events = [];
    expect(provePromptSaveLateRefusal(row, production)).toBeUndefined();
  });
