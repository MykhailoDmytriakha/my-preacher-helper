import { runHistory, rng, type OrderingEvent } from '@test-utils/noteOrdering';
import { productionSends, shortestWitnesses } from '@test-utils/noteOrderingProduction';

const full = process.env.NOTE_ORDERING_HUNT === 'full';
const seeds = full ? [11, 29, 85, 3418] : [11, 29];
const count = full ? 512 : 64;
const totals = { histories: 0, I1: 0, I2: 0, sends: 0, productionSends: 0, increased: 0 };

it.each(seeds)('preserves arrived and authored words in seeded histories, seed %i', async seed => {
  const next = rng(seed);
  const kinds: OrderingEvent['kind'][] = ['type', 'type', 'arriveSame', 'arriveOther', 'timer', 'ack', 'offline', 'online', 'dictate'];
  const failures: unknown[] = [];
  for (let h = 0; h < count; h++) {
    const length = 1 + Math.floor(next() * 8);
    const events: OrderingEvent[] = [];
    for (let e = 0; e < length; e++) {
      const kind = kinds[Math.floor(next() * kinds.length)];
      events.push({ kind, ...(['type', 'arriveSame', 'arriveOther', 'dictate'].includes(kind) ? { word: `W${seed}H${h}E${e}X` } : {}) });
    }
    const row = await runHistory(events, `${seed}:${h}`);
    const increased = row.final.engineWrites > productionSends[seed][h];
    totals.histories++; totals.I1 += Number(row.missingArrived.length > 0); totals.I2 += Number(row.missingTyped.length > 0);
    totals.sends += row.final.engineWrites; totals.productionSends += productionSends[seed][h]; totals.increased += Number(increased);
    if (row.missingArrived.length || row.missingTyped.length || increased) failures.push(row);
  }
  expect(failures).toEqual([]);
}, full ? 1200000 : 30000);

afterAll(() => console.info('NOTE_ORDERING_HUNT', JSON.stringify(totals)));

it.each(shortestWitnesses)('preserves the shortest $invariant witness and every proper subsequence', async witness => {
  // Collect every subsequence before asserting, so a failing prefix cannot hide the full witness.
  const outcomes = [];
  const key = witness.invariant === 'I1' ? 'missingArrived' : 'missingTyped';
  for (let mask = 0; mask < (1 << witness.events.length); mask++) {
    const events = witness.events.filter((_, i) => mask & (1 << i));
    const row = await runHistory([...events], `${witness.invariant}:${mask}`);
    outcomes.push({ events, missing: row[key] });
  }
  expect(outcomes).toEqual(outcomes.map(row => ({ ...row, missing: [] })));
}, 30000);
