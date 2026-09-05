import 'openai/shims/node';

import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { usageCapResponse } from '@/api/errors/usageCapResponse';
import { isUsageCapReachedError } from '@/services/usageLimits';
import { expectedScratchCountCorridor } from '@/utils/noteCutCorridor';
import { planNoteCutSlices, sectionsText, sliceSections, splitNoteIntoSections } from '@/utils/noteSections';
import { cutStudyNoteIntoScratch } from '@clients/studyNoteCut.structured';
import { studiesRepository } from '@repositories/studies.repository';

import type { ScratchNote, ScriptureReference } from '@/models/models';

/**
 * POST /api/studies/notes/:id/cut — cut a study note into atomic scratch notes.
 *
 * READS ONLY. The route answers with scratch notes ready to be written into a sermon
 * (ids and timestamps assigned here, origin recorded on each) and a per-section report
 * that explains the count. It writes nothing: the caller decides what to do with the
 * atoms — put them into a sermon being born, or into one that already exists — and
 * a failed cut therefore leaves no half-born document behind.
 *
 * Ownership is checked on the NOTE, because the note's text is what the model reads and
 * what the caller's AI quota pays for. A note that is not the caller's is refused
 * before any content is loaded into a prompt.
 *
 * WHAT THE MODEL SAYS IS CHECKED AGAINST THE NOTE. Structured output proves the shape of
 * an answer, not its truth: a section heading or a key passage the note never contains
 * is dropped here rather than stored as provenance or written into the sermon's verse.
 *
 * CUT IN SLICES, NOT IN ONE BREATH. `GET` answers with the note's outline — its sections
 * and the slices they will be cut in — and costs nothing: no model is called. `POST` then
 * cuts one slice `[offset, offset + limit)` per request, the browser driving them in
 * order. This is the same shape the audio route uses for the same wall.
 *
 * Why: the whole manuscript in one call ran 36.2s against the 60s function ceiling
 * (`vercel.json`), which left no room to retry a transient provider failure — and one
 * `503 (no body)` threw the whole minute away. A slice runs in a fraction of that, so a
 * retry fits inside the request, and a slice that still fails is retried alone, with the
 * slices already cut kept. Longer notes are refused up front with 413 rather than dying
 * mid-flight.
 *
 * Omitting offset/limit still cuts the whole note, so a caller that knows nothing about
 * slices keeps working.
 */
export const MAX_CUT_CHARS = 60_000;

/** What the model may spend inside a 60s function, leaving room to answer. */
const MODEL_BUDGET_MS = 50_000;

export interface CutNoteSectionReport {
  heading: string;
  count: number;
}

export interface CutNoteResponseBody {
  success: true;
  noteId: string;
  keyPassage: string;
  sections: CutNoteSectionReport[];
  notes: ScratchNote[];
  /** How many sections the whole note has — what the caller needs to drive the rest. */
  totalSections: number;
  offset: number;
  limit: number;
}

function formatRefForPrompt(ref: ScriptureReference): string {
  const book = ref.book;
  const chapter = ref.chapter;
  if (!chapter) return book;
  const toChapter = (ref as { toChapter?: number }).toChapter;
  if (toChapter && toChapter !== chapter) return `${book} ${chapter}-${toChapter}`;
  const fromVerse = ref.fromVerse;
  if (!fromVerse) return `${book} ${chapter}`;
  const toVerse = ref.toVerse;
  return toVerse && toVerse !== fromVerse
    ? `${book} ${chapter}:${fromVerse}-${toVerse}`
    : `${book} ${chapter}:${fromVerse}`;
}

/** The atom's text always carries its Scripture, even when the model kept it apart. */
function atomText(text: string, scripture: string): string {
  if (!scripture) return text;
  return text.includes(scripture) ? text : `${text} (${scripture})`;
}

const normalizeHeading = (value: string) =>
  value
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Headings as the note actually writes them, so a model-invented one can be told apart. */
export function collectNoteHeadings(content: string): Map<string, string> {
  const headings = new Map<string, string>();
  let inFence = false;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = match[1].replace(/[*_`]/g, '').trim();
    headings.set(normalizeHeading(text), text);
  }
  return headings;
}

/** A passage the model names counts only if the note itself writes it. */
export function groundKeyPassage(keyPassage: string, content: string): string {
  const passage = keyPassage.replace(/\s+/g, ' ').trim();
  if (!passage) return '';
  const haystack = content.replace(/\s+/g, ' ');
  return haystack.includes(passage) ? passage : '';
}

interface OwnedNote {
  content: string;
  title?: string;
  scriptureRefs?: ScriptureReference[];
}

/** The note this caller is allowed to cut, or the refusal to answer with. */
async function loadOwnedNote(
  request: Request,
  params: Promise<{ id: string }>
): Promise<{ id: string; uid: string; note: OwnedNote; content: string } | { refusal: NextResponse }> {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) {
    return { refusal: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
  }

  const { id } = await params;
  if (!id || id === 'new') {
    return {
      refusal: NextResponse.json({ success: false, error: 'A saved study note is required' }, { status: 400 }),
    };
  }

  const note = await studiesRepository.getNote(id);
  if (!note) {
    return { refusal: NextResponse.json({ success: false, error: 'Study note not found' }, { status: 404 }) };
  }
  if (note.userId !== uid) {
    return {
      refusal: NextResponse.json(
        { success: false, error: 'Forbidden: you do not own this study note' },
        { status: 403 }
      ),
    };
  }

  const content = (note.content ?? '').trim();
  if (!content) {
    return { refusal: NextResponse.json({ success: false, error: 'The note has no text to cut' }, { status: 400 }) };
  }
  if (content.length > MAX_CUT_CHARS) {
    return {
      refusal: NextResponse.json(
        { success: false, error: 'The note is too long to cut in one go', limit: MAX_CUT_CHARS, length: content.length },
        { status: 413 }
      ),
    };
  }

  return { id, uid, note, content };
}

export interface CutNoteOutlineBody {
  success: true;
  noteId: string;
  words: number;
  totalSections: number;
  sections: { index: number; heading: string; words: number }[];
  slices: { offset: number; limit: number; words: number }[];
  corridor: { min: number; max: number };
}

/**
 * GET /api/studies/notes/:id/cut — the plan of the cut, before a model is called.
 *
 * The browser needs to know how many requests the cut will take BEFORE it starts, so the
 * person sees the whole list of steps rather than a spinner that might mean anything. It
 * is read from the STORED note, the same text the cut itself will read, so the plan and
 * the work can never be about two different versions.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const loaded = await loadOwnedNote(request, params);
    if ('refusal' in loaded) return loaded.refusal;

    const sections = splitNoteIntoSections(loaded.content);
    const body: CutNoteOutlineBody = {
      success: true,
      noteId: loaded.id,
      words: sections.reduce((sum, section) => sum + section.words, 0),
      totalSections: sections.length,
      sections: sections.map(({ index, heading, words }) => ({ index, heading, words })),
      slices: planNoteCutSlices(sections),
      corridor: expectedScratchCountCorridor(loaded.content),
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error('Studies cut outline: error', error);
    return NextResponse.json({ success: false, error: 'Failed to read the study note' }, { status: 500 });
  }
}

/** The slice the caller asked for; absent or unusable values mean the whole note. */
async function readSliceWindow(request: Request): Promise<{ offset: number; limit?: number }> {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const record = (body ?? {}) as { offset?: unknown; limit?: unknown };
  const offset = Number.isInteger(record.offset) ? Math.max(0, record.offset as number) : 0;
  const limit = Number.isInteger(record.limit) && (record.limit as number) > 0 ? (record.limit as number) : undefined;
  return { offset, limit };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // The wall is 60s; the model gets what is left after the note is loaded, minus a margin
  // for grounding the answer and writing the response.
  const wallStartedAt = Date.now();
  try {
    const loaded = await loadOwnedNote(request, params);
    if ('refusal' in loaded) return loaded.refusal;
    const { id, uid, note, content } = loaded;

    const allSections = splitNoteIntoSections(content);
    const { offset, limit } = await readSliceWindow(request);
    const slice = sliceSections(allSections, offset, limit);
    if (slice.length === 0) {
      return NextResponse.json(
        { success: false, error: 'The requested slice is outside the note', totalSections: allSections.length },
        { status: 400 }
      );
    }

    const sliceContent = sectionsText(slice);
    const isPartial = slice.length < allSections.length;
    const result = await cutStudyNoteIntoScratch({
      content: sliceContent,
      title: note.title,
      scriptureRefs: (note.scriptureRefs ?? []).map(formatRefForPrompt),
      userId: uid,
      slice: isPartial
        ? { from: slice[0].index + 1, to: slice[slice.length - 1].index + 1, total: allSections.length }
        : undefined,
      budgetMs: Math.max(15_000, MODEL_BUDGET_MS - (Date.now() - wallStartedAt)),
    });

    if (!result.success || !result.data) {
      console.error('Studies cut route: cut failed', result.error);
      return NextResponse.json({ success: false, error: result.error ?? 'Failed to cut the note' }, { status: 500 });
    }

    const knownHeadings = collectNoteHeadings(content);
    // Slices are cut in reading order, seconds apart, so a later slice always carries later
    // timestamps: the scratch board orders by `createdAt`, and the argument of the note has
    // to survive being cut in several requests.
    const bornAt = Date.now();
    const notes: ScratchNote[] = [];
    const sections: CutNoteSectionReport[] = [];
    for (const section of result.data.sections) {
      const heading = knownHeadings.get(normalizeHeading(section.heading)) ?? '';
      sections.push({ heading, count: section.claims.length });
      for (const claim of section.claims) {
        notes.push({
          id: randomUUID(),
          text: atomText(claim.text, claim.scripture),
          // One millisecond apart, in reading order: the board and the composer order
          // scratch by time and break ties by id, and a random id would scramble the
          // argument of the note.
          createdAt: new Date(bornAt + notes.length).toISOString(),
          source: { noteId: id, heading },
        });
      }
    }

    if (notes.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'The cut found no cornerstone claims in this note',
          totalSections: allSections.length,
        },
        { status: 422 }
      );
    }

    const body: CutNoteResponseBody = {
      success: true,
      noteId: id,
      keyPassage: groundKeyPassage(result.data.keyPassage, content),
      sections,
      notes,
      totalSections: allSections.length,
      offset: slice[0].index,
      limit: slice.length,
    };
    return NextResponse.json(body);
  } catch (error) {
    if (isUsageCapReachedError(error)) return usageCapResponse(error);
    console.error('Studies cut route: error', error);
    return NextResponse.json({ success: false, error: 'Failed to cut the study note' }, { status: 500 });
  }
}
