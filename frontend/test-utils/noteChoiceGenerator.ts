import { ChoiceMachine, runChoiceHistory, type ChoiceAction, type ChoiceActionKind, type ChoiceRun } from './noteChoiceHistory';
import { choiceVerdicts, type ChoiceOracle } from './noteChoiceOracles';

export function choiceRandom(seed: number) {
  let state = seed >>> 0 || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}

/** State-dependent random walk, not a catalogue of bug histories. Every offered action
 * has positive weight. We favor request/choice boundaries over unrelated extra typing. */
export async function generateChoiceHistory(seed: number): Promise<ChoiceRun> {
  const next = choiceRandom(seed), machine = new ChoiceMachine();
  await machine.boot();
  try {
    const length = 16 + Math.floor(next() * 33);
    for (let index = 0; index < length; index++) {
      const last = machine.steps.at(-1)!;
      const conflict = last.question;
      const continuingChoice = machine.answers.length > 0;
      const latestSend = machine.requests.at(-1);
      const phoneAfterSend = latestSend && machine.actions.slice(latestSend.event + 1)
        .some(action => ['phoneOther', 'phoneLive', 'phoneBase'].includes(action.kind));
      const weights: Partial<Record<ChoiceActionKind, number>> = {
        type: machine.typed.length ? 2 : 18, dictate: machine.typed.length ? 1 : 4,
        timer: machine.transportHeld && !machine.waiting ? 20 : 3,
        holdTransport: conflict ? 35 : 14, releaseTransport: machine.waiting ? (phoneAfterSend ? 50 : 6) : 2,
        phoneOther: machine.waiting ? (phoneAfterSend ? 2 : 40) : continuingChoice ? 1 : 4, phoneLive: 2, phoneBase: 2,
        openNotice: 30, keep: 14, pauseKeep: continuingChoice ? 36 : 14, take: 10, confirmTake: 100,
        holdCollection: conflict || machine.waiting ? 22 : 1,
        deliverLatest: machine.paused ? 30 : 8, deliverAll: machine.paused ? 12 : 4,
        resume: 12, offline: 1, online: 8, done: 1, edit: 10, inlineKeep: 16, inlineTake: 10,
      };
      const offered = machine.offered();
      const total = offered.reduce((sum, kind) => sum + (weights[kind] ?? 1), 0);
      let roll = next() * total;
      const kind = offered.find(candidate => (roll -= weights[candidate] ?? 1) < 0) ?? offered.at(-1)!;
      await machine.step({ kind, ...(['type', 'dictate', 'phoneOther'].includes(kind) ? { word: `S${seed}E${index}X` } : {}) });
      const lastAnswer = machine.answers.at(-1);
      const settledAnswer = lastAnswer?.completed && (lastAnswer.kind === 'take' || lastAnswer.replacement === 'accepted');
      if (index > 3 && settledAnswer && !machine.steps.at(-1)!.question
        && !machine.paused && next() < 0.3) break;
    }
    // Confirmation is part of the chosen public action, not a question left to the runner.
    if (machine.offered().length === 1 && machine.offered()[0] === 'confirmTake') await machine.step({ kind: 'confirmTake' });
    await machine.settleAll();
    const row = machine.observation();
    await machine.continuation(row);
    return { ...row, id: String(seed), actions: [...machine.actions], valid: true, requests: machine.requests,
      terminal: row.steps.at(-1)!, checkpoints: [...machine.checkpoints], verdicts: choiceVerdicts(row) };
  } finally { machine.close(); }
}

/** Replay deletion candidates strictly: never silently skip an impossible public event.
 * First minimize the prefix, then remove chunks and single actions to a fixed point.
 * The returned certificate replays every single deletion; this is a deletion minimum,
 * not a claim of a global minimum over histories outside this seed. */
export async function shrinkChoiceHistory(row: ChoiceRun, oracle: ChoiceOracle,
  replay: (actions: ChoiceAction[]) => Promise<ChoiceRun> = actions => runChoiceHistory(actions, 'shrink'),
  qualifies: (result: ChoiceRun) => boolean = () => true) {
  let actions = row.actions;
  let best = row;
  const attempts: { length: number; valid: boolean; fails: boolean }[] = [];
  async function fails(candidate: ChoiceAction[]) {
    const result = await replay(candidate);
    const failed = result.valid && result.verdicts[oracle] === 'violation' && qualifies(result);
    attempts.push({ length: candidate.length, valid: result.valid, fails: failed });
    if (failed) { best = result; actions = candidate; }
    return failed;
  }
  for (let length = 0; length < actions.length; length++) if (await fails(actions.slice(0, length))) break;
  for (let width = Math.floor(actions.length / 2); width >= 1; width = Math.floor(width / 2)) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = 0; index + width <= actions.length; index++) {
        if (await fails([...actions.slice(0, index), ...actions.slice(index + width)])) { changed = true; break; }
      }
    }
  }
  return { seed: row.id, oracle, actions, terminal: best.terminal, answers: best.answers,
    continuation: best.continuation, verdicts: best.verdicts, attempts };
}
