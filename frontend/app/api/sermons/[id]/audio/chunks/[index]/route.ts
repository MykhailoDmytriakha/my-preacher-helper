/**
 * Chunk Update API Route
 * 
 * PUT /api/sermons/[id]/audio/chunks/[index]
 * 
 * Updates a single audio chunk's text.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { adminDb } from '@/config/firebaseAdminConfig';
import { legacyBoundaryResponse, mutateLegacyResource } from '@/data-engine/legacyBoundary.server';
import { assertServerWritable, serverEditResponse, ServerEditError, writeOwnedDocument } from '@/data-engine/serverEdit.server';
import { StoreUnavailableError, storeUnavailableResponse, withStore } from '@/services/storeAvailability.server';
import { heardChunks, storedSource } from '@/utils/audioChunkIdentity';
import { PreparedAudioChanged, putPreparedAudio, readPreparedAudioSources, preparedAudioVersion, requirePreparedAudio } from '@/utils/preparedAudioSources';
import { CHUNKS_CHANGED, chunksChangedResponse } from '@/utils/server/audioChunksChanged.server';

import type { DocumentData } from '@/data-engine/types';
import type { Sermon } from '@/models/models';
import type { AudioChunk, AudioSourceMode, SermonSection } from '@/types/audioGeneration.types';

// ============================================================================
// Route Handler
// ============================================================================

function isSourceRequestValid(mode: AudioSourceMode | null, source: unknown, expected: unknown): boolean {
    if (!mode || !source || typeof source !== 'object' || Array.isArray(source) || !Array.isArray(expected)) return false;
    const candidate = source as Record<string, unknown>;
    return typeof candidate.id === 'string' && Number.isSafeInteger(candidate.revision);
}

function legacyProjectionMatches(doc: Record<string, unknown> | undefined, expected: unknown[] | null, mode: AudioSourceMode | null): boolean {
    return (!expected || heardChunks(doc?.audioChunks) === heardChunks(expected))
        && (!mode || storedSource(doc) === mode);
}

function updateCurrentChunk(
    current: Record<string, unknown>,
    uid: string,
    hasSource: boolean,
    mode: AudioSourceMode | null,
    sourceToken: unknown,
    expected: unknown[] | null,
    index: number,
    text: string,
    onChanged: (document: Record<string, unknown>, selectedMode?: AudioSourceMode) => void,
): Record<string, unknown> {
    if (current.userId !== uid) throw new ServerEditError('permission-denied', 403);
    if (hasSource) {
        try {
            const source = requirePreparedAudio(current, mode!, sourceToken, expected);
            if (!source) throw new PreparedAudioChanged(mode!, readPreparedAudioSources(current));
            if (index >= source.chunks.length) throw new ServerEditError('chunk-out-of-range', 409);
            const updated = source.chunks.map((chunk, position) => position === index ? { ...chunk, text } : chunk);
            return { ...current, ...putPreparedAudio(current, mode!, updated, { id: source.id, sections: source.sections }) };
        } catch (error) {
            if (error instanceof PreparedAudioChanged) {
                onChanged(current, mode!);
                throw new ServerEditError(CHUNKS_CHANGED, 409);
            }
            throw error;
        }
    }
    if (!legacyProjectionMatches(current, expected, mode)) {
        onChanged(current);
        throw new ServerEditError(CHUNKS_CHANGED, 409);
    }
    const chunks = Array.isArray(current.audioChunks) ? [...current.audioChunks] as AudioChunk[] : [];
    if (index >= chunks.length) throw new ServerEditError('chunk-out-of-range', 409);
    chunks[index] = { ...chunks[index], text };
    const activeMode = storedSource(current);
    const activeSource = readPreparedAudioSources(current)[activeMode];
    const sections = activeSource?.sections ?? [...new Set(chunks.map(chunk => chunk.sectionId))] as SermonSection[];
    return { ...current, ...putPreparedAudio(current, activeMode, chunks, {
        id: activeSource?.id ?? `legacy-${activeMode}`, sections,
    }) };
}

async function persistChunkEdit(
    uid: string,
    sermonId: string,
    hasSource: boolean,
    mode: AudioSourceMode | null,
    sourceToken: unknown,
    expected: unknown[] | null,
    index: number,
    text: string,
    onChanged: (document: Record<string, unknown>, selectedMode?: AudioSourceMode) => void,
): Promise<NextResponse> {
    let accepted: Record<string, unknown> | null = null;
    const resource = { collection: 'sermons', id: sermonId };
    const engineAccepted = await writeOwnedDocument({
        owner: uid,
        resource,
        legacy: async () => {
            await mutateLegacyResource(resource, raw => {
                if (!raw || raw.userId !== uid) throw new ServerEditError('permission-denied', 403);
                const next = updateCurrentChunk(raw as Record<string, unknown>, uid, hasSource, mode, sourceToken, expected, index, text, onChanged);
                accepted = next;
                return { audioChunks: next.audioChunks, audioSources: next.audioSources, audioMetadata: next.audioMetadata };
            });
        },
        engine: current => {
            const next = updateCurrentChunk(current, uid, hasSource, mode, sourceToken, expected, index, text, onChanged);
            accepted = next;
            return next as DocumentData;
        },
    });
    if (engineAccepted) accepted = engineAccepted;
    const response: Record<string, unknown> = {
        success: true,
        chunk: { index, text, preview: text.slice(0, 150) + (text.length > 150 ? '...' : '') },
    };
    if (hasSource && accepted) {
        const sources = readPreparedAudioSources(accepted);
        const source = sources[mode!];
        response.sources = sources;
        response.source = source ? preparedAudioVersion(source) : null;
    }
    return NextResponse.json(response);
}

function chunkEditErrorResponse(error: unknown, changedTo: Record<string, unknown> | undefined, changedMode: AudioSourceMode | undefined): NextResponse {
    if (error instanceof StoreUnavailableError) return storeUnavailableResponse(error);
    if (error instanceof ServerEditError && error.code === CHUNKS_CHANGED) return chunksChangedResponse(changedTo, changedMode);
    if (error instanceof PreparedAudioChanged) return chunksChangedResponse(changedTo, error.mode);
    const boundary = legacyBoundaryResponse(error) ?? serverEditResponse(error);
    if (boundary) return boundary;
    console.error('Chunk update error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Update failed' }, { status: 500 });
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; index: string }> }
): Promise<NextResponse> {
    // What the engine road read when the chunk was not the one the screen showed.
    let changedTo: Record<string, unknown> | undefined;
    let changedMode: AudioSourceMode | undefined;
    try {
        const uid = await getRequiredAuthenticatedUid(request);
        if (!uid) {
            return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
        }

        const { id: sermonId, index: indexStr } = await params;
        const chunkIndex = parseInt(indexStr, 10);

        if (isNaN(chunkIndex) || chunkIndex < 0) {
            return NextResponse.json({ error: 'Invalid chunk index' }, { status: 400 });
        }

        // 1. Load sermon
        const sermonDoc = await withStore(() => adminDb.collection('sermons').doc(sermonId).get());
        if (!sermonDoc.exists) {
            return NextResponse.json({ error: 'Sermon not found' }, { status: 404 });
        }
        const sermon = { id: sermonDoc.id, ...sermonDoc.data() } as Sermon;

        // Verify ownership
        if (sermon.userId !== uid) {
            return NextResponse.json({ error: 'Forbidden: You do not own this sermon' }, { status: 403 });
        }

        assertServerWritable(sermonDoc.data(), 'sermons');
        const body = await request.json();
        const newText: string = body.text;
        if (!newText || typeof newText !== 'string') {
            return NextResponse.json({ error: 'Text is required' }, { status: 400 });
        }

        const hasSource = body.source !== undefined;
        const requestedMode: AudioSourceMode | null = body.mode === 'ai' || body.mode === 'raw' ? body.mode : null;
        if (hasSource && !isSourceRequestValid(requestedMode, body.source, body.expected)) {
            return NextResponse.json({ error: 'Invalid prepared audio source' }, { status: 400 });
        }

        // 2. The index belongs to the set the editor opened, not whichever source is active now.
        const expected: unknown[] | null = Array.isArray(body.expected) ? body.expected : null;
        const expectedSource = requestedMode;
        // The index names a position, not a chunk: the correction lands only while the database holds
        // the very set the editor opened on — the same text at the same position in another source's
        // set is not the chunk the person was correcting (BUG-20260810-audio-chunks-whole-array).
        // The same words stored as the other source are not the set the editor opened on either.
        const opened = (doc: Record<string, unknown> | undefined) => legacyProjectionMatches(doc, expected, expectedSource);
        // Checked before the range: a set that shrank since the editor opened is a changed set, and
        // the answer carries what is stored instead of a bare "out of range".
        if (!hasSource && !opened(sermonDoc.data())) return chunksChangedResponse(sermonDoc.data());
        const chunks = (sermon.audioChunks ?? []) as AudioChunk[];
        if (!hasSource && chunkIndex >= chunks.length) {
            return NextResponse.json({ error: 'Chunk index out of range' }, { status: 400 });
        }

        // 3. Apply the correction to the latest transactional document, preserving the other source.
        return await persistChunkEdit(
            uid, sermonId, hasSource, requestedMode, body.source, expected, chunkIndex, newText,
            (document, selectedMode) => { changedTo = document; changedMode = selectedMode; },
        );
    } catch (error) {
        return chunkEditErrorResponse(error, changedTo, changedMode);
    }
}
