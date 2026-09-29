/**
 * Bulk Audio Chunks API Route
 *
 * PUT /api/sermons/[id]/audio/chunks
 *
 * Replaces the entire audioChunks array for a sermon — when the wizard switches source, it
 * writes the chunk set it kept for that source.
 *
 * A WHOLE ARRAY FROM A CLIENT'S CACHE MUST NOT LAND ON TOP OF A NEWER ONE
 * (BUG-20260810-audio-chunks-whole-array). The cache can be older than the database: a chunk
 * corrected on another device after this one built it would be written over. The client sends
 * `expected` — the chunk set it last saw stored — and the write happens only while the database
 * still holds exactly that; otherwise it answers 409 `chunks-changed` with what is stored now.
 * The engine road re-checks inside its read-apply-retry loop, so a change between the check
 * and the write is caught as well. A client that sends no `expected` keeps the old behaviour.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { adminDb } from '@/config/firebaseAdminConfig';
import { legacyBoundaryResponse, updateLegacyDocument } from '@/data-engine/legacyBoundary.server';
import { applyLegacyPatch, assertServerWritable, serverEditResponse, ServerEditError, writeOwnedDocument } from '@/data-engine/serverEdit.server';
import { heardChunks, storedChunk } from '@/utils/audioChunkIdentity';
import { CHUNKS_CHANGED, chunksChangedResponse } from '@/utils/server/audioChunksChanged.server';

import type { AudioChunk } from '@/types/audioGeneration.types';

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
    // What the engine road read when it found the set changed — answered without another read.
    let changedTo: Record<string, unknown> | undefined;
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
        const expected: unknown[] | null = Array.isArray(body.expected) ? body.expected : null;
        if (expected && heardChunks(sermonData?.audioChunks) !== heardChunks(expected)) return chunksChangedResponse(sermonData);
        // Optional source mode ('ai' | 'raw') so the modal can persist which source
        // produced these chunks when switching between modes from cache (no re-optimize).
        const mode: string | undefined = body.mode === 'ai' || body.mode === 'raw' ? body.mode : undefined;

        // Update firestore
        const updates: Record<string, unknown> = {
            audioChunks: chunks,
            'audioMetadata.chunksCount': chunks.length,
            'audioMetadata.lastOptimized': new Date().toISOString(),
        };
        if (mode) {
            updates['audioMetadata.mode'] = mode;
        }
        await writeOwnedDocument({
            owner: uid,
            resource: { collection: 'sermons', id: sermonId },
            legacy: () => updateLegacyDocument(adminDb.collection('sermons').doc(sermonId), updates),
            engine: current => {
                if (expected && heardChunks(current.audioChunks) !== heardChunks(expected)) {
                    changedTo = current;
                    throw new ServerEditError(CHUNKS_CHANGED, 409);
                }
                return applyLegacyPatch(current, updates);
            },
        });

        return NextResponse.json({ success: true, count: chunks.length });
    } catch (error) {
    if (error instanceof ServerEditError && error.code === CHUNKS_CHANGED) return chunksChangedResponse(changedTo);
    const boundary = legacyBoundaryResponse(error) ?? serverEditResponse(error);
    if (boundary) return boundary;
        console.error('Bulk chunk update error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to update chunks' },
            { status: 500 }
        );
    }
}
