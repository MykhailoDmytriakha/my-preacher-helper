/**
 * Chunk Update API Route
 * 
 * PUT /api/sermons/[id]/audio/chunks/[index]
 * 
 * Updates a single audio chunk's text.
 */

import { NextRequest, NextResponse } from 'next/server';

import { adminDb } from '@/config/firebaseAdminConfig';

import type { Sermon } from '@/models/models';
import type { AudioChunk } from '@/types/audioGeneration.types';

// ============================================================================
// Route Handler
// ============================================================================

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; index: string }> }
): Promise<NextResponse> {
    try {
        const { id: sermonId, index: indexStr } = await params;
        const chunkIndex = parseInt(indexStr, 10);
        const body = await request.json();
        const newText: string = body.text;
        const userId = body.userId;

        if (!userId) {
            return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
        }

        if (isNaN(chunkIndex) || chunkIndex < 0) {
            return NextResponse.json({ error: 'Invalid chunk index' }, { status: 400 });
        }

        if (!newText || typeof newText !== 'string') {
            return NextResponse.json({ error: 'Text is required' }, { status: 400 });
        }

        // 1. Load sermon
        const sermonDoc = await adminDb.collection('sermons').doc(sermonId).get();
        if (!sermonDoc.exists) {
            return NextResponse.json({ error: 'Sermon not found' }, { status: 404 });
        }
        const sermon = { id: sermonDoc.id, ...sermonDoc.data() } as Sermon;

        // Verify ownership
        if (sermon.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden: You do not own this sermon' }, { status: 403 });
        }

        // 2. Get chunks
        const chunks = (sermon.audioChunks || []) as AudioChunk[];
        if (chunkIndex >= chunks.length) {
            return NextResponse.json({ error: 'Chunk index out of range' }, { status: 400 });
        }

        // 3. Update chunk
        chunks[chunkIndex] = {
            ...chunks[chunkIndex],
            text: newText,
        };

        // 4. Save back
        await adminDb.collection('sermons').doc(sermonId).update({
            audioChunks: chunks,
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
        console.error('Chunk update error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Update failed' },
            { status: 500 }
        );
    }
}
