import { ScratchNote } from '@/models/models';
import { parseUsageCapError, type UsageCapReachedError } from '@/services/usageLimits';
import { aiResultErrorCode, beginAiResultAttempt } from '@/utils/aiResultAttempt.client';
import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { resolveOwnerUid } from '@/utils/queryKeys';

// Study notes are written only through the data engine (engineOwnedCollections.ts). What stays
// here is the AI cut routes.
/** The note body is one editable unit; server-side links (materialIds) are not. */
export const NOTE_AGGREGATE = 'note';

export interface CutStudyNoteResponse {
  acknowledge: () => void;
  noteId: string;
  keyPassage: string;
  sections: Array<{ heading: string; count: number }>;
  notes: ScratchNote[];
  /** How many sections the whole note has, whichever slice this answer covers. */
  totalSections: number;
}

/** The plan of a cut, read from the stored note without calling a model. */
export interface NoteCutOutline {
  noteId: string;
  sourceVersion: string;
  words: number;
  totalSections: number;
  sections: Array<{ index: number; heading: string; words: number }>;
  /** The requests the cut will take, in order; each stays well under the function wall. */
  slices: Array<{ offset: number; limit: number; words: number }>;
  corridor: { min: number; max: number };
}

/**
 * Read the plan of the cut before anything is cut: which sections the stored note has and
 * how many requests they will take. Costs no AI call, so the dialog can show the person
 * the whole list of steps before the first one starts.
 */
export async function fetchNoteCutOutline(noteId: string): Promise<NoteCutOutline> {
  const authHeaders = await getAuthenticatedRequestHeaders();
  const response = await apiClient(`/api/studies/notes/${noteId}/cut`, {
    method: 'GET',
    headers: authHeaders,
    category: 'detail',
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `Failed to read the study note (${response.status})`;
    throw new CutStudyNoteError(message, response.status, null);
  }
  const body = payload as Partial<NoteCutOutline> | null;
  const slices = Array.isArray(body?.slices) ? body.slices.filter((slice) => slice && slice.limit > 0) : [];
  if (!body || slices.length === 0) {
    throw new CutStudyNoteError('The note has nothing to cut', 400);
  }
  if (typeof body.sourceVersion !== 'string' || !body.sourceVersion) {
    throw new CutStudyNoteError('The cut outline did not include a source version', 502);
  }
  return {
    sourceVersion: body.sourceVersion,
    noteId: typeof body.noteId === 'string' && body.noteId ? body.noteId : noteId,
    words: typeof body.words === 'number' ? body.words : 0,
    totalSections: typeof body.totalSections === 'number' ? body.totalSections : slices.length,
    sections: Array.isArray(body.sections) ? body.sections : [],
    slices,
    corridor: body.corridor ?? { min: 0, max: 0 },
  };
}

/** A failed cut, carrying what the dialog needs to say the right thing. */
export class CutStudyNoteError extends Error {
  readonly status: number;
  readonly usageCap: UsageCapReachedError | null;

  constructor(message: string, status: number, usageCap: UsageCapReachedError | null = null, readonly code?: string) {
    super(message);
    this.name = 'CutStudyNoteError';
    this.status = status;
    this.usageCap = usageCap;
  }
}

/**
 * Cut a saved study note into atomic scratch notes. Server-side and online-only: the
 * model reads the STORED note, so unsaved edits in the editor are not part of the cut.
 * The caller puts the atoms where they belong after the server accounts for the AI call.
 */
export async function cutStudyNoteIntoScratch(
  noteId: string,
  slice?: { offset: number; limit: number; sourceVersion: string }
): Promise<CutStudyNoteResponse> {
  const ownerId = resolveOwnerUid();
  const authHeaders = await getAuthenticatedRequestHeaders(ownerId ?? null);
  const path = `/api/studies/notes/${noteId}/cut`;
  // No slice means the whole note, which is what a short note gets anyway.
  const requestBody = JSON.stringify(slice ?? {});
  const attempt = await beginAiResultAttempt(ownerId, path, requestBody);
  const response = await attempt.request(() => apiClient(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders, ...attempt.headers },
    category: 'ai',
    body: requestBody,
  }));
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  attempt.assertOwner();
  if (!response.ok) {
    attempt.refused(response.status, payload);
    const usageCap = response.status === 429 ? parseUsageCapError(payload) : null;
    const message =
      payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `Failed to cut the study note (${response.status})`;
    throw new CutStudyNoteError(message, response.status, usageCap, aiResultErrorCode(payload));
  }
  const body = payload as Partial<CutStudyNoteResponse> | null;
  if (!body || !Array.isArray(body.notes)) {
    throw new CutStudyNoteError('The cut answered without scratch notes', 500);
  }
  // Only well-formed atoms reach the sermon: a proxy or a version-skewed server must not be
  // able to seed the pool with shapes the board cannot render.
  const notes = body.notes.filter(
    (note): note is ScratchNote =>
      !!note &&
      typeof note === 'object' &&
      typeof note.id === 'string' &&
      note.id.length > 0 &&
      typeof note.text === 'string' &&
      note.text.trim().length > 0 &&
      typeof note.createdAt === 'string'
  );
  if (notes.length === 0) {
    throw new CutStudyNoteError('The cut answered without usable scratch notes', 422);
  }
  return {
    acknowledge: attempt.acknowledge,
    noteId: typeof body.noteId === 'string' && body.noteId ? body.noteId : noteId,
    keyPassage: typeof body.keyPassage === 'string' ? body.keyPassage : '',
    sections: Array.isArray(body.sections) ? body.sections : [],
    notes,
    totalSections: typeof body.totalSections === 'number' ? body.totalSections : 0,
  };
}
