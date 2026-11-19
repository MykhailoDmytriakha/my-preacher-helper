import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { generateChoiceHistory, shrinkChoiceHistory } from '@test-utils/noteChoiceGenerator';
import { runChoiceHistory, type ChoiceAction, type ChoiceRun } from '@test-utils/noteChoiceHistory';
import { choiceOracleNames, choiceVerdicts, type ChoiceOracle } from '@test-utils/noteChoiceOracles';

const actions = (kinds: string): ChoiceAction[] => kinds.split(' ').map((kind, index) => ({ kind: kind as ChoiceAction['kind'], word: `Fixed${index}X` }));
// These assert fixture execution only. Expected product failures belong to the opt-in hunt.
it.each([
  'holdTransport type timer phoneOther releaseTransport openNotice keep type timer',
  'holdTransport type timer phoneOther releaseTransport openNotice take confirmTake',
  'holdTransport type timer phoneOther releaseTransport openNotice pauseKeep type resume',
  'holdCollection dictate done edit offline phoneLive online deliverAll timer',
  'type phoneOther timer inlineKeep type timer',
  'type phoneOther timer inlineTake confirmTake type timer',
  'holdCollection phoneBase deliverLatest',
  'holdTransport type timer phoneOther releaseTransport done openNotice take confirmTake phoneLive edit',
])('choice stand executes public events: %s', async history => {
  const row = await runChoiceHistory(actions(history), 'smoke');
  expect(row.invalid).toBeUndefined();
  expect(row.valid).toBe(true);
  expect(row.terminal).toBeDefined();
}, 60000);

function isRepeatedGap(row: ChoiceRun, index: number, unrendered: boolean) {
  const answer = row.answers[index], previous = row.answers[index - 1], observed = answer.rejectionWitness;
  return !!(answer.kind === 'keep' && answer.surface === 'notice' && previous?.kind === 'keep'
    && previous.surface === 'notice' && previous.replacement === 'refused' && answer.rejectedShown
    && answer.noRenderRefusal === unrendered && observed?.pauseArmed && !observed.replacementCaptured
    && answer.replacementEditorId && row.actions[answer.event].kind === 'pauseKeep');
}

const mode = process.env.NOTE_CHOICE_HUNT;
const hunt = mode ? it : it.skip;
hunt('measures randomized version-choice histories', async () => {
  const selectedSeeds: number[] | undefined = process.env.NOTE_CHOICE_SEEDS ? JSON.parse(readFileSync(process.env.NOTE_CHOICE_SEEDS, 'utf8')) : undefined;
  const count = selectedSeeds?.length ?? (process.env.NOTE_CHOICE_SEED ? 1 : Number(process.env.NOTE_CHOICE_COUNT ?? (mode === 'full' ? 4096 : 256)));
  const first = Number(process.env.NOTE_CHOICE_SEED ?? 1250001);
  const corpus: { id: string; actions: ChoiceAction[] }[] | undefined = process.env.NOTE_CHOICE_CORPUS
    ? JSON.parse(readFileSync(process.env.NOTE_CHOICE_CORPUS, 'utf8')) : undefined;
  const production: Record<string, { actions: ChoiceAction[]; valid: boolean; sends: number }> = process.env.NOTE_CHOICE_PRODUCTION
    ? JSON.parse(readFileSync(process.env.NOTE_CHOICE_PRODUCTION, 'utf8')) : {};
  const totals = Object.fromEntries(choiceOracleNames.map(name => [name, { violations: 0, notApplicable: 0, histories: 0 }])) as Record<ChoiceOracle, { violations: number; notApplicable: number; histories: number }>;
  const witnesses: Partial<Record<ChoiceOracle, ChoiceRun>> = {};
  const validations: Record<string, ChoiceRun> = {};
  const records: { id: string; actions: ChoiceAction[] }[] = [];
  const budgets: typeof production = {};
  let invalid = 0;
  for (let index = 0; index < count; index++) {
    let entry = corpus?.[process.env.NOTE_CHOICE_SEED ? first - 1250001 : index];
    if (process.env.NOTE_CHOICE_STREAM) {
      while (!entry) {
        const path = process.env.NOTE_CHOICE_STREAM;
        if (existsSync(path)) {
          const lines = readFileSync(path, 'utf8').split('\n').slice(0, -1);
          if (lines.length > index && lines[index]) entry = JSON.parse(lines[index]);
        }
        if (!entry) await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    const row = entry ? await runChoiceHistory(entry.actions, entry.id) : await generateChoiceHistory(selectedSeeds?.[index] ?? first + index);
    records.push({ id: row.id, actions: row.actions });
    if (process.env.NOTE_CHOICE_SAVE_STREAM) appendFileSync(process.env.NOTE_CHOICE_SAVE_STREAM, JSON.stringify(records.at(-1)) + '\n');
    budgets[row.id] = { actions: row.actions, valid: row.valid, sends: row.terminal.sends };
    const baseline = production[row.id];
    if (baseline?.valid && JSON.stringify(baseline.actions) === JSON.stringify(row.actions)) {
      row.sameHistoryOnProduction = row.valid; row.productionSends = baseline.sends;
    }
    if (row.valid) row.verdicts = choiceVerdicts(row);
    if (!row.valid) invalid++;
    for (const name of choiceOracleNames) {
      const verdict = row.valid ? row.verdicts[name] : 'not applicable';
      totals[name].histories++;
      totals[name].violations += Number(verdict === 'violation');
      totals[name].notApplicable += Number(verdict === 'not applicable');
      if (verdict === 'violation' && (!witnesses[name] || row.actions.length < witnesses[name]!.actions.length)) witnesses[name] = row;
    }
    if (row.valid && row.verdicts.C1 === 'violation' && !row.actions.some(action => action.kind === 'done')) {
      const unrendered = row.answers.some((_, index) => isRepeatedGap(row, index, true));
      const rendered = !row.actions.some(action => action.kind === 'holdCollection')
        && row.answers.some((_, index) => isRepeatedGap(row, index, false));
      const key = unrendered ? 'unrendered' : rendered ? 'rendered' : undefined;
      if (key && (!validations[key] || row.actions.length < validations[key].actions.length)) validations[key] = row;
    }
    if (row.valid && row.verdicts.C2 === 'violation') {
      const key = row.answers.at(-1)?.collectionHeldAtChoice ? 'delayedTake' : 'take';
      if (!validations[key] || row.actions.length < validations[key].actions.length) validations[key] = row;
    }
    if (process.env.NOTE_CHOICE_OUTPUT) appendFileSync(process.env.NOTE_CHOICE_OUTPUT, JSON.stringify({
      id: row.id, actions: row.actions, valid: row.valid, invalid: row.invalid, verdicts: row.verdicts,
      terminal: row.terminal, questionSteps: row.verdicts.I3 === 'violation' ? row.questions : undefined, checkpoints: row.checkpoints, violatedAtSteps: row.violatedAtSteps, answers: row.answers, continuation: row.continuation,
    }) + '\n');
    if (index % 64 === 0) console.info('CHOICE_PROGRESS', index, JSON.stringify(totals));
  }
  if (process.env.NOTE_CHOICE_SAVE_CORPUS) writeFileSync(process.env.NOTE_CHOICE_SAVE_CORPUS, JSON.stringify(records));
  if (process.env.NOTE_CHOICE_SAVE_BUDGETS) writeFileSync(process.env.NOTE_CHOICE_SAVE_BUDGETS, JSON.stringify(budgets));
  const minima: Record<string, unknown> = {};
  if (process.env.NOTE_CHOICE_SHRINK !== '0') {
    for (const [name, row] of Object.entries(witnesses)) {
      // C5 needs the paired production replay; its raw witness is retained if that
      // separate process is unavailable. Never label a missing comparison a pass.
      minima[name] = name === 'C5' ? { seed: row.id, actions: row.actions, limitation: 'paired baseline required for shrinking' }
        : await shrinkChoiceHistory(row, name as ChoiceOracle);
    }
    for (const [key, row] of Object.entries(validations)) minima[key] = await shrinkChoiceHistory(row,
      key === 'take' || key === 'delayedTake' ? 'C2' : 'C1', undefined, candidate => {
        if (key === 'delayedTake' || key === 'take') return candidate.answers.at(-1)?.collectionHeldAtChoice === (key === 'delayedTake');
        if (candidate.actions.some(action => action.kind === 'done')) return false;
        if (key === 'rendered' && candidate.actions.some(action => action.kind === 'holdCollection')) return false;
        return candidate.answers.some((_, index) => isRepeatedGap(candidate, index, key === 'unrendered'));
      });
  }
  const summary = { mode, count, invalid, totals, minima };
  if (process.env.NOTE_CHOICE_SUMMARY) writeFileSync(process.env.NOTE_CHOICE_SUMMARY, JSON.stringify(summary, null, 2));
  process.stdout.write('NOTE_CHOICE_HUNT ' + JSON.stringify(summary) + '\n');
  if (process.env.NOTE_CHOICE_ASSERT === '1') expect(Object.values(totals).reduce((sum, total) => sum + total.violations, 0)).toBe(0);
}, 43200000);
