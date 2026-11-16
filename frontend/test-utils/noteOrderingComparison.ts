// Frozen 38ce9c1f6 observations, generated from the unchanged round-1 corpora.
// See research/111-probes/build-baseline.py and baseline-manifest.json for hashes and refusal proofs.
import measured from './noteOrdering.production.json';
import { classifySend, type ProductionOutcome } from './noteOrderingOracles';
import type { runHistory } from './noteOrdering';

type Measured = [ProductionOutcome['events'], number, number, number, number, string, string[], string];
const outcomes = measured as unknown as Record<string, Measured>;

export function compareProduction(mode: string, row: Awaited<ReturnType<typeof runHistory>>) {
  const record = outcomes[`${mode}:${row.id}`];
  if (!record) throw new Error(`Missing production history ${mode}:${row.id}`);
  const [events, sends, question, blocked, unconverged, stored, dropped, falseRefusal] = record;
  expect(row.events).toEqual(events);
  const production: ProductionOutcome = { events, sends, question: !!question, blocked: !!blocked,
    unconverged: !!unconverged, stored, dropped, falseRefusal };
  const candidate = { stored: row.final.stored, question: row.final.question, blocked: !!row.final.blocked,
    unconverged: row.unconverged, sends: row.final.engineWrites };
  const sendCause = classifySend(candidate, production);
  return { production, sendCause, extraWrite: sendCause === 'EXTRA WRITE',
    sendFailure: sendCause === 'EXTRA WRITE' || sendCause === 'unclassified',
    convergenceRegression: candidate.unconverged && !production.unconverged };
}
