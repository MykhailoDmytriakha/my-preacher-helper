/**
 * Bulk Audio Chunks API Route
 *
 * PUT /api/sermons/[id]/audio/chunks
 *
 * Replaces the entire audioChunks array for a sermon.
 * Used after parallel optimization to persist the merged results.
 */

import { NextRequest, NextResponse } from 'next/server';

import { adminDb } from '@/config/firebaseAdminConfig';

import type { AudioChunk } from '@/types/audioGeneration.types';

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
    try {
        const { id: sermonId } = await params;
        const body = await request.json();
        const userId = body.userId;

        if (!userId) {
            return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
        }

        // Validate input
        if (!body.chunks || !Array.isArray(body.chunks)) {
            return NextResponse.json(
                { error: 'Invalid body: chunks array required' },
                { status: 400 }
            );
        }

        const chunks: AudioChunk[] = body.chunks;

        // Load sermon to verify ownership
        const sermonDoc = await adminDb.collection('sermons').doc(sermonId).get();
        if (!sermonDoc.exists) {
            return NextResponse.json({ error: 'Sermon not found' }, { status: 404 });
        }

        const sermonData = sermonDoc.data();
        if (sermonData?.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden: You do not own this sermon' }, { status: 403 });
        }

        // Update firestore
        await adminDb.collection('sermons').doc(sermonId).update({
            audioChunks: chunks,
            'audioMetadata.lastOptimized': new Date().toISOString(),
        });

        return NextResponse.json({ success: true, count: chunks.length });
    } catch (error) {
        console.error('Bulk chunk update error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to update chunks' },
            { status: 500 }
        );
    }
}
