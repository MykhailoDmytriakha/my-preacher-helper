// The default fixture contains only the 256 reduced histories. Full data is external.
import { readFileSync } from 'node:fs';
import measured from './noteOrdering.production.json';
import { classifySend, type ProductionOutcome } from './noteOrderingOracles';
import type { runHistory } from './noteOrdering';

type Measured = [ProductionOutcome['events'], number, number, number, number, string, string[], string];
export const hasFullProductionCorpus = !!process.env.NOTE_ORDERING_PRODUCTION_CORPUS;
const outcomes = (hasFullProductionCorpus
  ? JSON.parse(readFileSync(process.env.NOTE_ORDERING_PRODUCTION_CORPUS!, 'utf8')) : measured) as Record<string, Measured>;

export function compareProduction(mode: string, row: Awaited<ReturnType<typeof runHistory>>) {
  const record = outcomes[`${mode}:${row.id}`];
  if (!record) throw new Error(`Missing production history ${mode}:${row.id}`);
  const [events, sends, question, blocked, unconverged, stored, dropped, falseRefusal] = record;
  expect(row.events).toEqual(events);
  const production: ProductionOutcome = { events, sends, question: !!question, blocked: !!blocked,
    unconverged: !!unconverged, stored, dropped, falseRefusal };
  const written = row.requests.map(request => request.command.kind === 'create' ? request.command.value
    : request.command.kind === 'update' ? Object.fromEntries(request.command.changes
      .filter(change => change.path.length === 1 && change.after.exists)
      .map(change => [change.path[0], change.after.exists ? change.after.value : undefined])) : {});
  const kept = dropped.filter(word => row.final.editor.includes(word) && row.final.dom.includes(word) && row.final.unsaved);
  // Match the refused request and its intended content, never a word in its old "before" value.
  const keptWordsLateRefusal = kept.length > 0 && row.requests.some((request, index) => request.refused !== undefined
    && request.response?.kind === 'conflict' && row.final.pending.some(pending => pending.command.operationId === request.operationId && pending.state === 'conflict')
    && kept.some(word => typeof written[index].content === 'string' && written[index].content.includes(word)));
  const dictations = row.events.filter(event => ['dictate', 'typeDictate', 'dictateType'].includes(event.kind));
  const dictationSources = dictations.map(event => 'source-' + event.word + (event.kind === 'dictate' ? '' : 'D'));
  const sourceLists = written.map(value => Array.isArray(value.dictationSourceIds) ? value.dictationSourceIds : []);
  // Exactly two dictated actions, each carried by a different request, with the same final stored text.
  const splitDictations = dictations.length === 2 && sends === 1 && row.requests.length === 2
    && row.final.stored === stored && sourceLists[0].includes(dictationSources[0])
    && !sourceLists[0].includes(dictationSources[1]) && sourceLists[1].includes(dictationSources[1]);
  const candidate = { stored: row.final.stored, question: row.final.question, blocked: !!row.final.blocked,
    unconverged: row.unconverged, sends: row.final.engineWrites, keptWordsLateRefusal, splitDictations };
  const sendCause = classifySend(candidate, production);
  return { production, sendCause, extraWrite: sendCause === 'EXTRA WRITE', sendFailure: sendCause === 'EXTRA WRITE',
    keptWordsLateRefusal: candidate.unconverged && !production.unconverged && keptWordsLateRefusal,
    convergenceRegression: candidate.unconverged && !production.unconverged && !keptWordsLateRefusal };
}
