import { serializeContent } from '@/utils/contentFingerprint';
import type { NoteDraftPayload } from '@/(pages)/(private)/studies/[id]/noteDraft';

export type QuestionSnapshot = {
  eventIndex: number;
  pageValues: NoteDraftPayload;
  storedValues: NoteDraftPayload;
  question: boolean;
  blocked: boolean;
};

/** A refusal is judged when it arises. Later equality does not answer an existing question. */
export function evaluateQuestionHistory(events: readonly { kind: string }[], steps: readonly QuestionSnapshot[]) {
  let question = false, blocked = false, falseQuestion = false;
  const arrived = events.some(event => ['arriveSame', 'arriveOther', 'arriveLive'].includes(event.kind));
  for (const step of steps) {
    const equal = serializeContent(step.pageValues) === serializeContent(step.storedValues);
    if ((step.question || step.blocked) && !arrived) falseQuestion = true;
    if (((step.question && !question) || (step.blocked && !blocked)) && equal) falseQuestion = true;
    question = step.question; blocked = step.blocked;
  }
  const last = steps.at(-1);
  return { falseQuestion, staleQuestion: !!last && (last.question || last.blocked)
    && serializeContent(last.pageValues) === serializeContent(last.storedValues) };
}

export type SendOutcome = { stored: string; question: boolean; blocked: boolean; unconverged: boolean; sends: number };
export type ProductionOutcome = SendOutcome & { events: readonly { kind: string; word?: string }[]; dropped: readonly string[]; falseRefusal: string };

/** The only permitted causes of an increase. Equal outcomes always take precedence. */
export function classifySend(candidate: SendOutcome, production: ProductionOutcome) {
  if (candidate.sends <= production.sends) return 'no-increase';
  if (candidate.stored === production.stored && candidate.question === production.question
    && candidate.blocked === production.blocked && candidate.unconverged === production.unconverged) return 'EXTRA WRITE';
  if (production.falseRefusal) return 'false-question';
  if (production.dropped.some(word => candidate.stored.includes(word))) return 'stored-dropped-words';
  if (production.unconverged && !candidate.unconverged) return 'converged';
  return 'unclassified';
}
