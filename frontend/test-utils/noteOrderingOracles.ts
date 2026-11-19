import { serializeContent } from '@/utils/contentFingerprint';
import type { NoteDraftPayload } from '@/(pages)/(private)/studies/[id]/noteDraft';

export type QuestionSnapshot = {
  eventIndex: number;
  sequence?: number;
  online?: boolean;
  receivedValues?: NoteDraftPayload;
  refusedRequests?: readonly { issued: number; refused: number }[];
  pageValues: NoteDraftPayload;
  storedValues: NoteDraftPayload;
  question: boolean;
  blocked: boolean;
};

/** A refusal is judged when it arises. Later equality does not answer an existing question. */
export function evaluateQuestionHistory(events: readonly { kind: string }[], steps: readonly QuestionSnapshot[]) {
  let question = false, blocked = false, falseQuestion = false, lateRefusalQuestion = false;
  let equalSince = 0, wasEqual = false, staleQuestion = false, offlineQuestion = false;
  const hasOffline = events.some(event => event.kind === 'offline');
  const arrived = events.some(event => ['arriveSame', 'arriveOther', 'arriveLive'].includes(event.kind));
  for (const [index, step] of steps.entries()) {
    // Explicit device observations are required for offline histories. Recorded
    // corpora missing these fields are supplemented by targeted history replays.
    if (hasOffline && step.online === undefined && (step.question || step.blocked)) {
      throw new Error('Missing connectivity for a recorded question; replay this history');
    }
    const connected = step.online ?? true;
    const known = connected ? step.storedValues : step.receivedValues;
    if (!known) throw new Error('Missing last received row for an offline question observation');
    const equal = serializeContent(step.pageValues) === serializeContent(known);
    const sequence = step.sequence ?? index;
    if (equal && !wasEqual) equalSince = sequence;
    const arising = (step.question && !question) || (step.blocked && !blocked);
    if ((step.question || step.blocked) && !arrived) falseQuestion = true;
    if (arising && !connected && !equal) offlineQuestion = true;
    if (arising && equal) {
      const late = step.refusedRequests?.some(request => request.issued < equalSince
        && request.refused <= sequence);
      if (late) lateRefusalQuestion = true;
      else falseQuestion = true;
    }
    if (equal && !wasEqual && (question || blocked) && (step.question || step.blocked)) staleQuestion = true;
    question = step.question; blocked = step.blocked; wasEqual = equal;
  }
  return { falseQuestion, staleQuestion, lateRefusalQuestion, offlineQuestion };
}
