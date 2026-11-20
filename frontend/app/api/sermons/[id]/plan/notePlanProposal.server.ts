import 'server-only';

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { generateNotePlanPoint } from '@/api/clients/openAI.client';
import { AiResultPendingError } from '@/api/errors/aiResultRecovery.server';
import { sermonsRepository } from '@/api/repositories/sermons.repository';
import { studiesRepository } from '@/api/repositories/studies.repository';
import { createNotePlanUserMessage, type NotePlanInput } from '@/config/prompts/user/notePlanTemplate';
import { AI_RESULT_RESPONSE_BUDGET_MS, aiResultRecoveryForRequest } from '@/services/recoverableAiResult.server';
import { withStore } from '@/services/storeAvailability.server';
import { AI_RESULT_OPERATION_HEADER, AI_RESULT_RECOVERY_ONLY_HEADER } from '@/utils/aiResultOperation';
import { NotePlanRequestSchema, NotePlanResultSchema, notePlanContextKey, notePlanFiledNotes, notePlanSourceMaterial, notePlanSourceText, notePlanTargetNodes, type NotePlanRequest } from '@/utils/notePlan';
import { getVisualOrderedThoughtsForOutlinePoint } from '@/utils/sermonVisualOrder';
import { withinDeadline } from '@/utils/withinDeadline';

import type { Sermon, StudyNote } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';

const sections = ['introduction', 'main', 'conclusion'] as const;
const MODEL_BUDGET_MS = 45_000;
const proposalReceipt = z.object({ proposal: NotePlanResultSchema, sourceKey: z.string() });
type ProposalReceipt = z.infer<typeof proposalReceipt>;

export class NotePlanRefusal extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type SourceScope = { sermon: Sermon; owner: string; language: AppLocale | undefined };

function sourceKey(notes: StudyNote[]): string {
  return createHash('sha256').update(notePlanSourceText(notes)).digest('hex');
}

async function readSources({ sermon, owner, language }: SourceScope): Promise<StudyNote[]> {
  const ids = [...new Set(sermon.sourceNoteIds ?? [])];
  if (!ids.length) throw new NotePlanRefusal('sourceUnavailable', 422);
  const notes = await Promise.all(ids.map(noteId => studiesRepository.getNote(noteId, language)));
  return notes.map(note => {
    if (!note || note.userId !== owner || !note.content?.trim()) throw new NotePlanRefusal('sourceUnavailable', 422);
    return note;
  });
}

async function createProposal(scope: SourceScope, request: NotePlanRequest, capture?: {
  deadline: number;
  publish: (result: ProposalReceipt) => Promise<void>;
}): Promise<ProposalReceipt> {
  const { sermon, owner } = scope;
  const { outlinePointId, targetNodeId, style, expectedContext, revision } = request;
  const section = sections.find(key => sermon.outline?.[key]?.some(point => point.id === outlinePointId));
  const point = section && sermon.outline?.[section]?.find(point => point.id === outlinePointId);
  if (!point || !section) throw new NotePlanRefusal('Point not found', 404);
  const targets = notePlanTargetNodes(point, targetNodeId);
  if (!targets.length) throw new NotePlanRefusal('Target node not found', 404);
  if (revision) {
    const draftIds = Object.keys(revision.currentContentByNodeId);
    if (draftIds.length !== targets.length || targets.some(node => !Object.hasOwn(revision.currentContentByNodeId, node.nodeId))) {
      throw new NotePlanRefusal('Revision draft must match selected nodes', 400);
    }
  }
  if (expectedContext !== notePlanContextKey(sermon, outlinePointId)) throw new NotePlanRefusal('contextChanged', 409);

  const notes = await readSources(scope);
  const materialKey = sourceKey(notes);
  if (request.expectedSourceKey && request.expectedSourceKey !== materialKey) throw new NotePlanRefusal('contextChanged', 409);
  const input: NotePlanInput = {
    title: sermon.title, verse: sermon.verse, section, point, targetNodeId, revision, filed: notePlanFiledNotes(sermon),
    outline: sections.flatMap(key => (sermon.outline?.[key] ?? []).map(item => ({
      section: key, title: item.text,
      subPoints: [...(item.subPoints ?? [])].sort((a, b) => a.position - b.position).map(sub => sub.text),
    }))),
    notes: notePlanSourceMaterial(notes),
    thoughts: getVisualOrderedThoughtsForOutlinePoint(sermon, outlinePointId).map(thought => ({
      text: thought.text, subPointId: thought.subPointId, keyFragments: thought.keyFragments,
    })),
  };
  // Keep the entire study or refuse explicitly.
  if (createNotePlanUserMessage(input).length > 200_000) throw new NotePlanRefusal('sourceTooLarge', 413);
  const proposal = capture
    ? await generateNotePlanPoint(input, style, owner, {
      deadline: capture.deadline, publish: proposal => capture.publish({ proposal, sourceKey: materialKey }),
    })
    : await generateNotePlanPoint(input, style, owner);
  return { proposal, sourceKey: materialKey };
}

async function sourceChanged(scope: SourceScope, request: NotePlanRequest, expectedSource: string): Promise<boolean> {
  if (notePlanContextKey(scope.sermon, request.outlinePointId) !== request.expectedContext) return true;
  try {
    return sourceKey(await readSources(scope)) !== expectedSource;
  } catch (error) {
    if (error instanceof NotePlanRefusal && error.status === 422) return true;
    throw error;
  }
}

export async function handleNotePlanProposal(
  request: Request, owner: string, id: string, language: AppLocale | undefined, startedAt: number,
) {
  const deadline = startedAt + AI_RESULT_RESPONSE_BUDGET_MS;
  const hasOperation = request.headers?.has(AI_RESULT_OPERATION_HEADER);
  const wait = <T>(read: () => Promise<T>) => hasOperation
    ? withinDeadline(read, deadline, () => new AiResultPendingError()) : read();
  const parsed = NotePlanRequestSchema.safeParse(await wait(() => request.json()));
  if (!parsed.success) throw new NotePlanRefusal('Invalid request', 400);
  const recoverOnly = request.headers?.get(AI_RESULT_RECOVERY_ONLY_HEADER) === '1';
  const operation = hasOperation ? aiResultRecoveryForRequest(request, {
    ownerId: owner, source: ['sermon-note-plan-v1', id, parsed.data], deadline,
  }) : undefined;
  if (recoverOnly && !operation) throw new NotePlanRefusal('An operation ID is required to recover a plan proposal', 400);

  const sermon = await wait(() => withStore(() => sermonsRepository.fetchSermonById(id)));
  if (!sermon) throw new NotePlanRefusal('Sermon not found', 404);
  if (sermon.userId !== owner) throw new NotePlanRefusal('Forbidden', 403);
  const scope = { sermon, owner, language };

  const record = operation
    ? (await operation.recovery.run(value => proposalReceipt.parse(value), async publish => {
      const data = await wait(() => createProposal(scope, parsed.data, { deadline: startedAt + MODEL_BUDGET_MS, publish }));
      return { success: true, data, error: null, refusal: null };
    })).data
    : await createProposal(scope, parsed.data);
  if (!record) throw new Error('The plan proposal could not be read');

  const latest = recoverOnly ? sermon : await wait(() => withStore(() => sermonsRepository.fetchSermonById(id)));
  if (!latest || latest.userId !== owner) throw new NotePlanRefusal('contextChanged', 409);
  const changed = await wait(() => sourceChanged({ ...scope, sermon: latest }, parsed.data, record.sourceKey));
  if (!operation) {
    if (changed) throw new NotePlanRefusal('contextChanged', 409);
    return record.proposal;
  }
  return { ...record.proposal, sourceKey: record.sourceKey, sourceChanged: changed };
}
