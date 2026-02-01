/**
 * Optimize Text API Route
 * 
 * POST /api/sermons/[id]/audio/optimize
 * 
 * Step 1 of step-by-step audio generation:
 * Runs GPT optimization, saves chunks to Firestore.
 * 
 * IMPEMENTATION:
 * - Iterative sequential generation.
 * - Processes outline points one by one.
 * - Passes previous chunk context to the next generation step.
 */

import { NextRequest, NextResponse } from 'next/server';

import { optimizeTextForSpeech } from '@/api/clients/speechOptimization.client';
import { createAudioChunks } from '@/api/clients/tts.client';
import { SectionKey, SECTION_CONFIG, getSectionThoughts } from '@/api/services/sermonTextService';
import { adminDb } from '@/config/firebaseAdminConfig';

import type { Sermon, Thought } from '@/models/models';
import type { AudioChunk, AudioMetadata, SectionSelection } from '@/types/audioGeneration.types';

// ============================================================================
// Types
// ============================================================================

interface GenerationSegment {
    id: string;
    section: SectionKey;
    title: string;
    thoughts: Thought[];
    contextType: 'start' | 'transition';
}

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
        const userId = body.userId;

        // Default to true for backward compatibility
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

        if (sermon.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // 2. Prepare Segments based on Outline & Thoughts
        const sectionsToProcess: SectionKey[] = requestedSections === 'all'
            ? ['introduction', 'mainPart', 'conclusion']
            : [requestedSections as SectionKey];

        const segments: GenerationSegment[] = buildGenerationSegments(sermon, sectionsToProcess);

        // 3. Sequential Generation Loop with Context
        let allChunks: AudioChunk[] = [];
        let accumulatedContext = '';
        let totalOriginalLength = 0;
        let totalOptimizedLength = 0;

        // If filtering, load existing chunks to preserve what we don't change?
        // Current logic: we overwrite what we touch. If user requested specific section,
        // we might want to keep others.
        const existingChunks = (sermon.audioChunks || []) as AudioChunk[];
        if (requestedSections !== 'all') {
            // Keep chunks from other sections
            allChunks = existingChunks.filter(c => c.sectionId !== requestedSections);
        }

        console.log(`[OptimizeAPI] Starting generation for ${segments.length} segments.`);

        for (const segment of segments) {
            console.log(`[OptimizeAPI] Processing: ${segment.section} - ${segment.title}`);

            // Construct text for this segment
            const segmentText = formatSegmentText(segment);

            if (!segmentText) {
                console.log(`[OptimizeAPI] Skipping empty segment: ${segment.title}`);
                continue;
            }

            totalOriginalLength += segmentText.length;

            // Generate with context from previous loop
            const result = await optimizeTextForSpeech(
                segmentText,
                sermon,
                {
                    sermonTitle: sermon.title,
                    scriptureVerse: sermon.verse,
                    sections: segment.section,
                    previousContext: accumulatedContext || undefined
                }
            );

            // Update stats
            totalOptimizedLength += result.optimizedLength;

            // Update context for NEXT iteration
            // We use the last generated chunk (or full text if small) as context
            accumulatedContext = result.optimizedText.slice(-1000); // Last 1000 chars

            // Convert to AudioChunk objects
            const newChunks = createAudioChunks(result.chunks, segment.section);

            // Push to our local collection
            // Note: we will re-index globally at the end
            allChunks.push(...newChunks);
        }

        // 4. Global Re-indexing
        // Sort by section order first, then by existing sequence
        const sectionOrder: Record<string, number> = { introduction: 0, mainPart: 1, conclusion: 2 };

        allChunks.sort((a, b) => {
            const secDiff = (sectionOrder[a.sectionId] || 0) - (sectionOrder[b.sectionId] || 0);
            if (secDiff !== 0) return secDiff;
            // Within same section, trust the push order (stable sort usually) 
            // Since we reconstructed the list sequentially, this should be fine.
            return 0;
        });

        // Assign clean 0-based index
        allChunks = allChunks.map((chunk, idx) => ({ ...chunk, index: idx }));

        // 5. Save to DB
        if (saveToDb) {
            const metadata: AudioMetadata = {
                voice: 'onyx',
                model: 'gpt-4o-mini-tts',
                lastGenerated: new Date().toISOString(),
                chunksCount: allChunks.length,
            };

            await adminDb.collection('sermons').doc(sermonId).update({
                audioChunks: allChunks,
                audioMetadata: metadata,
            });
        }

        return NextResponse.json({
            success: true,
            chunks: allChunks.map((c, i) => ({
                index: i,
                sectionId: c.sectionId,
                text: c.text,
                preview: c.text.slice(0, 150) + '...',
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

// ============================================================================
// Helpers
// ============================================================================

/**
 * Turns the hierarchical sermon structure into a flat list of generation tasks.
 */
function buildGenerationSegments(
    sermon: Sermon,
    sectionsToProcess: SectionKey[]
): GenerationSegment[] {
    const segments: GenerationSegment[] = [];

    for (const sectionKey of sectionsToProcess) {
        const config = SECTION_CONFIG[sectionKey];
        const outlinePoints = sermon.outline?.[sectionKey as keyof typeof sermon.outline] || [];
        const allThoughts = getSectionThoughts(sermon, sectionKey);

        // 1. If we have Outline Points, prioritize them
        if (outlinePoints.length > 0) {
            const thoughtsByPoint = new Map<string, Thought[]>();

            // Bucket thoughts by outline point
            for (const t of allThoughts) {
                if (t.outlinePointId) {
                    const existing = thoughtsByPoint.get(t.outlinePointId) || [];
                    existing.push(t);
                    thoughtsByPoint.set(t.outlinePointId, existing);
                }
            }

            // Create segment for each point
            for (const point of outlinePoints) {
                const pointsThoughts = thoughtsByPoint.get(point.id) || [];
                segments.push({
                    id: point.id,
                    section: sectionKey,
                    title: point.text,
                    thoughts: pointsThoughts,
                    contextType: 'transition'
                });
            }

            // Handle "orphaned" thoughts in this section (not assigned to points)
            const orphanedThoughts = allThoughts.filter(t => !t.outlinePointId);
            if (orphanedThoughts.length > 0) {
                segments.push({
                    id: `${sectionKey}-orphans`,
                    section: sectionKey,
                    title: `${config.title} (Additional)`,
                    thoughts: orphanedThoughts,
                    contextType: 'transition'
                });
            }

        } else {
            // 2. If NO Outline Points, treat the whole section as one big segment
            if (allThoughts.length > 0) {
                segments.push({
                    id: sectionKey,
                    section: sectionKey,
                    title: config.title,
                    thoughts: allThoughts,
                    contextType: 'transition'
                });
            }
        }
    }

    return segments;
}

function formatSegmentText(segment: GenerationSegment): string {
    const lines: string[] = [];

    // Add segment title as context/header
    lines.push(`## ${segment.title}`);

    // Add thoughts
    for (const t of segment.thoughts) {
        lines.push(t.text);
    }

    return lines.join('\n\n').trim();
}
