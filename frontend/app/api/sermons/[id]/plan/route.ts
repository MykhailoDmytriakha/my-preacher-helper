import 'openai/shims/node';

import { NextRequest, NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { usageCapResponse } from '@/api/errors/usageCapResponse';
import { studiesRepository } from '@/api/repositories/studies.repository';
import { createNotePlanUserMessage, type NotePlanInput } from '@/config/prompts/user/notePlanTemplate';
import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';
import { ThoughtInStructure } from '@/models/models';
import { isUsageCapReachedError } from '@/services/usageLimits';
import { requestLanguage } from '@/utils/appLocale';
import { NotePlanRequestSchema, notePlanContextKey, notePlanTargetNodes } from '@/utils/notePlan';
import { formatScriptureReference } from '@/utils/scriptureReference';
import { getVisualOrderedThoughtsForOutlinePoint } from '@/utils/sermonVisualOrder';
import { buildSubPointRenderableEntries, flattenSubPointRenderableEntries, normalizeSubPointId } from '@/utils/subPoints';
import { generateNotePlanPoint, generatePlanPointContent, PlanStyle } from '@clients/openAI.client';
import { sermonsRepository } from '@repositories/sermons.repository';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
} as const;

function jsonNoStore(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  Object.entries(NO_STORE_HEADERS).forEach(([key, value]) => {
    headers.set(key, value);
  });
  return NextResponse.json(body, { ...init, headers });
}

// Error message constants
const ERROR_MESSAGES = {
  UNKNOWN_ERROR: 'Unknown error occurred',
  SERMON_NOT_FOUND: 'Sermon not found',
} as const;

// Use the SermonContent interface from models.ts

// GET /api/sermons/:id/plan?section=introduction|main|conclusion - generates plan for specific section
// GET /api/sermons/:id/plan?outlinePointId=<id> - generates content for a specific outline point
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) {
    return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const section = request.nextUrl.searchParams.get('section');
  const outlinePointId = request.nextUrl.searchParams.get('outlinePointId');
  const style = request.nextUrl.searchParams.get('style') as PlanStyle | null;

  console.log('GET /api/sermons/:id/plan - section:', section, 'outlinePointId:', outlinePointId, 'style:', style);

  // If outlinePointId is provided, generate content for the specific outline point
  if (outlinePointId) {
    return generateSermonPointContent(id, outlinePointId, uid, style || undefined);
  }

  // A whole section generated and SAVED here is the legacy write road; only shipped bundles ask for
  // it. The plan is written only through the data engine, so it gets the 426 refusal.
  return refuseLegacyWriteRoute(request);
}

// Helper function to generate content for a specific outline point
async function generateSermonPointContent(
  sermonId: string,
  outlinePointId: string,
  uid: string,
  style?: PlanStyle
) {
  try {
    // Fetch the sermon
    const sermon = await sermonsRepository.fetchSermonById(sermonId);
    if (!sermon) {
      return jsonNoStore({ error: ERROR_MESSAGES.SERMON_NOT_FOUND }, { status: 404 });
    }
    if (sermon.userId !== uid) {
      return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
    }

    // Find the outline point in the sermon structure
    let outlinePoint;
    let sectionName;

    if (sermon.outline?.introduction.some(op => op.id === outlinePointId)) {
      outlinePoint = sermon.outline.introduction.find(op => op.id === outlinePointId);
      sectionName = 'introduction';
    } else if (sermon.outline?.main.some(op => op.id === outlinePointId)) {
      outlinePoint = sermon.outline.main.find(op => op.id === outlinePointId);
      sectionName = 'main';
    } else if (sermon.outline?.conclusion.some(op => op.id === outlinePointId)) {
      outlinePoint = sermon.outline.conclusion.find(op => op.id === outlinePointId);
      sectionName = 'conclusion';
    }

    if (!outlinePoint || !sectionName) {
      return jsonNoStore(
        { error: 'SermonOutline point not found in sermon structure' },
        { status: 404 }
      );
    }

    // Find thoughts related to this outline point in the shared visual order.
    const relatedThoughts = getVisualOrderedThoughtsForOutlinePoint(sermon, outlinePointId);

    if (relatedThoughts.length === 0) {
      return jsonNoStore(
        { error: 'No thoughts associated with this outline point' },
        { status: 400 }
      );
    }

    const relatedThoughtsForPrompt = flattenSubPointRenderableEntries(
      buildSubPointRenderableEntries<ThoughtInStructure>(
        relatedThoughts.map((thought) => ({
          id: thought.id,
          content: thought.text,
          position: thought.position,
          subPointId: normalizeSubPointId(thought.subPointId, outlinePoint.subPoints),
        })),
        outlinePoint.subPoints
      )
    );
    const keyFragments = relatedThoughts.reduce((acc: string[], thought) => {
      if (thought.keyFragments && thought.keyFragments.length > 0) {
        return acc.concat(thought.keyFragments);
      }
      return acc;
    }, []);

    // Fetch adjacent outline points for context
    const adjacentContext = await sermonsRepository.fetchAdjacentOutlinePoints(sermonId, outlinePointId);

    // Generate the content using the AI client
    const { content, success } = await generatePlanPointContent(
      sermon.title,
      sermon.verse,
      outlinePoint.text,
      relatedThoughtsForPrompt,
      sectionName,
      keyFragments, // Pass combined key fragments
      adjacentContext || undefined, // Pass context if available
      style || 'memory', // Pass style
      outlinePoint.subPoints, // Pass sub-points for structured generation
      uid
    );

    if (!success) {
      return jsonNoStore(
        { error: 'Failed to generate content for outline point' },
        { status: 500 }
      );
    }

    return jsonNoStore({ content });
  } catch (error: unknown) {
    if (isUsageCapReachedError(error)) return usageCapResponse(error);
    console.error(`Error generating content for outline point ${outlinePointId}:`, error);
    return jsonNoStore(
      { error: 'Failed to generate content', details: (error as Error).message },
      { status: 500 }
    );
  }
}

/** Generate a note-backed proposal. Only the editor can accept and save the text. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const uid = await getRequiredAuthenticatedUid(request);
  // The author's interface language: the source notes' old references are read in their Bible.
  const language = requestLanguage(request);
  if (!uid) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
  try {
    const parsed = NotePlanRequestSchema.safeParse(await request.json());
    if (!parsed.success) return jsonNoStore({ error: 'Invalid request' }, { status: 400 });
    const { id } = await params;
    const sermon = await sermonsRepository.fetchSermonById(id);
    if (!sermon) return jsonNoStore({ error: 'Sermon not found' }, { status: 404 });
    if (sermon.userId !== uid) return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
    const { outlinePointId, targetNodeId, style, expectedContext, revision } = parsed.data;
    const sections = ['introduction', 'main', 'conclusion'] as const;
    const section = sections.find((key) => sermon.outline?.[key]?.some((point) => point.id === outlinePointId));
    const point = section && sermon.outline?.[section]?.find((candidate) => candidate.id === outlinePointId);
    if (!point || !section) return jsonNoStore({ error: 'Point not found' }, { status: 404 });
    if (!notePlanTargetNodes(point, targetNodeId).length) return jsonNoStore({ error: 'Target node not found' }, { status: 404 });
    if (revision) {
      const selectedIds = notePlanTargetNodes(point, targetNodeId).map((node) => node.nodeId);
      const draftIds = Object.keys(revision.currentContentByNodeId);
      if (draftIds.length !== selectedIds.length || draftIds.some((nodeId) => !selectedIds.includes(nodeId))) {
        return jsonNoStore({ error: 'Revision draft must match selected nodes' }, { status: 400 });
      }
    }
    if (expectedContext !== notePlanContextKey(sermon, outlinePointId)) {
      return jsonNoStore({ error: 'contextChanged' }, { status: 409 });
    }
    const sourceIds = [...new Set(sermon.sourceNoteIds ?? [])];
    if (!sourceIds.length) return jsonNoStore({ error: 'sourceUnavailable' }, { status: 422 });
    const notes = await Promise.all(sourceIds.map((noteId) => studiesRepository.getNote(noteId, language)));
    if (notes.some((note) => !note || note.userId !== uid || !note.content?.trim())) {
      return jsonNoStore({ error: 'sourceUnavailable' }, { status: 422 });
    }
    const input: NotePlanInput = {
      title: sermon.title, verse: sermon.verse, section, point, targetNodeId, revision,
      outline: sections.flatMap((key) => (sermon.outline?.[key] ?? []).map((item) => ({
        section: key, title: item.text,
        subPoints: [...(item.subPoints ?? [])].sort((a, b) => a.position - b.position).map((sub) => sub.text),
      }))),
      notes: notes.map((note) => ({
        id: note!.id, title: note!.title ?? '', content: note!.content,
        // One numbering for the model, whatever Bible each reference was written in: "Psalms 51:10".
        scriptureRefs: (note!.scriptureRefs ?? []).map((ref) => formatScriptureReference(ref, { style: 'canonical' })),
      })),
      thoughts: getVisualOrderedThoughtsForOutlinePoint(sermon, outlinePointId).map((thought) => ({
        text: thought.text, subPointId: thought.subPointId, keyFragments: thought.keyFragments,
      })),
    };
    // Keep the entire study or refuse explicitly; never silently feed a truncated source.
    if (createNotePlanUserMessage(input).length > 200_000) {
      return jsonNoStore({ error: 'sourceTooLarge' }, { status: 413 });
    }
    const result = await generateNotePlanPoint(input, style, uid);
    const [latestSermon, latestNotes] = await Promise.all([
      sermonsRepository.fetchSermonById(id),
      Promise.all(sourceIds.map((noteId) => studiesRepository.getNote(noteId, language))),
    ]);
    const sourceChanged = latestNotes.some((note, index) => !note || note.userId !== uid
      || note.content !== notes[index]!.content
      || JSON.stringify(note.scriptureRefs) !== JSON.stringify(notes[index]!.scriptureRefs));
    if (!latestSermon || latestSermon.userId !== uid || sourceChanged
      || notePlanContextKey(latestSermon, outlinePointId) !== expectedContext) {
      return jsonNoStore({ error: 'contextChanged' }, { status: 409 });
    }
    return jsonNoStore(result);
  } catch (error) {
    if (isUsageCapReachedError(error)) return usageCapResponse(error);
    if (error instanceof SyntaxError) return jsonNoStore({ error: 'Invalid request' }, { status: 400 });
    console.error('Note plan generation failed', error);
    return jsonNoStore({ error: 'generationFailed' }, { status: 500 });
  }
}

/** PUT stays for shipped bundles: the plan text is written only through the data engine (426 refusal). */
export async function PUT(request: Request) {
  return refuseLegacyWriteRoute(request);
}
