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

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { generateSermonTransitions } from '@/api/clients/sermonTransitions.client';
import { optimizeTextForSpeech } from '@/api/clients/speechOptimization.client';
import { createAudioChunks, EVEN_SPLIT_IDEAL_SIZE, splitTextEvenly } from '@/api/clients/tts.client';
import { usageCapResponse } from '@/api/errors/usageCapResponse';
import { buildGenerationSegments, type GenerationSegment } from '@/api/services/sermonAudioSegments';
import {
    SectionKey,
    SECTION_CONFIG,
    getSectionThoughtsInVisualOrder,
    resolveSections,
} from '@/api/services/sermonTextService';
import {
    weaveTransitionChunks,
    EMPTY_TRANSITIONS,
    type SegmentBody,
    type TransitionSegment,
} from '@/api/services/sermonTransitions';
import { GOOGLE_SMALL_CHUNKING } from '@/config/audioGeneration';
import { adminDb } from '@/config/firebaseAdminConfig';
import { legacyBoundaryResponse, mutateLegacyResource } from '@/data-engine/legacyBoundary.server';
import { assertServerWritable, serverEditResponse, ServerEditError, writeOwnedDocument } from '@/data-engine/serverEdit.server';
import { isUsageCapReachedError } from '@/services/usageLimits';
import { createUsageAdmission } from '@/services/usageLimits.server';
import { getUserEntitlementServerSide } from '@/services/userEntitlement.server';
import { SERMON_SECTIONS } from '@/types/audioGeneration.types';
import { newClientId } from '@/utils/clientId';
import { matchesPreparedAudioVersion, PreparedAudioChanged, preparedAudioVersion, replacePreparedAudioSections, readPreparedAudioSources, type PreparedAudioFields } from '@/utils/preparedAudioSources';
import { normalizeScriptureReferencesForTts } from '@/utils/scriptureReferenceNormalizer';
import { chunksChangedResponse } from '@/utils/server/audioChunksChanged.server';
import { GOOGLE_TTS_MAX_CHUNK_SIZE, splitGoogleTextForGeneration } from '@/utils/server/googleTtsChunking';

import type { DocumentData } from '@/data-engine/types';
import type { Sermon } from '@/models/models';
import type { UsageAdmission } from '@/services/usageLimits.server';
import type { AudioChunk, AudioSourceMode, PreparedAudioSet, SectionSelection } from '@/types/audioGeneration.types';

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
    let targetMode: AudioSourceMode = 'ai';
    try {
        const uid = await getRequiredAuthenticatedUid(request);
        if (!uid) {
            return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
        }

        const { id: sermonId } = await params;

        // 1. Load sermon
        const sermonDoc = await adminDb.collection('sermons').doc(sermonId).get();
        if (!sermonDoc.exists) {
            return NextResponse.json({ error: 'Sermon not found' }, { status: 404 });
        }
        const sermon = { id: sermonDoc.id, ...sermonDoc.data() } as Sermon;

        if (sermon.userId !== uid) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();
        const requestedSections: SectionSelection | string[] = body.sections ?? 'all';
        const provider = body.provider === 'google' ? 'google' : 'openai';
        // "Use as-is" mode: skip GPT rewrite, voice the exact sermon text and only
        // split it mechanically into TTS-sized chunks.
        const useRawText = body.useRawText === true;
        targetMode = useRawText ? 'raw' : 'ai';
        const started = readPreparedAudioSources(sermon)[targetMode];
        if (body.source !== undefined && !matchesPreparedAudioVersion(started, body.source)) return chunksChangedResponse(sermon as unknown as Record<string, unknown>, targetMode);
        const preparationId = newClientId();


        // Default to true for backward compatibility
        const saveToDb = body.saveToDb !== false;
        if (saveToDb) assertServerWritable(sermon as unknown as Record<string, unknown>, 'sermons');

        // 2. Prepare Segments based on Outline & Thoughts
        // `sections` may be 'all', a single section key, or an array of keys (checkboxes).
        const resolved = resolveSections(requestedSections);
        const sectionsToProcess: SectionKey[] = resolved.length > 0 ? resolved : (SERMON_SECTIONS as SectionKey[]);

        const built = await prepareSpeechChunks(sermon, sectionsToProcess, provider, useRawText, uid);
        const totalOriginalLength = built.originalLength;
        const totalOptimizedLength = built.optimizedLength;

        // The initial projection is also used for an unsaved preview; saved writes use the latest document.
        const replacement = { id: preparationId, sections: sectionsToProcess, chunks: built.chunks };
        const prepared = saveToDb
            ? await savePreparedReplacement(uid, sermonId, targetMode, started, replacement)
            : replacePreparedAudioSections(sermon, targetMode, started, replacement);
        const allChunks = prepared.audioChunks;
        const acceptedSources = saveToDb ? prepared.audioSources : readPreparedAudioSources(sermon);

        return NextResponse.json({
            success: true,
            mode: targetMode, sources: acceptedSources,
            ...(saveToDb && acceptedSources[targetMode] ? { source: preparedAudioVersion(acceptedSources[targetMode]!) } : {}),
            chunks: allChunks.map((c, i) => ({
                index: i,
                sectionId: c.sectionId,
                text: c.text,
                // The stored chunk's own stamp: a wizard that writes this set back must send what is stored.
                createdAt: c.createdAt,
                kind: c.kind ?? 'body',
                role: c.role,
                preview: c.text.slice(0, 150) + '...',
            })),
            totalChunks: allChunks.length,
            originalLength: totalOriginalLength,
            optimizedLength: totalOptimizedLength,
        });

    } catch (error) {
        if (error instanceof PreparedAudioChanged) return chunksChangedResponse({ audioSources: error.sources }, error.mode);
        console.error('Optimize error:', error);
        if (isUsageCapReachedError(error)) return usageCapResponse(error);
        return legacyBoundaryResponse(error) ?? serverEditResponse(error) ?? NextResponse.json(
            { error: error instanceof Error ? error.message : 'Optimization failed' },
            { status: 500 }
        );
    }
}

// ============================================================================
// Helpers
// ============================================================================

async function prepareSpeechChunks(
    sermon: Sermon, sectionsToProcess: SectionKey[], provider: 'google' | 'openai', useRawText: boolean, uid: string,
): Promise<{ chunks: AudioChunk[]; originalLength: number; optimizedLength: number }> {
    const segments: GenerationSegment[] = buildGenerationSegments(sermon, sectionsToProcess);
    const usageAdmission = useRawText ? undefined : createUsageAdmission(uid, await getUserEntitlementServerSide(uid), ['ai'], new Date());

    // 3. Sequential Generation Loop with Context

    console.log(`[OptimizeAPI] Starting generation for ${segments.length} segments.`);

    // Build the sermon body chunks grouped per segment, so spoken transitions can
    // be woven BETWEEN the parts (intro → part → bridge → part → … → outro).
    const built = (useRawText && provider === 'google')
        ? buildGoogleRawSegmentBodies(sermon, sectionsToProcess)
        : await buildSegmentBodies(segments, sermon, provider, useRawText, uid, usageAdmission);

    // Generate spoken connective tissue so the narration's structure is audible.
    // Additive layer: ordinary provider failures return empty transitions, while a
    // usage-cap error must propagate so quota enforcement cannot disappear.
    const now = new Date().toISOString();
    // Continuation runs (a point resuming after a sub-point) carry body but get NO
    // spoken lead-in, so they're excluded from the parts we ask the model to bridge.
    const transitionSegments: TransitionSegment[] = built.segmentBodies
        .filter(s => s.bodyChunks.length > 0 && s.level !== 'continuation')
        .map(({ id, section, title, level }) => ({ id, section, title, level: level as 'point' | 'subpoint' }));
    const transitions = useRawText ? EMPTY_TRANSITIONS : await generateSermonTransitions(
        sermon,
        transitionSegments,
        uid,
        usageAdmission
    );
    console.log(`[OptimizeAPI] Transitions: intro=${transitions.intro ? 'yes' : 'no'}, bridges=${Object.keys(transitions.bridges).length}, outro=${transitions.outro ? 'yes' : 'no'}`);

    // Only emit the global opening/closing when their home sections are in scope
    // (a partial re-optimize of just the main part shouldn't inject a fresh intro).
    const woven = weaveTransitionChunks(built.segmentBodies, transitions, now, {
        includeIntro: sectionsToProcess.includes('introduction'),
        includeOutro: sectionsToProcess.includes('conclusion'),
    });

    return { chunks: woven, originalLength: built.originalLength, optimizedLength: built.optimizedLength };
}

async function savePreparedReplacement(
    uid: string, sermonId: string, mode: AudioSourceMode, opening: PreparedAudioSet | undefined,
    replacement: { id: string; sections: SectionKey[]; chunks: AudioChunk[] },
): Promise<PreparedAudioFields> {
    let written: PreparedAudioFields | undefined;
    const mutate = (current: DocumentData): DocumentData => {
        if (current.userId !== uid) throw new ServerEditError('permission-denied', 403);
        written = replacePreparedAudioSections(current, mode, opening, replacement);
        written.audioMetadata.lastOptimized = new Date().toISOString();
        return { ...current, ...written } as unknown as DocumentData;
    };
    const accepted = await writeOwnedDocument({
        owner: uid, resource: { collection: 'sermons', id: sermonId },
        legacy: () => mutateLegacyResource({ collection: 'sermons', id: sermonId }, current => {
            if (!current) throw new ServerEditError('not-found', 404);
            const next = mutate(current);
            return { audioChunks: next.audioChunks, audioMetadata: next.audioMetadata, audioSources: next.audioSources };
        }),
        engine: mutate,
    });
    if (accepted) {
        const sources = readPreparedAudioSources(accepted), source = sources[mode];
        if (source && written) return { ...written, audioSources: sources, audioChunks: source.chunks };
    }
    if (!written) throw new ServerEditError('not-found', 404);
    return written;
}

/**
 * Google "use as-is" path: voice the exact section text, using the reversible
 * quality-chunk rollout (or the intact request-limit splitter when disabled).
 * One segment per major section (Google raw has no per-point outline granularity).
 */
function buildGoogleRawSegmentBodies(
    sermon: Sermon,
    sectionsToProcess: SectionKey[]
): SegmentBuildResult {
    const segmentBodies: (SegmentBody & { title: string; level: 'point' | 'subpoint' | 'continuation' })[] = [];
    let originalLength = 0;
    let optimizedLength = 0;

    const chunkingMode = GOOGLE_SMALL_CHUNKING
        ? `even ~${EVEN_SPLIT_IDEAL_SIZE}-character quality chunks`
        : `legacy max ${GOOGLE_TTS_MAX_CHUNK_SIZE} chars/request`;
    console.log(`[OptimizeAPI] Preparing Google raw text by major section (${chunkingMode}).`);
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
            bodyChunks: createAudioChunks(splitGoogleTextForGeneration(rawText), section),
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
    useRawText: boolean,
    userId: string,
    usageAdmission: UsageAdmission | undefined
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
                },
                userId,
                usageAdmission
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
