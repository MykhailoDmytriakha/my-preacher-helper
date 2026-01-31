/**
 * Optimize Text API Route
 * 
 * POST /api/sermons/[id]/audio/optimize
 * 
 * Step 1 of step-by-step audio generation:
 * Runs GPT optimization only, saves chunks to Firestore.
 */

import { NextRequest, NextResponse } from 'next/server';

import { optimizeTextForSpeech } from '@/api/clients/speechOptimization.client';
import { createAudioChunks } from '@/api/clients/tts.client';
import { extractSermonText, SectionKey } from '@/api/services/sermonTextService';
import { adminDb } from '@/config/firebaseAdminConfig';

import type { Sermon } from '@/models/models';
import type { AudioChunk, AudioMetadata, SectionSelection } from '@/types/audioGeneration.types';

// Text extraction logic moved to @/api/services/sermonTextService

// ============================================================================
// Route Handler
// ============================================================================

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
    try {
        const { id: sermonId } = await params;
        const body = await request.json();
        const requestedSections: SectionSelection = body.sections || 'all';
        const userId = body.userId; // Required for ownership verification

        // Default to true for backward compatibility, unless explicitly false
        const saveToDb = body.saveToDb !== false;

        if (!userId) {
            return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
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

        // 2. Identify sections to process
        const sectionsToProcess: SectionKey[] = requestedSections === 'all'
            ? ['introduction', 'mainPart', 'conclusion']
            : [requestedSections as SectionKey];

        let allChunks: AudioChunk[] = [];
        const existingChunks = (sermon.audioChunks || []) as AudioChunk[];

        // 3. Process each section independently
        // If we are optimizing specific sections, we should keep existing chunks from OTHER sections
        if (requestedSections !== 'all') {
            allChunks = existingChunks.filter(c => c.sectionId !== requestedSections);
        }

        let totalOriginalLength = 0;
        let totalOptimizedLength = 0;

        for (const section of sectionsToProcess) {
            // Extract raw text for this section
            const rawSectionText = extractSermonText(sermon, section);

            console.log(`[OptimizeAPI] Processing section: ${section}, TextLength: ${rawSectionText?.length}`);

            if (!rawSectionText) {
                console.log(`[OptimizeAPI] Skipping empty section: ${section}`);
                continue;
            }

            totalOriginalLength += rawSectionText.length;

            // Optimize
            const optimized = await optimizeTextForSpeech(
                rawSectionText,
                sermon,
                {
                    sermonTitle: sermon.title,
                    scriptureVerse: sermon.verse,
                    sections: section, // Pass specific section context
                }
            );

            totalOptimizedLength += optimized.optimizedText.length;

            // Chunk (using GPT-provided semantic chunks)
            // Note: createAudioChunks maps them to AudioChunk objects
            const sectionChunks = createAudioChunks(optimized.chunks, section);

            // Adjust indexes to be global or keep them local? 
            // Ideally we want a global sequence for playback, but local for editing.
            // createAudioChunks assigns 0-based index. 
            // We can re-index later if needed, but for now let's just append.
            allChunks.push(...sectionChunks);
        }

        // Re-assign global indexes to ensure correct playback order
        // Sort by section order first: Intro -> Main -> Conclusion
        const sectionOrder: Record<string, number> = { introduction: 0, mainPart: 1, conclusion: 2 };
        allChunks.sort((a, b) => {
            const secDiff = (sectionOrder[a.sectionId] || 0) - (sectionOrder[b.sectionId] || 0);
            if (secDiff !== 0) return secDiff;
            return a.index - b.index; // Keep relative order within section
        });

        // Re-index globally
        allChunks = allChunks.map((chunk, idx) => ({ ...chunk, index: idx }));

        // 4. Save to Firestore (only if saveToDb is true)
        if (saveToDb) {
            const metadata: AudioMetadata = {
                voice: 'onyx', // Default, should effectively be updated by generate step or passed here
                model: 'gpt-4o-mini-tts',
                lastGenerated: new Date().toISOString(),
                chunksCount: allChunks.length,
            };

            await adminDb.collection('sermons').doc(sermonId).update({
                audioChunks: allChunks,
                audioMetadata: metadata,
            });
        }

        // 5. Return chunks for preview
        return NextResponse.json({
            success: true,
            chunks: allChunks.map((c, i) => ({
                index: i,
                sectionId: c.sectionId,
                text: c.text,
                preview: c.text.slice(0, 150) + (c.text.length > 150 ? '...' : ''),
            })),
            totalChunks: allChunks.length,
            originalLength: totalOriginalLength,
            optimizedLength: totalOptimizedLength,
        });
    } catch (error) {
        console.error('Optimize error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Optimization failed' },
            { status: 500 }
        );
    }
}
