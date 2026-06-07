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
import { createAudioChunks, splitTextEvenly } from '@/api/clients/tts.client';
import {
    SectionKey,
    SECTION_CONFIG,
    getSectionOutlinePoints,
    getSectionThoughtsInVisualOrder,
    resolveSections,
} from '@/api/services/sermonTextService';
import { adminDb } from '@/config/firebaseAdminConfig';
import { SERMON_SECTIONS } from '@/types/audioGeneration.types';
import { normalizeScriptureReferencesForTts } from '@/utils/scriptureReferenceNormalizer';
import { GOOGLE_TTS_MAX_CHUNK_SIZE, splitGoogleTextForRequestLimit } from '@/utils/server/googleTtsChunking';

import type { Sermon, Thought } from '@/models/models';
import type { AudioChunk, SectionSelection } from '@/types/audioGeneration.types';

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

interface GenerationResult {
    chunks: AudioChunk[];
    originalLength: number;
    optimizedLength: number;
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
        const requestedSections: SectionSelection | string[] = body.sections ?? 'all';
        const userId = body.userId;
        const provider = body.provider === 'google' ? 'google' : 'openai';
        // "Use as-is" mode: skip GPT rewrite, voice the exact sermon text and only
        // split it mechanically into TTS-sized chunks.
        const useRawText = body.useRawText === true;

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
        // `sections` may be 'all', a single section key, or an array of keys (checkboxes).
        const resolved = resolveSections(requestedSections);
        const sectionsToProcess: SectionKey[] = resolved.length > 0 ? resolved : (SERMON_SECTIONS as SectionKey[]);
        const isAllSections = sectionsToProcess.length === SERMON_SECTIONS.length;

        const segments: GenerationSegment[] = buildGenerationSegments(sermon, sectionsToProcess);

        // 3. Sequential Generation Loop with Context
        // If filtering, preserve chunks from sections we are NOT re-processing this run.
        const existingChunks = (sermon.audioChunks || []) as AudioChunk[];
        let allChunks: AudioChunk[] = [];
        if (!isAllSections) {
            const processing = new Set<string>(sectionsToProcess);
            allChunks = existingChunks.filter(c => !processing.has(c.sectionId));
        }

        console.log(`[OptimizeAPI] Starting generation for ${segments.length} segments.`);

        const generated = (useRawText && provider === 'google')
            ? buildGoogleRawChunks(sermon, sectionsToProcess)
            : await buildSegmentChunks(segments, sermon, provider, useRawText);

        allChunks.push(...generated.chunks);
        const totalOriginalLength = generated.originalLength;
        const totalOptimizedLength = generated.optimizedLength;

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
        // Use dot-path updates so we record the source mode and refresh chunk/optimize
        // metadata WITHOUT clobbering voice/model/lastGenerated from a previous render.
        if (saveToDb) {
            await adminDb.collection('sermons').doc(sermonId).update({
                audioChunks: allChunks,
                'audioMetadata.mode': useRawText ? 'raw' : 'ai',
                'audioMetadata.chunksCount': allChunks.length,
                'audioMetadata.lastOptimized': new Date().toISOString(),
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
        const outlinePoints = getSectionOutlinePoints(sermon, sectionKey);
        const allThoughts = getSectionThoughtsInVisualOrder(sermon, sectionKey);

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

/**
 * Google "use as-is" path: voice the exact section text, split only for request limits.
 */
function buildGoogleRawChunks(
    sermon: Sermon,
    sectionsToProcess: SectionKey[]
): GenerationResult {
    const chunks: AudioChunk[] = [];
    let originalLength = 0;
    let optimizedLength = 0;

    console.log(`[OptimizeAPI] Preparing Google raw text by major section (max ${GOOGLE_TTS_MAX_CHUNK_SIZE} chars/request).`);
    for (const section of sectionsToProcess) {
        const originalRawText = getRawSectionText(sermon, section);
        const rawText = normalizeScriptureReferencesForTts(originalRawText);
        if (!rawText) {
            console.log(`[OptimizeAPI] Skipping empty section: ${section}`);
            continue;
        }
        originalLength += originalRawText.length;
        optimizedLength += rawText.length;
        chunks.push(...createAudioChunks(splitGoogleTextForRequestLimit(rawText), section));
    }

    return { chunks, originalLength, optimizedLength };
}

/**
 * Per-segment generation. In raw mode the thoughts are voiced verbatim; otherwise each
 * segment is GPT-optimized with the previous segment's tail carried over as context.
 */
async function buildSegmentChunks(
    segments: GenerationSegment[],
    sermon: Sermon,
    provider: 'google' | 'openai',
    useRawText: boolean
): Promise<GenerationResult> {
    const chunks: AudioChunk[] = [];
    let originalLength = 0;
    let optimizedLength = 0;
    let accumulatedContext = '';

    for (const segment of segments) {
        console.log(`[OptimizeAPI] Processing: ${segment.section} - ${segment.title}`);

        if (useRawText) {
            // Thoughts are already in visual order; build the full segment first,
            // then split mechanically by TTS chunk size.
            const originalRawText = segment.thoughts.map(t => t.text).join('\n\n').trim();
            const rawText = normalizeScriptureReferencesForTts(originalRawText);
            if (!rawText) {
                console.log(`[OptimizeAPI] Skipping empty segment: ${segment.title}`);
                continue;
            }
            originalLength += originalRawText.length;
            optimizedLength += rawText.length;
            chunks.push(...createAudioChunks(splitTextEvenly(rawText), segment.section));
            continue;
        }

        const segmentText = formatSegmentText(segment);
        if (!segmentText) {
            console.log(`[OptimizeAPI] Skipping empty segment: ${segment.title}`);
            continue;
        }
        originalLength += segmentText.length;

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

        const optimizedTextForTts = normalizeScriptureReferencesForTts(result.optimizedText);
        // OpenAI is the quality path: re-chunk GPT output to even ~1500-2000 clips
        // (the model returns arbitrary-sized chunks). Google keeps its own chunks.
        const chunksForTts = provider === 'openai'
            ? splitTextEvenly(optimizedTextForTts)
            : result.chunks.map(normalizeScriptureReferencesForTts);
        optimizedLength += optimizedTextForTts.length;

        // Carry the last 1000 chars into the next iteration as context.
        accumulatedContext = optimizedTextForTts.slice(-1000);

        chunks.push(...createAudioChunks(chunksForTts, segment.section));
    }

    return { chunks, originalLength, optimizedLength };
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

function getRawSectionText(sermon: Sermon, section: SectionKey): string {
    return getSectionThoughtsInVisualOrder(sermon, section)
        .map(thought => thought.text.trim())
        .filter(Boolean)
        .join('\n\n')
        .trim();
}
