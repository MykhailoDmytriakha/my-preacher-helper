import { serializeContent } from '@/utils/contentFingerprint';
import type { runHistory } from './noteOrdering';
import type { QuestionSnapshot } from './noteOrderingOracles';

export type PromptSaveProductionTrace = {
  events: readonly { kind: string; word?: string }[];
  final: { editor: string; dom: string; page: string; stored: string; engineWrites: number; question: boolean; blocked: boolean };
  steps: readonly { kind: string; editor?: string; held?: number }[];
  questionSteps: readonly QuestionSnapshot[];
  attempts: readonly { eventIndex: number; pageBase: string; declaredBase: string; submitted: string; error?: string; server?: { content?: string } }[];
};

/** A closed, trace-proven pre-existing gap, never an equality-only exemption. */
export function provePromptSaveLateRefusal(row: Awaited<ReturnType<typeof runHistory>>, production?: PromptSaveProductionTrace) {
  if (!production || JSON.stringify(row.events) !== JSON.stringify(production.events)) return;
  const final = row.final, other = production.final;
  // D2(d): identical visible words AND storage, with unsaved local words retained.
  if (!row.unconverged || final.question || final.blocked || !final.unsaved || !other.question || !other.blocked
    || final.editor !== other.editor || final.dom !== other.dom || final.page !== other.page || final.stored !== other.stored) return;
  // The recorded class has one candidate request and zero production transports.
  if (row.requests.length !== 1 || other.engineWrites !== 0) return;
  const request = row.requests[0];
  if (request.response?.kind !== 'conflict' || request.refused === undefined || request.refused <= request.issued
    || !final.pending.some(entry => entry.state === 'conflict' && entry.command.operationId === request.operationId)) return;
  const steps = (row.steps as { kind?: string; held?: number }[]).filter(step => step.kind);
  for (let arrival = 1; arrival < row.events.length; arrival++) {
    const event = row.events[arrival];
    let online = true;
    for (const prior of row.events.slice(0, arrival)) {
      if (prior.kind === 'offline') online = false;
      if (prior.kind === 'online') online = true;
    }
    if (!online || !['arriveSame', 'arriveOther'].includes(event.kind) || !event.word || !final.stored.includes(event.word)) continue;
    // D2(a,b): already held at the preceding public step, still held after arrival.
    // The stand releases held requests only on ack or after the event sequence.
    if (steps[arrival - 1]?.held !== 1 || steps[arrival]?.held !== 1) continue;
    const falseBefore = production.attempts.some(attempt => attempt.eventIndex < arrival && attempt.error?.startsWith('StaleWriteError:')
      && attempt.server?.content === attempt.pageBase && attempt.declaredBase !== attempt.pageBase)
      && production.questionSteps.some(step => step.eventIndex < arrival && (step.question || step.blocked)
        && serializeContent(step.storedValues) === serializeContent(production.questionSteps[0]?.storedValues));
    if (falseBefore) return 'i-remount-false-question' as const;
    // D2(c)(ii): dictated words lagged in the editor; the later save attempt saw
    // the conflicting arrival and was refused by the canonical door, before transport.
    const delayed = production.events.some((dictation, index) => {
      const editor = production.steps.filter(step => step.kind)[index]?.editor;
      return index < arrival && dictation.kind === 'typeDictate' && typeof dictation.word === 'string'
        && typeof editor === 'string' && !editor.includes(dictation.word + 'D') && other.page.includes(dictation.word + 'D');
    });
    if (delayed && production.attempts.some(attempt => attempt.eventIndex >= arrival
      && attempt.error?.startsWith('StaleWriteError:') && attempt.server?.content?.includes(event.word!)
      && attempt.submitted === other.page)) return 'ii-delayed-dictation' as const;
  }
}
