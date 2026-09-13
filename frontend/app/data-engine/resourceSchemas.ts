import { z } from 'zod';

import { providerIds } from '@/api/clients/ai/providerId';
import { getUtf8ByteLength } from '@/utils/feedbackPayload';
import { SERVICE_ORDER_CATALOG } from '@/utils/serviceOrderCatalog';

import type { DocumentData } from './types';

const text = z.string();
const id = text.min(1);
const number = z.number().finite();
const boolean = z.boolean();
const strings = z.array(text);
const status = z.enum(['draft', 'active', 'completed']);
const section = z.enum(['introduction', 'main', 'conclusion']);
const outcome = z.enum(['excellent', 'good', 'average', 'poor']);
const object = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();
const optionalStrings = (keys: readonly string[]): z.ZodRawShape => Object.fromEntries(keys.map(key => [key, text.optional()]));

/** IDs are the merge identity, so duplicates would make a later edit ambiguous. */
function children<T extends z.ZodTypeAny>(schema: T) {
  return z.array(schema).superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (typeof value.id !== 'string' || seen.has(value.id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'id'], message: 'Child identity must be unique' });
      }
      seen.add(value.id);
    });
  });
}

const subPoint = object({ id, text, position: number, note: text.optional() });
const point = object({ id, text, isReviewed: boolean.optional(), subPoints: children(subPoint).optional(), note: text.optional() });
const outline = object({ introduction: children(point), main: children(point), conclusion: children(point) }).superRefine((value, context) => {
  const ids = new Set<string>();
  for (const name of ['introduction', 'main', 'conclusion'] as const) {
    value[name].forEach((entry, index) => {
      for (const child of [entry, ...(entry.subPoints ?? [])]) {
        if (ids.has(child.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: [name, index], message: 'Outline identity must be globally unique' });
        ids.add(child.id);
      }
    });
  }
});
const thought = object({ id, text, tags: strings, date: text, outlinePointId: id.nullable().optional(), subPointId: id.nullable().optional(), position: number.optional(), isLocked: boolean.optional(), keyFragments: strings.optional() });
const scratch = object({ id, text, createdAt: text, section: section.optional(), source: object({ noteId: id, heading: text }).optional() });
const bySection = object({ introduction: strings, main: strings, conclusion: strings, ambiguous: strings.optional() });
const planSection = object({ outline: text, outlinePoints: z.record(text).optional() });
const plan = object({ introduction: planSection, main: planSection, conclusion: planSection });
const church = object({ id: text, name: text, city: text.optional() });
const preachDate = object({ id, date: id, status: z.enum(['planned', 'preached']).optional(), church, audience: text.optional(), notes: text.optional(), outcome: outcome.optional(), createdAt: text });
const planNode: z.ZodType<{ id: string; title: string; children?: unknown[] }> = z.lazy(() => object({ id, title: text, children: children(planNode).optional() }));
const preparation = object({
  spiritual: object({ readAndPrayedConfirmed: boolean.optional() }).optional(),
  textContext: object({ ...optionalStrings(['passage', 'passageSummary', 'contextNotes']), repeatedWords: strings.optional(), readWholeBookOnceConfirmed: boolean.optional() }).optional(),
  exegeticalPlan: children(planNode).optional(),
  authorIntent: text.optional(),
  mainIdea: object(optionalStrings(['contextIdea', 'textIdea', 'argumentation'])).optional(),
  thesis: object({ ...optionalStrings(['exegetical', 'homiletical', 'oneSentence', 'questionWord', 'pluralKey', 'transitionSentence', 'sermonInOneSentence']), homileticalAnswers: object(optionalStrings(['whyPreach', 'impactOnChurch', 'practicalQuestions'])).optional() }).optional(),
  timelessTruth: text.optional(), christConnection: text.optional(),
  preachingGoal: object({ type: z.enum(['informative', 'proclamation', 'didactic', 'exhortative']).optional(), statement: text.optional() }).optional(),
  homileticPlan: object({ modernTranslation: text.optional(), updatedPlan: children(object({ id, title: text })).optional(), sermonPlan: children(object({ id, title: text })).optional() }).optional(),
});
const scripture = object({ id, book: id, chapter: number.int().positive().optional(), toChapter: number.int().positive().optional(), fromVerse: number.int().positive().optional(), toVerse: number.int().positive().optional(), text: text.optional() });
const seriesItem = object({ id, type: z.enum(['sermon', 'group']), refId: id, position: number, plannedDate: text.optional(), completedAt: text.optional() });
const block = object({ id, type: z.enum(['announcement', 'topic', 'scripture', 'questions', 'explanation', 'notes', 'prayer', 'custom']), title: text, summary: text.optional(), content: text, scriptureRefs: strings.optional(), questions: strings.optional(), status: z.enum(['empty', 'draft', 'filled']), createdAt: text, updatedAt: text });
const flowItem = object({ id, templateId: id, order: number, durationMin: number.nonnegative().nullable().optional(), instanceTitle: text.optional(), instanceNotes: text.optional() });
const meeting = object({ id, date: id, location: text.optional(), audience: text.optional(), notes: text.optional(), outcome: outcome.optional(), createdAt: text });
const councilTopic = object({
  id, title: text, kind: z.enum(['decision', 'info']).optional(), summary: text.optional(),
  questions: children(object({ id, question: text, answer: text.optional() })),
  options: children(object({ id, text })), forAssembly: boolean.optional(), discussed: boolean.optional(),
  resolution: z.enum(['postponed', 'dropped']).optional(), acceptedOptionId: id.optional(), decision: text.optional(),
  changes: z.array(object({ at: text, from: text, to: text })).optional(), carriedToCouncilId: id.optional(),
});
const orderStep = object({ id, title: text, body: text.optional(), scriptureRefs: strings.optional(), flagged: boolean.optional() });
const preference = object({ providerId: z.enum(providerIds), modelId: id });
const owner = { userId: id };
const timestamps = { createdAt: text, updatedAt: text };

/** Shapes mirror models.ts; defaults belong to the existing domain factories, not validation. */
const shapes: Record<string, z.ZodRawShape> = {
  sermons: {
    ...owner, title: id, verse: id, date: id, thoughts: children(thought), scratch: children(scratch).optional(),
    outline: outline.optional(), thoughtsBySection: bySection.optional(), structure: bySection.optional(),
    insights: object({ topics: strings, relatedVerses: z.array(object({ reference: text, relevance: text })), possibleDirections: z.array(object({ ...optionalStrings(['area', 'suggestion', 'title', 'description', 'id']), examples: strings.optional() })), sectionHints: object({ introduction: text, main: text, conclusion: text }).optional() }).optional(),
    draft: plan.optional(), plan: plan.optional(), planText: z.record(text).optional(), planMode: z.enum(['manual', 'ai', 'note']).optional(),
    isPreached: boolean.optional(), preparation: preparation.optional(), seriesId: id.nullable().optional(), seriesPosition: number.nullable().optional(),
    sourceNoteIds: z.array(id).optional(), church: church.optional(), preachDates: children(preachDate).optional(),
    audioChunks: z.array(object({ text, sectionId: z.enum(['introduction', 'mainPart', 'conclusion']), createdAt: text, index: number.int().nonnegative(), kind: z.enum(['body', 'transition']).optional(), role: z.enum(['intro', 'bridge', 'outro']).optional() })).optional(),
    // Optimizing text creates partial metadata before the first audio generation.
    audioMetadata: object({ ...optionalStrings(['provider', 'voice', 'model', 'lastGenerated', 'lastOptimized']), chunksCount: number.int().nonnegative().optional(), mode: z.enum(['ai', 'raw']).optional() }).optional(),
    createdAt: text.optional(), updatedAt: text.optional(),
  },
  studyNotes: { ...owner, ...timestamps, content: text, title: text.optional(), scriptureRefs: children(scripture), tags: strings, isDraft: boolean, materialIds: z.array(id).optional(), type: z.enum(['note', 'question']).optional() },
  studyMaterials: { ...owner, ...timestamps, title: id, description: text.optional(), type: z.enum(['sermon', 'study', 'group', 'guide']), noteIds: z.array(id), sections: children(object({ id, title: text, noteIds: z.array(id), connector: text.optional() })).optional() },
  groups: { ...owner, ...timestamps, title: text, description: text.optional(), status, templates: children(block), flow: children(flowItem), meetingDates: children(meeting).optional(), seriesId: id.nullable().optional(), seriesPosition: number.nullable().optional() },
  series: { ...owner, ...timestamps, title: text.optional(), description: text.optional(), theme: text, bookOrTopic: text, sermonIds: z.array(id), items: children(seriesItem).optional(), seriesKind: z.enum(['sermon', 'group', 'mixed']).optional(), startDate: text.optional(), duration: number.optional(), color: text.optional(), status },
  prayerRequests: { ...owner, ...timestamps, title: id, description: text.optional(), categoryId: id.optional(), tags: strings.optional(), status: z.enum(['active', 'answered', 'not_answered']), updates: children(object({ id, text, createdAt: text })), answeredAt: text.optional(), answerText: text.optional() },
  prayerCategories: { ...owner, createdAt: text, updatedAt: text.optional(), name: id, color: text.optional() },
  serviceOrders: { ...owner, ...timestamps, title: id, summary: text.optional(), steps: children(orderStep), rank: number, catalogKey: text.refine(value => SERVICE_ORDER_CATALOG.includes(value as typeof SERVICE_ORDER_CATALOG[number]), 'Unknown catalog identity').optional() },
  councils: { ...owner, ...timestamps, title: text, date: text.optional(), status: z.enum(['preparing', 'held']), heldAt: text.optional(), topics: children(councilTopic) },
  planTemplates: { ...owner, ...timestamps, name: id, structure: outline },
  tags: { ...owner, name: id, color: text, required: boolean, createdAt: text.optional(), updatedAt: text.optional() },
  users: { language: text.optional(), email: text.optional(), displayName: text.optional(), firstDayOfWeek: z.enum(['sunday', 'monday']).optional(), enablePrepMode: boolean.optional(), enableAudioGeneration: boolean.optional(), enableStructurePreview: boolean.optional(), enableGroups: boolean.optional(), showAppVersion: boolean.optional(), preferredProviderId: z.enum(providerIds).optional(), preferredModelId: id.optional(), preferredTranscription: preference.optional(), preferredText: preference.optional(), preferredTts: preference.optional(), createdAt: text.optional(), updatedAt: text.optional() },
};

function invalid(message: string): never {
  throw Object.assign(new Error(message), { code: 'invalid-argument' });
}

/** Firestore's map/array depth limit applies to the document, not the command envelope. */
function validateStorage(value: unknown, depth = 0, parentArray = false): void {
  if (depth > 20) invalid('Document exceeds Firestore nesting depth');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    if (parentArray) invalid('Firestore does not support directly nested arrays');
    value.forEach(item => validateStorage(item, depth + (item !== null && typeof item === 'object' ? 1 : 0), true));
    return;
  }
  if (!value || typeof value !== 'object') invalid('Document must contain JSON values');
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || /^__.*__$/.test(key) || getUtf8ByteLength(key) > 1500) invalid('Invalid Firestore field name');
    validateStorage(child, depth + (child !== null && typeof child === 'object' ? 1 : 0));
  }
}

export interface ResourceValidationOptions {
  kind: 'create' | 'update';
  /** Top-level fields touched by the command, after its merge has been calculated. */
  changedFields?: readonly string[];
}

/**
 * Checks the accepted candidate, never changes it. Existing unknown fields and
 * malformed untouched legacy fields are not removed or made newly mandatory.
 * Authorization, derived fields and cross-document relationships remain separate.
 */
export function validateResourceDocument(collection: string, value: DocumentData, options: ResourceValidationOptions): void {
  if (!Object.prototype.hasOwnProperty.call(shapes, collection)) invalid('Unknown resource schema');
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected a document object');
  validateStorage(value);
  const shape = shapes[collection];
  if (options.kind === 'create' && Object.keys(value).some(key => !Object.prototype.hasOwnProperty.call(shape, key))) invalid('Unknown field in new document');
  const fields = options.kind === 'create' ? Object.keys(shape) : options.changedFields ?? Object.keys(value).filter(key => Object.prototype.hasOwnProperty.call(shape, key));
  for (const key of new Set(fields)) {
    if (!Object.prototype.hasOwnProperty.call(shape, key)) invalid(`Unknown changed field: ${key}`);
    const result = shape[key].safeParse(value[key]);
    if (!result.success) invalid(`Invalid ${collection}.${key}: ${result.error.issues.map(issue => issue.message).join('; ')}`);
  }
  if (options.kind === 'create' && collection === 'sermons') {
    if (Array.isArray(value.sourceNoteIds) && value.sourceNoteIds.length > 20) invalid('Too many source notes at birth');
    if (Array.isArray(value.scratch) && value.scratch.length > 300) invalid('Too many scratch notes at birth');
  }
}
