/**
 * Bulk Audio Chunks API Route
 *
 * PUT /api/sermons/[id]/audio/chunks
 *
 * Compatibility endpoint for older source-switch clients. New clients select their
 * independently saved AI/Original sources without writing cached arrays.
 * The active projection baseline and the target source are both checked against
 * the latest transactional document. A differing saved target cannot be replaced
 * by an older cache; the inactive source and its corrections remain persisted.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { adminDb } from '@/config/firebaseAdminConfig';
import { legacyBoundaryResponse, mutateLegacyResource } from '@/data-engine/legacyBoundary.server';
import { assertServerWritable, serverEditResponse, ServerEditError, writeOwnedDocument } from '@/data-engine/serverEdit.server';
import { storedChunk, storedSource } from '@/utils/audioChunkIdentity';
import { activatePreparedAudio, PreparedAudioChanged, preparedAudioVersion, readPreparedAudioSources } from '@/utils/preparedAudioSources';
import { CHUNKS_CHANGED, chunksChangedResponse } from '@/utils/server/audioChunksChanged.server';

import type { DocumentData } from '@/data-engine/types';
import type { AudioChunk, AudioSourceMode } from '@/types/audioGeneration.types';

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
    // What the engine road read when it found the set changed — answered without another read.
    let changedTo: Record<string, unknown> | undefined;
    let changedMode: AudioSourceMode | undefined;
    try {
        const uid = await getRequiredAuthenticatedUid(request);
        if (!uid) {
            return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
        }

        const { id: sermonId } = await params;

        // Load sermon to verify ownership
        const sermonDoc = await adminDb.collection('sermons').doc(sermonId).get();
        if (!sermonDoc.exists) {
            return NextResponse.json({ error: 'Sermon not found' }, { status: 404 });
        }

        const sermonData = sermonDoc.data();
        if (sermonData?.userId !== uid) {
            return NextResponse.json({ error: 'Forbidden: You do not own this sermon' }, { status: 403 });
        }

        assertServerWritable(sermonDoc.data(), 'sermons');
        const body = await request.json();
        if (!body.chunks || !Array.isArray(body.chunks)) {
            return NextResponse.json(
                { error: 'Invalid body: chunks array required' },
                { status: 400 }
            );
        }

        // Stored shape only: a cached chunk may lack createdAt (the engine refuses the whole set) or carry a preview.
        const now = new Date().toISOString();
        const chunks: AudioChunk[] = (body.chunks as Partial<AudioChunk>[]).map(chunk => storedChunk(chunk, now));
        const expected = Array.isArray(body.expected) ? body.expected : undefined;
        const mode: AudioSourceMode = body.mode === 'ai' || body.mode === 'raw' ? body.mode : storedSource(sermonData);
        changedTo = sermonData; changedMode = mode;
        activatePreparedAudio(sermonData ?? {}, mode, chunks, expected);
        let result = sermonData ?? {};
        const mutate = (current: DocumentData): DocumentData => {
            if (current.userId !== uid) throw new ServerEditError('permission-denied', 403);
            changedTo = current;
            const fields = activatePreparedAudio(current, mode, chunks, expected);
            result = { ...current, ...fields };
            return result as DocumentData;
        };
        const accepted = await writeOwnedDocument({
            owner: uid,
            resource: { collection: 'sermons', id: sermonId },
            legacy: () => mutateLegacyResource({ collection: 'sermons', id: sermonId }, current => {
                if (!current) throw new ServerEditError('not-found', 404);
                const next = mutate(current);
                return { audioChunks: next.audioChunks, audioMetadata: next.audioMetadata, audioSources: next.audioSources };
            }),
            engine: mutate,
        });
        const sources = readPreparedAudioSources(accepted ?? result), source = sources[mode];
        return NextResponse.json({ success: true, count: chunks.length, mode, sources, ...(source ? { source: preparedAudioVersion(source) } : {}) });
    } catch (error) {
        if (error instanceof PreparedAudioChanged || (error instanceof ServerEditError && error.code === CHUNKS_CHANGED)) return chunksChangedResponse(changedTo, error instanceof PreparedAudioChanged ? error.mode : changedMode);
        const boundary = legacyBoundaryResponse(error) ?? serverEditResponse(error);
        if (boundary) return boundary;
        console.error('Bulk chunk update error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to update chunks' },
            { status: 500 }
        );
    }
}
