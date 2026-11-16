import { runHistory, rng, type OrderingEvent } from '@test-utils/noteOrdering';
import { productionFalseRefusals, productionOutcomes, shortestWitnesses } from '@test-utils/noteOrderingProduction';

const full = process.env.NOTE_ORDERING_HUNT === 'full';
const baseline = process.env.NOTE_ORDERING_BASELINE === '1';
const seeds = full ? [11, 29, 85, 3418] : [11, 29];
const count = full ? 512 : 64;
export const extendedAlphabet: OrderingEvent['kind'][] = ['type', 'arriveSame', 'arriveOther', 'timer', 'ack', 'offline', 'online', 'dictate', 'doneEdit', 'typeDictate', 'dictateType'];
const modes = process.env.NOTE_ORDERING_ALPHABET ? [process.env.NOTE_ORDERING_ALPHABET] : ['random', 'extended'];
const totals: Record<string, { histories: number; I1: number; I2: number; I3: number; sends: number; questions: number; productionSends: number; productionQuestions: number; increased: string[] }> = {};
for (const mode of modes) {
  const sum: (typeof totals)[string] = totals[mode] = { histories: 0, I1: 0, I2: 0, I3: 0, sends: 0, questions: 0, productionSends: 0, productionQuestions: 0, increased: [] };
  it.each(seeds)(`${mode} preserves words and avoids false questions, seed %i`, async seed => {
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
      const [sends, question, blocked] = productionOutcomes[mode][seed][h];
      const increased = row.final.engineWrites > sends;
      // An extra send is allowed only when production refused this very history with a false question.
      const productionFalseQuestion = !!(question || blocked) && (!events.some(event => ['arriveSame', 'arriveOther'].includes(event.kind))
        || (mode === 'extended' && productionFalseRefusals.has(row.id)));
      sum.histories++; sum.I1 += Number(!!row.missingArrived.length); sum.I2 += Number(!!row.missingTyped.length); sum.I3 += Number(row.falseQuestion);
      sum.sends += row.final.engineWrites; sum.questions += Number(row.final.question); sum.productionSends += sends; sum.productionQuestions += question;
      if (increased) sum.increased.push(row.id);
      if (baseline) expect([row.final.engineWrites, Number(row.final.question), Number(row.final.blocked)]).toEqual([sends, question, blocked]);
      else if (row.missingArrived.length || row.missingTyped.length || row.falseQuestion || (increased && !productionFalseQuestion)) failures.push(row);
    }
    expect(failures).toEqual([]);
  }, full ? 1200000 : 60000);
}
afterAll(() => console.info('NOTE_ORDERING_HUNT', JSON.stringify(totals)));

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

const exhaustive = process.env.NOTE_ORDERING_EXHAUSTIVE === '1' ? it : it.skip;
const prefixes = [null, ...extendedAlphabet].filter((_, index) => !process.env.NOTE_ORDERING_EXHAUSTIVE_SHARD
  || index === Number(process.env.NOTE_ORDERING_EXHAUSTIVE_SHARD));
exhaustive.each(prefixes)('checks every sequence up to length four starting with %s', async prefix => {
  const sum = { histories: 0, I1: 0, I2: 0, I3: 0, sends: 0, questions: 0 };
  const failures: unknown[] = [];
  async function visit(kinds: OrderingEvent['kind'][]) {
    const events = kinds.map((kind, index) => ({ kind, word: `ExhaustiveE${index}X` }));
    const row = await runHistory(events, `exhaustive:${prefix ?? 'empty'}:${sum.histories}`);
    sum.histories++; sum.I1 += Number(!!row.missingArrived.length); sum.I2 += Number(!!row.missingTyped.length); sum.I3 += Number(row.falseQuestion);
    sum.sends += row.final.engineWrites; sum.questions += Number(row.final.question);
    if (row.missingArrived.length || row.missingTyped.length || row.falseQuestion) failures.push(row);
    if (prefix !== null && kinds.length < 4) for (const kind of extendedAlphabet) await visit([...kinds, kind]);
  }
  await visit(prefix === null ? [] : [prefix]);
  console.info('NOTE_ORDERING_EXHAUSTIVE', prefix, JSON.stringify(sum));
  expect(failures).toEqual([]);
}, 1200000);
