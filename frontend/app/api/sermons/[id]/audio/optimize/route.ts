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

import { generateSermonTransitions } from '@/api/clients/sermonTransitions.client';
import { optimizeTextForSpeech } from '@/api/clients/speechOptimization.client';
import { createAudioChunks, splitTextEvenly } from '@/api/clients/tts.client';
import { buildGenerationSegments, type GenerationSegment } from '@/api/services/sermonAudioSegments';
import {
    SectionKey,
    SECTION_CONFIG,
    getSectionThoughtsInVisualOrder,
    resolveSections,
} from '@/api/services/sermonTextService';
import {
    weaveTransitionChunks,
    type SegmentBody,
    type TransitionSegment,
} from '@/api/services/sermonTransitions';
import { adminDb } from '@/config/firebaseAdminConfig';
import { SERMON_SECTIONS } from '@/types/audioGeneration.types';
import { normalizeScriptureReferencesForTts } from '@/utils/scriptureReferenceNormalizer';
import { GOOGLE_TTS_MAX_CHUNK_SIZE, splitGoogleTextForRequestLimit } from '@/utils/server/googleTtsChunking';

import type { Sermon } from '@/models/models';
import type { AudioChunk, SectionSelection } from '@/types/audioGeneration.types';

// ============================================================================
// Types
// ============================================================================

interface SegmentBuildResult {
    /** Per-segment body chunks in narration order; transitions are woven in by the caller. */
    segmentBodies: (SegmentBody & { title: string; level: 'point' | 'subpoint' | 'continuation' })[];
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

        // Build the sermon body chunks grouped per segment, so spoken transitions can
        // be woven BETWEEN the parts (intro → part → bridge → part → … → outro).
        const built = (useRawText && provider === 'google')
            ? buildGoogleRawSegmentBodies(sermon, sectionsToProcess)
            : await buildSegmentBodies(segments, sermon, provider, useRawText);

        // Generate spoken connective tissue so the narration's structure is audible.
        // Additive layer: never throws — returns empty transitions on any failure, so
        // the core audio export still works even if the LLM is unavailable.
        const now = new Date().toISOString();
        // Continuation runs (a point resuming after a sub-point) carry body but get NO
        // spoken lead-in, so they're excluded from the parts we ask the model to bridge.
        const transitionSegments: TransitionSegment[] = built.segmentBodies
            .filter(s => s.bodyChunks.length > 0 && s.level !== 'continuation')
            .map(({ id, section, title, level }) => ({ id, section, title, level: level as 'point' | 'subpoint' }));
        const transitions = await generateSermonTransitions(sermon, transitionSegments);
        console.log(`[OptimizeAPI] Transitions: intro=${transitions.intro ? 'yes' : 'no'}, bridges=${Object.keys(transitions.bridges).length}, outro=${transitions.outro ? 'yes' : 'no'}`);

        // Only emit the global opening/closing when their home sections are in scope
        // (a partial re-optimize of just the main part shouldn't inject a fresh intro).
        const woven = weaveTransitionChunks(built.segmentBodies, transitions, now, {
            includeIntro: sectionsToProcess.includes('introduction'),
            includeOutro: sectionsToProcess.includes('conclusion'),
        });

        allChunks.push(...woven);
        const totalOriginalLength = built.originalLength;
        const totalOptimizedLength = built.optimizedLength;

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
                kind: c.kind ?? 'body',
                role: c.role,
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
 * Google "use as-is" path: voice the exact section text, split only for request limits.
 * One segment per major section (Google raw has no per-point outline granularity).
 */
function buildGoogleRawSegmentBodies(
    sermon: Sermon,
    sectionsToProcess: SectionKey[]
): SegmentBuildResult {
    const segmentBodies: (SegmentBody & { title: string; level: 'point' | 'subpoint' | 'continuation' })[] = [];
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
        segmentBodies.push({
            id: section,
            section,
            title: SECTION_CONFIG[section].title,
            level: 'point',
            bodyChunks: createAudioChunks(splitGoogleTextForRequestLimit(rawText), section),
        });
    }

    return { segmentBodies, originalLength, optimizedLength };
}

/**
 * Per-segment generation. In raw mode the thoughts are voiced verbatim; otherwise each
 * segment is GPT-optimized with the previous segment's tail carried over as context.
 * Returns body chunks grouped per segment so the caller can weave transitions between them.
 */
async function buildSegmentBodies(
    segments: GenerationSegment[],
    sermon: Sermon,
    provider: 'google' | 'openai',
    useRawText: boolean
): Promise<SegmentBuildResult> {
    const segmentBodies: (SegmentBody & { title: string; level: 'point' | 'subpoint' | 'continuation' })[] = [];
    let originalLength = 0;
    let optimizedLength = 0;
    let accumulatedContext = '';

    for (const segment of segments) {
        console.log(`[OptimizeAPI] Processing: ${segment.section} - ${segment.title}`);

        let bodyChunks: AudioChunk[] = [];

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
            bodyChunks = createAudioChunks(splitTextEvenly(rawText), segment.section);
        } else {
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

            bodyChunks = createAudioChunks(chunksForTts, segment.section);
        }

        if (bodyChunks.length === 0) continue;
        segmentBodies.push({
            id: segment.id,
            section: segment.section,
            title: segment.title,
            level: segment.level,
            bodyChunks,
        });
    }

    return { segmentBodies, originalLength, optimizedLength };
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
