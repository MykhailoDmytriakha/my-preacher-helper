import { evaluateQuestionHistory, type QuestionSnapshot } from './noteOrderingOracles';

export const choiceOracleNames = ['I1', 'I2', 'I3', 'I4', 'C1', 'C2', 'C3', 'C4', 'C5'] as const;
export type ChoiceOracle = typeof choiceOracleNames[number];
export type Verdict = 'pass' | 'violation' | 'not applicable';
export type ChoiceSnapshot = {
  event: number; sequence: number; editor: string; page: string; stored: string;
  confirmed?: string; editorMounted: boolean; dom: string; question: boolean; saved: boolean; unsaved: boolean;
  noticeText?: string; pageValues?: unknown; storedValues?: unknown; confirmedValues?: unknown;
  coveredWords: string[]; sends: number; renders: number; collectionHeld: boolean;
};
export type Answer = {
  kind: 'keep' | 'take'; event: number; sequence: number; remote: string; local: string;
  captureSequence?: number; newer: string[]; sendStart: number; remoteEpoch: number;
  surface: 'notice' | 'inline'; noRenderRefusal: boolean; collectionHeldAtChoice: boolean; replacement?: 'accepted' | 'refused';
  completed: boolean; rejectedShown: boolean; rejectionWitness?: { event: number; editor: string; page: string; remote: string; renders: number; pauseArmed?: boolean; replacementCaptured?: boolean }; replacementEditorId?: string; replacementRequestId?: string;
};
export type ChoiceObservation = {
  events: readonly { kind: string }[]; steps: ChoiceSnapshot[]; questions: QuestionSnapshot[];
  arrived: string[]; typed: { word: string; sequence: number }[]; answers: Answer[];
  continuation?: { nextSaved: boolean; cleanArrival?: boolean; nextEditor: string; nextStored: string; question: boolean; arrivalEditor?: string; arrivalStored?: string; arrivalQuestion?: boolean };
  violatedAtSteps?: Partial<Record<ChoiceOracle, number[]>>;
  remoteEpoch: number; productionSends?: number; sameHistoryOnProduction?: boolean;
};

/** I1..I4 are copied verbatim in meaning from runHistory; no choice exemptions added. */
export function choiceVerdicts(row: ChoiceObservation): Record<ChoiceOracle, Verdict> {
  const final = row.steps.at(-1)!;
  const verdict = (value: boolean): Verdict => value ? 'violation' : 'pass';
  const missingArrived = row.arrived.filter(word => !final.stored.includes(word) && !final.question);
  const missingTyped = row.typed.filter(({ word }) => !final.stored.includes(word)
    && !(final.editor.includes(word) && final.dom.includes(word) && final.unsaved) && !final.question);
  const { falseQuestion } = evaluateQuestionHistory(row.events, row.questions);
  const last = row.answers.at(-1);
  const terminal = !!last?.completed && last.remoteEpoch === row.remoteEpoch;
  const c2 = terminal && final.editorMounted && last?.kind === 'take' && last.newer.length === 0
    && !row.typed.some(token => token.sequence > (last.captureSequence ?? -1));
  const c3 = terminal && final.editorMounted && last?.kind === 'keep' && last.replacement === 'accepted'
    && !row.typed.some(token => token.sequence > last.sequence);
  const protectedWords = last?.captureSequence === undefined ? []
    : row.typed.filter(token => token.sequence > last.captureSequence!).map(token => token.word);
  const result: Record<ChoiceOracle, Verdict> = {
    I1: verdict(missingArrived.length > 0), I2: verdict(missingTyped.length > 0),
    I3: verdict(falseQuestion),
    I4: verdict(!final.question && (final.stored !== final.page || final.page !== final.editor || final.unsaved)),
    C1: row.answers.some(answer => answer.kind === 'keep' && answer.remote !== answer.local)
      ? verdict(row.answers.some(answer => answer.rejectedShown)) : 'not applicable',
    C2: c2 && (final.editor !== last.remote || final.question) ? 'violation'
      : c2 && row.continuation ? verdict(!row.continuation.nextSaved) : 'not applicable',
    C3: c3 && final.stored !== final.editor ? 'violation'
      : c3 && row.continuation ? verdict(!row.continuation.nextSaved || row.continuation.cleanArrival !== true) : 'not applicable',
    C4: protectedWords.length && final.editorMounted ? verdict(protectedWords.some(word => !final.editor.includes(word)
      || (!final.stored.includes(word) && !final.coveredWords.includes(word)))) : 'not applicable',
    C5: row.sameHistoryOnProduction && row.productionSends !== undefined
      ? verdict(final.sends > row.productionSends) : 'not applicable',
  };
  for (const name of ['I1', 'I2', 'I3', 'C1'] as const) if (row.violatedAtSteps?.[name]?.length) result[name] = 'violation';
  return result;
}
