import { serializeContent } from '@/utils/contentFingerprint';
import type { NoteDraftPayload } from '@/(pages)/(private)/studies/[id]/noteDraft';

export type QuestionSnapshot = {
  eventIndex: number;
  sequence?: number;
  refusedRequests?: readonly { issued: number; refused: number }[];
  pageValues: NoteDraftPayload;
  storedValues: NoteDraftPayload;
  question: boolean;
  blocked: boolean;
};

/** A refusal is judged when it arises. Later equality does not answer an existing question. */
export function evaluateQuestionHistory(events: readonly { kind: string }[], steps: readonly QuestionSnapshot[]) {
  let question = false, blocked = false, falseQuestion = false, lateRefusalQuestion = false;
  let equalSince = 0, wasEqual = false, staleQuestion = false;
  const arrived = events.some(event => ['arriveSame', 'arriveOther', 'arriveLive'].includes(event.kind));
  for (const [index, step] of steps.entries()) {
    const equal = serializeContent(step.pageValues) === serializeContent(step.storedValues);
    const sequence = step.sequence ?? index;
    if (equal && !wasEqual) equalSince = sequence;
    const arising = (step.question && !question) || (step.blocked && !blocked);
    if ((step.question || step.blocked) && !arrived) falseQuestion = true;
    if (arising && equal) {
      const late = step.refusedRequests?.some(request => request.issued < equalSince
        && request.refused <= sequence);
      if (late) lateRefusalQuestion = true;
      else falseQuestion = true;
    }
    if (equal && !wasEqual && (question || blocked) && (step.question || step.blocked)) staleQuestion = true;
    question = step.question; blocked = step.blocked; wasEqual = equal;
  }
  return { falseQuestion, staleQuestion, lateRefusalQuestion };
}

export type SendOutcome = { stored: string; question: boolean; blocked: boolean; unconverged: boolean; sends: number; keptWordsLateRefusal?: boolean; splitDictations?: boolean };
export type ProductionOutcome = SendOutcome & { events: readonly { kind: string; word?: string }[]; dropped: readonly string[]; falseRefusal: string };

/** G4 is a closed list. Each flag is established from recorded command/event traces. */
export function classifySend(candidate: SendOutcome, production: ProductionOutcome) {
  if (candidate.sends <= production.sends) return 'no-increase';
  if (production.falseRefusal) return 'false-question';
  if (production.dropped.some(word => candidate.stored.includes(word))) return 'stored-dropped-words';
  if (!candidate.question && !candidate.blocked && !candidate.unconverged
    && (production.unconverged || production.question || production.blocked)) return 'converged';
  if (candidate.keptWordsLateRefusal) return 'kept-words-late-refusal';
  if (candidate.splitDictations) return 'split-dictations';
  return 'EXTRA WRITE';
}
