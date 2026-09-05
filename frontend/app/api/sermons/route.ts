import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { studiesRepository } from '@/api/repositories/studies.repository';
import { adminDb } from '@/config/firebaseAdminConfig';
import { ScratchNote, Sermon } from '@/models/models';

const MAX_SOURCE_NOTES = 20;
/**
 * Not a truncation point: a create carrying more atoms than this is REFUSED, never
 * silently shortened. A cut of a very long note answers ~1 atom per 1,500–2,500
 * characters, so 300 atoms is far above anything the cut route (60,000-character
 * admission limit) can produce; the cap only stops a client from seeding an unbounded
 * array into a document.
 */
const MAX_SCRATCH_AT_BIRTH = 300;
const SCRATCH_SECTIONS = new Set(['introduction', 'main', 'conclusion']);

function readScratchSource(candidate: Record<string, unknown>, allowedNoteIds: Set<string>): ScratchNote['source'] | undefined {
  const source = candidate.source as Record<string, unknown> | undefined;
  if (!source || typeof source !== 'object') return undefined;
  if (typeof source.noteId !== 'string' || !source.noteId) return undefined;
  // Provenance is a claim: an atom may only say it came from a note this sermon is
  // verified to be linked to. Anything else is dropped — the atom stays, the claim does not.
  if (!allowedNoteIds.has(source.noteId)) return undefined;
  return { noteId: source.noteId, heading: typeof source.heading === 'string' ? source.heading : '' };
}

function scratchCreatedAt(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

/**
 * SCRATCH NOTES A SERMON IS BORN WITH — the atoms cut from a study note.
 *
 * Same whitelist as the client's own scratch writer (`sanitizeScratchNotes`): id, text,
 * createdAt, section, source. Anything else in the payload is dropped, empty texts are
 * skipped, ids are made unique, and an atom's `source` must name one of the sermon's
 * verified source notes.
 */
function sanitizeScratchAtBirth(input: unknown, now: string, allowedNoteIds: Set<string>): ScratchNote[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ScratchNote[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as Record<string, unknown>;
    const text = typeof candidate.text === 'string' ? candidate.text.trim() : '';
    if (!text) continue;
    let id = typeof candidate.id === 'string' && candidate.id ? candidate.id : randomUUID();
    if (seen.has(id)) id = randomUUID();
    seen.add(id);
    const note: ScratchNote = {
      id,
      text,
      createdAt: scratchCreatedAt(candidate.createdAt, now),
    };
    if (typeof candidate.section === 'string' && SCRATCH_SECTIONS.has(candidate.section)) {
      note.section = candidate.section as ScratchNote['section'];
    }
    const source = readScratchSource(candidate, allowedNoteIds);
    if (source) note.source = source;
    out.push(note);
  }
  return out;
}

function readSourceNoteIds(input: unknown): string[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return null;
  const ids = input.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (ids.length !== input.length || ids.length > MAX_SOURCE_NOTES) return null;
  return Array.from(new Set(ids));
}

/**
 * The link may be set at birth only to notes the caller owns: a link is a claim of
 * provenance, and naming someone else's note would surface that note's title here.
 * Answers the refusal to send, or null when every note is the caller's.
 */
async function refuseForeignSourceNotes(uid: string, sourceNoteIds: string[]): Promise<NextResponse | null> {
  for (const noteId of sourceNoteIds) {
    const note = await studiesRepository.getNote(noteId);
    if (!note || note.userId !== uid) {
      return NextResponse.json({ error: 'Forbidden: source note belongs to another user' }, { status: 403 });
    }
  }
  return null;
}

// POST /api/sermons
export async function POST(request: Request) {
  console.log("POST request received for creating a sermon");
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sermon = await request.json();
    logSermonCreateShape(sermon);

    const userId = uid;
    const title = sermon.title;
    const verse = sermon.verse;
    const date = sermon.date;
    if (sermon.userId && sermon.userId !== uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!title || !verse || !date) {
      return NextResponse.json({ error: "User not authenticated or sermon data is missing" }, { status: 400 });
    }

    /**
     * BORN FROM A STUDY NOTE: the link and the atoms arrive with the create.
     * `sourceNoteIds` is a fact about the sermon (see the model), so it may be set at
     * birth; `scratch` is whitelisted field by field, as the client's own writer does.
     */
    const sourceNoteIds = readSourceNoteIds(sermon.sourceNoteIds);
    if (sourceNoteIds === null) {
      return NextResponse.json({ error: 'sourceNoteIds must be a short list of note ids' }, { status: 400 });
    }
    const refusal = await refuseForeignSourceNotes(uid, sourceNoteIds);
    if (refusal) return refusal;
    const bornAt = new Date().toISOString();
    const scratchAtBirth = sanitizeScratchAtBirth(sermon.scratch, bornAt, new Set(sourceNoteIds));
    if (scratchAtBirth.length > MAX_SCRATCH_AT_BIRTH) {
      // Refuse rather than truncate: dropping atoms silently would tell the person
      // everything was kept while part of their note went missing.
      return NextResponse.json(
        { error: `Too many scratch notes at birth (${scratchAtBirth.length} > ${MAX_SCRATCH_AT_BIRTH})` },
        { status: 400 }
      );
    }

    // Playlist model: series membership is written EXCLUSIVELY by the client
    // sweep into series.items — the create no longer writes the deprecated
    // seriesId/seriesPosition back-ref nor links the sermon into a series.
    /**
     * `updatedAt` IS WRITTEN AT BIRTH, NOT AT THE FIRST EDIT.
     *
     * Reads decide what to show by asking whether the server has proved its copy
     * newer, and the only proofs are `rev` and `updatedAt`. A document created
     * without either can never be beaten: later writes raise the server's
     * revision, the cached copy still carries nothing to compare, and the screen
     * keeps an old snapshot forever. That is what hid four scratch notes behind
     * one — see BUG-20260815-list-copy-hides-scratch. Prayers and series already
     * stamp this on create; sermons now do the same.
     */
    const sermonData: Partial<Sermon> = {
      userId,
      title,
      verse,
      date,
      thoughts: sermon.thoughts || [],
      updatedAt: bornAt,
    };
    if (sourceNoteIds.length > 0) sermonData.sourceNoteIds = sourceNoteIds;
    if (scratchAtBirth.length > 0) sermonData.scratch = scratchAtBirth;

    // Idempotent create when the client supplies the id (offline buffer): a
    // replayed create reuses the same doc instead of duplicating. Ownership
    // mismatch (incl. a missing userId) is rejected so a client id can never
    // reach another user's sermon.
    const clientId = typeof sermon.id === 'string' && sermon.id ? sermon.id : undefined;
    let docRef;
    if (clientId) {
      const ref = adminDb.collection('sermons').doc(clientId);
      const existing = await ref.get();
      if (existing.exists) {
        const existingData = existing.data() as { userId?: string } | undefined;
        if (!existingData || existingData.userId !== userId) {
          return NextResponse.json({ error: 'Forbidden: sermon id belongs to another user' }, { status: 403 });
        }
        return NextResponse.json({ message: 'Sermon already exists', sermon: { ...existingData, id: clientId } });
      }
      await ref.set(sermonData);
      docRef = ref;
    } else {
      docRef = await adminDb.collection('sermons').add(sermonData);
    }
    console.log("Sermon written with ID:", docRef.id);

    /**
     * WHAT GOES BACK IS WHAT WAS WRITTEN. Fields the route stores are answered in their
     * committed form (sanitized scratch, verified links, the birth timestamp), never as the
     * caller sent them — the client seeds its caches from this answer, and a copy that
     * differs from the document would be a second truth. Fields the route does not store
     * are still echoed, as they always were, for callers that read them back.
     */
    const newSermon = createdSermonResponse(sermon, sermonData, userId, docRef.id);
    console.log("New sermon written:", { id: docRef.id, scratch: scratchAtBirth.length, sourceNotes: sourceNoteIds.length });

    console.log("Returning success response for created sermon");
    return NextResponse.json({ message: 'Sermon created successfully', sermon: newSermon });
  } catch (error) {
    console.error("Error occurred while creating sermon:", error);
    return NextResponse.json({ error: 'Failed to create sermon' }, { status: 500 });
  }
}

function logSermonCreateShape(sermon: Record<string, unknown> | null): void {
  // The payload may carry the atoms cut from a private study note: log shape, never text.
  console.log("Parsed sermon data:", {
    hasClientId: typeof sermon?.id === 'string' && sermon.id.length > 0,
    sourceNotes: Array.isArray(sermon?.sourceNoteIds) ? sermon.sourceNoteIds.length : 0,
    scratch: Array.isArray(sermon?.scratch) ? sermon.scratch.length : 0,
    thoughts: Array.isArray(sermon?.thoughts) ? sermon.thoughts.length : 0,
  });
}

function createdSermonResponse(sermon: Record<string, unknown>, sermonData: Partial<Sermon>, userId: string, id: string): Record<string, unknown> {
  const newSermon: Record<string, unknown> = { ...sermon, ...sermonData, userId, id };
  if (!sermonData.scratch) delete newSermon.scratch;
  if (!sermonData.sourceNoteIds) delete newSermon.sourceNoteIds;
  return newSermon;
}
