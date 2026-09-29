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
import { legacyBoundaryResponse, updateLegacyDocument } from '@/data-engine/legacyBoundary.server';
import { assertServerWritable, serverEditResponse, ServerEditError, writeOwnedDocument } from '@/data-engine/serverEdit.server';
import { heardChunks, storedSource } from '@/utils/audioChunkIdentity';
import { CHUNKS_CHANGED, chunksChangedResponse } from '@/utils/server/audioChunksChanged.server';

import type { Sermon } from '@/models/models';
import type { AudioChunk } from '@/types/audioGeneration.types';

// ============================================================================
// Route Handler
// ============================================================================

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; index: string }> }
): Promise<NextResponse> {
    // What the engine road read when the chunk was not the one the screen showed.
    let changedTo: Record<string, unknown> | undefined;
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
        const sermonDoc = await adminDb.collection('sermons').doc(sermonId).get();
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

        // 2. Get chunks
        const chunks = (sermon.audioChunks || []) as AudioChunk[];
        if (chunkIndex >= chunks.length) {
            return NextResponse.json({ error: 'Chunk index out of range' }, { status: 400 });
        }
        // The index names a position, not a chunk: the correction lands only while the database holds
        // the very set the editor opened on — the same text at the same position in another source's
        // set is not the chunk the person was correcting (BUG-20260810-audio-chunks-whole-array).
        // The same words stored as the other source are not the set the editor opened on either.
        const expected: unknown[] | null = Array.isArray(body.expected) ? body.expected : null;
        const expectedSource = body.mode === 'ai' || body.mode === 'raw' ? body.mode : null;
        const opened = (doc: Record<string, unknown> | undefined) => (!expected || heardChunks(doc?.audioChunks) === heardChunks(expected))
            && (!expectedSource || storedSource(doc) === expectedSource);
        if (!opened(sermonDoc.data())) return chunksChangedResponse(sermonDoc.data());

        // 3. Update chunk
        // A new array, not an edit of the one just read: that read is also what the checks compare.
        const updated = chunks.map((chunk, position) => (position === chunkIndex ? { ...chunk, text: newText } : chunk));

        // 4. Save back. On an engine document only this chunk's text changes, on the copy
        // current at write time.
        await writeOwnedDocument({
            owner: uid,
            resource: { collection: 'sermons', id: sermonId },
            legacy: () => updateLegacyDocument(adminDb.collection('sermons').doc(sermonId), { audioChunks: updated }),
            engine: current => {
                const stored = Array.isArray(current.audioChunks) ? [...current.audioChunks] : [];
                if (chunkIndex >= stored.length) throw new ServerEditError('chunk-out-of-range', 409);
                if (!opened(current)) {
                    changedTo = current;
                    throw new ServerEditError(CHUNKS_CHANGED, 409);
                }
                stored[chunkIndex] = { ...(stored[chunkIndex] as Record<string, never>), text: newText };
                return { ...current, audioChunks: stored };
            },
        });

        return NextResponse.json({
            success: true,
            chunk: {
                index: chunkIndex,
                text: newText,
                preview: newText.slice(0, 150) + (newText.length > 150 ? '...' : ''),
            },
        });
    } catch (error) {
        if (error instanceof ServerEditError && error.code === CHUNKS_CHANGED) return chunksChangedResponse(changedTo);
    const boundary = legacyBoundaryResponse(error) ?? serverEditResponse(error);
    if (boundary) return boundary;
        console.error('Chunk update error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Update failed' },
            { status: 500 }
        );
    }
}
