import { runHistory, rng, type OrderingEvent } from '@test-utils/noteOrdering';
import { compareProduction, hasFullProductionCorpus } from '@test-utils/noteOrderingComparison';
import { shortestWitnesses } from '@test-utils/noteOrderingProduction';

const full = process.env.NOTE_ORDERING_HUNT === 'full';
const baseline = process.env.NOTE_ORDERING_BASELINE === '1';
const observe = process.env.NOTE_ORDERING_OBSERVE === '1';
const seeds = full ? [11, 29, 85, 3418] : [11, 29];
const count = full ? 512 : 64;
export const extendedAlphabet: OrderingEvent['kind'][] = ['type', 'arriveSame', 'arriveOther', 'timer', 'ack', 'offline', 'online', 'dictate', 'doneEdit', 'typeDictate', 'dictateType', 'arriveLive'];
const modes = process.env.NOTE_ORDERING_ALPHABET ? [process.env.NOTE_ORDERING_ALPHABET] : ['random', 'extended'];
const totals: Record<string, { histories: number; I1: number; I2: number; I3: number; I4: number; sends: number; questions: number; productionSends: number; productionQuestions: number; increased: string[] }> = {};
if ((full || process.env.NOTE_ORDERING_EXHAUSTIVE === '1') && !hasFullProductionCorpus) {
  process.stderr.write('Full/exhaustive comparisons skipped: set NOTE_ORDERING_PRODUCTION_CORPUS to the production corpus path.\n');
}
const seeded = full && !hasFullProductionCorpus ? it.skip : it;
for (const mode of modes) {
  const sum: (typeof totals)[string] = totals[mode] = { histories: 0, I1: 0, I2: 0, I3: 0, I4: 0, sends: 0, questions: 0, productionSends: 0, productionQuestions: 0, increased: [] };
  seeded.each(seeds)(`${mode} preserves words and avoids false questions, seed %i`, async seed => {
    const next = rng(seed);
    const kinds = mode === 'extended' ? ['type', ...extendedAlphabet] : ['type', ...extendedAlphabet.slice(0, 8)];
    const failures: unknown[] = [];
    for (let h = 0; h < count; h++) {
      const length = 1 + Math.floor(next() * 8);
      const events: OrderingEvent[] = [];
      for (let e = 0; e < length; e++) {
        const kind = kinds[Math.floor(next() * kinds.length)] as OrderingEvent['kind'];
        events.push({ kind, ...(['type', 'arriveSame', 'arriveOther', 'dictate', 'typeDictate', 'dictateType'].includes(kind) ? { word: `W${seed}H${h}E${e}X` } : {}) });
      }
      const row = await runHistory(events, `${seed}:${h}`);
      const comparison = compareProduction(mode, row);
      const { sends, question, blocked } = comparison.production;
      const increased = row.final.engineWrites > sends;
      sum.histories++; sum.I1 += Number(!!row.missingArrived.length); sum.I2 += Number(!!row.missingTyped.length); sum.I3 += Number(row.falseQuestion); sum.I4 += Number(row.unconverged);
      sum.sends += row.final.engineWrites; sum.questions += Number(row.final.question); sum.productionSends += sends; sum.productionQuestions += Number(question);
      if (increased) sum.increased.push(row.id);
      if (observe) continue;
      if (baseline) expect([row.final.engineWrites, Number(row.final.question), Number(row.final.blocked)]).toEqual([sends, Number(question), Number(blocked)]);
      else if (row.missingArrived.length || row.missingTyped.length || row.falseQuestion || comparison.convergenceRegression || comparison.sendFailure) failures.push({
        id: row.id, I1: row.missingArrived, I2: row.missingTyped, I3: row.falseQuestion, I4: row.unconverged,
        convergenceRegression: comparison.convergenceRegression, sendCause: comparison.sendCause,
      });
    }
    expect(failures).toEqual([]);
  }, full ? 1200000 : 60000);
}
afterAll(() => console.info('NOTE_ORDERING_HUNT', JSON.stringify(totals)));

it('I3 rejects a question about fully adopted values after a clean arrival', async () => {
  const row = await runHistory([{ kind: 'arriveOther', word: 'Adoptedword' }], 'I3:clean-arrival');
  expect(row.final.pageValues).toEqual(row.final.storedValues);
  expect(row.falseQuestion).toBe(false);
});

it('I4 converges after the other device stores the live text and silence', async () => {
  const row = await runHistory([{ kind: 'type', word: 'Equalword' }, { kind: 'arriveLive' }], 'I4:equal-arrival');
  expect(row.unconverged).toBe(false);
  expect(row.final.engineWrites).toBe(1);
});

it.each(shortestWitnesses)('preserves the shortest $invariant witness and every proper subsequence', async witness => {
  const outcomes = [];
  const key = witness.invariant === 'I1' ? 'missingArrived' : 'missingTyped';
  for (let mask = 0; mask < (1 << witness.events.length); mask++) {
    const events = witness.events.filter((_, i) => mask & (1 << i));
    const row = await runHistory([...events], `${witness.invariant}:${mask}`);
    outcomes.push({ events, missing: row[key] });
  }
  if (!baseline) expect(outcomes).toEqual(outcomes.map(row => ({ ...row, missing: [] })));
}, 30000);

const exhaustive = process.env.NOTE_ORDERING_EXHAUSTIVE === '1' && hasFullProductionCorpus ? it : it.skip;
const prefixes = [null, ...extendedAlphabet].filter((_, index) => !process.env.NOTE_ORDERING_EXHAUSTIVE_SHARD
  || index === Number(process.env.NOTE_ORDERING_EXHAUSTIVE_SHARD));
exhaustive.each(prefixes)('checks every sequence up to length four starting with %s', async prefix => {
  const sum = { histories: 0, I1: 0, I2: 0, I3: 0, I4: 0, sends: 0, questions: 0 };
  const failures: unknown[] = [];
  async function visit(kinds: OrderingEvent['kind'][]) {
    const events = kinds.map((kind, index) => ({ kind, word: `ExhaustiveE${index}X` }));
    const row = await runHistory(events, `exhaustive:${prefix ?? 'empty'}:${sum.histories}`);
    sum.histories++; sum.I1 += Number(!!row.missingArrived.length); sum.I2 += Number(!!row.missingTyped.length); sum.I3 += Number(row.falseQuestion); sum.I4 += Number(row.unconverged);
    sum.sends += row.final.engineWrites; sum.questions += Number(row.final.question);
    const comparison = compareProduction('exhaustive', row);
    if (row.missingArrived.length || row.missingTyped.length || row.falseQuestion || comparison.convergenceRegression || comparison.sendFailure) failures.push({
      id: row.id, I1: row.missingArrived, I2: row.missingTyped, I3: row.falseQuestion, I4: row.unconverged,
      convergenceRegression: comparison.convergenceRegression, sendCause: comparison.sendCause,
    });
    if (prefix !== null && kinds.length < 4) for (const kind of extendedAlphabet) await visit([...kinds, kind]);
  }
  await visit(prefix === null ? [] : [prefix]);
  console.info('NOTE_ORDERING_EXHAUSTIVE', prefix, JSON.stringify(sum));
  if (!observe) expect(failures).toEqual([]);
}, 1200000);
