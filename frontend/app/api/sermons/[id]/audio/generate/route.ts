/**
 * Generate TTS API Route
 * 
 * POST /api/sermons/[id]/audio/generate
 * 
 * Step 3 of step-by-step audio generation:
 * Streams real-time progress updates and generates audio.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { isFunctionCatalogTarget } from '@/api/clients/ai/functionCatalog';
import { resolveUserTtsTarget } from '@/api/clients/ai/tierPolicy';
import { generateChunkAudio } from '@/api/clients/tts.client';
import { resolveSections } from '@/api/services/sermonTextService';
import { GOOGLE_SMALL_CHUNKING } from '@/config/audioGeneration';
import { adminDb } from '@/config/firebaseAdminConfig';
import { assertAiUsageAvailable, consumeAiUsage, consumeAudioSeconds } from '@/services/usageLimits.server';
import { getUserEntitlementServerSide, resolveEffectiveTier } from '@/services/userEntitlement.server';
import { SERMON_SECTIONS, GOOGLE_TTS_VOICES } from '@/types/audioGeneration.types';
import { concatenateAudioBlobs, createSilenceBlob } from '@/utils/audioConcat';
import { normalizeScriptureReferencesForTts } from '@/utils/scriptureReferenceNormalizer';
import { getMeteredAudioDurationSeconds } from '@/utils/server/audioDurationMetering.server';
import { GOOGLE_TTS_MAX_CHUNK_SIZE, splitGoogleTextForGeneration } from '@/utils/server/googleTtsChunking';

import type { Sermon } from '@/models/models';
import type {
    AudioChunk,
    TTSVoice,
    AudioQuality,
    TTSProvider,
    GoogleTTSVoice,
} from '@/types/audioGeneration.types';

// ============================================================================
// Types
// ============================================================================

type ProgressEvent = {
    type: 'progress';
    current?: number;
    total?: number;
    percent: number;
    status: string;
};

type CompleteEvent = {
    type: 'complete';
    audioUrl: string;
    filename: string;
};

type AudioChunkEvent = {
    type: 'audio_chunk';
    data: string;
};

type DownloadCompleteEvent = {
    type: 'download_complete';
    filename: string;
    audioUrl: string;
    mimeType?: string;
    totalChunks?: number;
};

type ErrorEvent = {
    type: 'error';
    message: string;
};

type StreamEvent = ProgressEvent | CompleteEvent | ErrorEvent | AudioChunkEvent | DownloadCompleteEvent;

const isUsageExhaustedError = (error: unknown): error is Error =>
    error instanceof Error
    && (error as Error & { code?: string }).code === 'USAGE_EXHAUSTED';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sends a JSON event to the stream
 * Safely checks if controller is still open before enqueueing
 */
function sendEvent(controller: ReadableStreamDefaultController, event: StreamEvent) {
    try {
        const encoder = new TextEncoder();
        const data = JSON.stringify(event) + '\n';
        controller.enqueue(encoder.encode(data));
    } catch {
        // Controller already closed (user aborted)
        console.log('[TTS] Stream closed, skipping event:', event.type);
    }
}

const SECTION_ORDER = SERMON_SECTIONS;
const GOOGLE_TTS_SAMPLE_RATE = 24000;
const GOOGLE_TTS_CHANNELS = 1;
const GOOGLE_SECTION_PAUSE_MS = 700;
const GOOGLE_TTS_MODEL_25_KEY = 'gemini-2.5-flash-preview-tts';
const GOOGLE_TTS_MODEL_31_KEY = 'gemini-3.1-flash-tts-preview';
const GOOGLE_TTS_MODEL_25_CATALOG = 'gemini-2.5-flash-tts';
const GOOGLE_TTS_MODEL_31_CATALOG = 'gemini-3.1-flash-tts';
const OPENAI_TTS_VOICES: readonly TTSVoice[] = ['onyx', 'echo', 'ash'];
const TTS_CHUNK_ATTEMPTS = 2;
const TTS_CHUNK_RETRY_BACKOFF_MS = 100;

function groupChunksByMajorSection(chunks: AudioChunk[]): AudioChunk[] {
    const now = new Date().toISOString();
    return SECTION_ORDER.flatMap((sectionId) => {
        const text = chunks
            .filter(chunk => chunk.sectionId === sectionId)
            .map(chunk => chunk.text.trim())
            .filter(Boolean)
            .join('\n\n');

        if (!text) return [];
        return splitGoogleTextForGeneration(text).map(part => ({ text: part, sectionId, createdAt: now, index: 0 }));
    }).map((chunk, index) => ({ ...chunk, index }));
}

function getConfiguredGoogleModel25(): string {
    return process.env.GEMINI_AUDIO_2_5_TTS || GOOGLE_TTS_MODEL_25_KEY;
}

function getConfiguredGoogleModel31(): string {
    return process.env.GEMINI_AUDIO_3_1_TTS || GOOGLE_TTS_MODEL_31_KEY;
}

function getGoogleModel(model: string): string {
    const model25 = getConfiguredGoogleModel25();
    const model31 = getConfiguredGoogleModel31();
    if (model === GOOGLE_TTS_MODEL_31_CATALOG) return model31;
    if (model === GOOGLE_TTS_MODEL_25_CATALOG) return model25;
    throw new Error(`Unsupported Google TTS model: ${model}`);
}

function getValidatedVoice(
    provider: TTSProvider,
    voice: unknown
): TTSVoice | GoogleTTSVoice | null {
    if (voice === undefined || voice === null || voice === '') {
        return provider === 'google' ? 'Puck' : 'onyx';
    }
    if (typeof voice !== 'string') return null;
    if (provider === 'google') {
        return GOOGLE_TTS_VOICES.some(option => option.id === voice)
            ? voice as GoogleTTSVoice
            : null;
    }
    return OPENAI_TTS_VOICES.includes(voice as TTSVoice)
        ? voice as TTSVoice
        : null;
}

function insertGoogleSectionPauses(
    blobs: Blob[],
    chunks: AudioChunk[],
    nextChunkAfterBatch?: AudioChunk
): Blob[] {
    if (blobs.length === 0) return blobs;

    const result: Blob[] = [];
    let silenceBlob: Blob | null = null;

    const getSilenceBlob = () => {
        silenceBlob ??= createSilenceBlob(
            GOOGLE_SECTION_PAUSE_MS,
            GOOGLE_TTS_SAMPLE_RATE,
            GOOGLE_TTS_CHANNELS
        );
        return silenceBlob;
    };

    blobs.forEach((blob, index) => {
        result.push(blob);
        const nextChunk = chunks[index + 1] ?? (index === blobs.length - 1 ? nextChunkAfterBatch : undefined);
        if (nextChunk && nextChunk.sectionId !== chunks[index]?.sectionId) {
            result.push(getSilenceBlob());
        }
    });

    return result;
}

async function generateChunkAudioWithRetry(
    text: string,
    options: Parameters<typeof generateChunkAudio>[1]
): Promise<Awaited<ReturnType<typeof generateChunkAudio>>> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= TTS_CHUNK_ATTEMPTS; attempt++) {
        try {
            return await generateChunkAudio(text, options);
        } catch (error) {
            lastError = error;
            if (attempt === TTS_CHUNK_ATTEMPTS) break;
            console.warn(`[TTS] Chunk attempt ${attempt}/${TTS_CHUNK_ATTEMPTS} failed; retrying...`, error);
            await new Promise(resolve => setTimeout(resolve, TTS_CHUNK_RETRY_BACKOFF_MS));
        }
    }

    throw lastError;
}

/**
 * Reads the optional batch window from the request body. The browser drives
 * several sub-60s requests, each asking for a slice [offset, offset+limit) of the
 * chunk list; absent/invalid values mean "whole set".
 */
function resolveBatchWindow(body: { offset?: unknown; limit?: unknown }): { offset: number; limit?: number } {
    const offset = Number.isInteger(body.offset) ? Math.max(0, body.offset as number) : 0;
    const limit = Number.isInteger(body.limit) && (body.limit as number) > 0 ? (body.limit as number) : undefined;
    return { offset, limit };
}

// ============================================================================
// Route Handler
// ============================================================================

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
    try {
        const uid = await getRequiredAuthenticatedUid(request);
        if (!uid) {
            return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
        }

        const { id: sermonId } = await params;

        // 1. Load sermon with chunks
        const sermonDoc = await adminDb.collection('sermons').doc(sermonId).get();
        if (!sermonDoc.exists) {
            return NextResponse.json({ error: 'Sermon not found' }, { status: 404 });
        }
        const sermon = { id: sermonDoc.id, ...sermonDoc.data() } as Sermon;

        // Verify ownership
        if (sermon.userId !== uid) {
            return NextResponse.json({ error: 'Forbidden: You do not own this sermon' }, { status: 403 });
        }

        const body = await request.json();
        const sections: string | string[] = body.sections ?? 'all'; // 'all' | section key | array of keys

        const usageNow = new Date();
        const entitlement = await getUserEntitlementServerSide(uid, { includeModelPreferences: true });
        const resolvedTarget = await resolveUserTtsTarget(
            entitlement,
            entitlement.preferredTts,
            usageNow
        );
        const provider: TTSProvider | null = body.provider === 'google'
            ? 'google'
            : body.provider === 'openai'
                ? 'openai'
                : null;
        const requestedTarget = provider && typeof body.model === 'string'
            ? {
                providerId: provider === 'google' ? 'gemini' as const : 'openai' as const,
                modelId: body.model,
            }
            : null;
        const targetAllowed = requestedTarget && (
            resolveEffectiveTier(entitlement, usageNow) === 'free'
                ? requestedTarget.providerId === resolvedTarget.providerId
                    && requestedTarget.modelId === resolvedTarget.modelId
                : isFunctionCatalogTarget('tts', requestedTarget)
        );
        if (!provider || !requestedTarget || !targetAllowed) {
            return NextResponse.json(
                { error: 'Requested TTS provider/model is not allowed for this plan' },
                { status: 400 }
            );
        }

        const voice = getValidatedVoice(provider, body.voice);
        if (!voice) {
            return NextResponse.json(
                { error: `Voice ${String(body.voice)} is not available for ${provider}/${requestedTarget.modelId}` },
                { status: 400 }
            );
        }
        const quality: AudioQuality = body.quality === 'hd' ? 'hd' : 'standard';
        const selectedModel = provider === 'google'
            ? getGoogleModel(requestedTarget.modelId)
            : requestedTarget.modelId;

        console.log(`[TTS] Starting audio generation for sermon ${sermonId}`);
        console.log(`[TTS] Settings: provider=${provider}, voice=${voice}, catalogModel=${requestedTarget.modelId}, runtimeModel=${selectedModel}, quality=${quality}, sections=${sections}`);

        // 2. Check for saved chunks
        let chunks = (sermon.audioChunks || []) as AudioChunk[];
        if (chunks.length === 0) {
            return NextResponse.json(
                { error: 'No saved chunks. Run optimize step first.' },
                { status: 400 }
            );
        }

        // 3. Filter chunks by selected sections. Always filter (even 'all') so the
        //    "no chunks found" guard runs; an empty/invalid selection is a 400.
        const sectionList = resolveSections(sections);
        if (sectionList.length === 0) {
            return NextResponse.json({ error: 'No valid sections selected' }, { status: 400 });
        }
        {
            const selected = new Set<string>(sectionList);
            const originalCount = chunks.length;
            chunks = chunks.filter(chunk => selected.has(chunk.sectionId));
            console.log(`[TTS] Filtered chunks: ${originalCount} → ${chunks.length} (sections: ${sectionList.join(', ')})`);
            if (chunks.length === 0) {
                return NextResponse.json(
                    { error: `No chunks found for sections: ${sectionList.join(', ')}` },
                    { status: 400 }
                );
            }
        }

        chunks = chunks.map(chunk => ({
            ...chunk,
            text: normalizeScriptureReferencesForTts(chunk.text),
        }));

        const baseChunksForGeneration = provider === 'google' ? groupChunksByMajorSection(chunks) : chunks;

        // Batched generation: the browser drives several sub-60s requests, each
        // generating a slice [offset, offset+limit) of the section-filtered chunk
        // list, then byte-concatenates the returned MP3 streams client-side. Without
        // offset/limit → whole set (back-compat). Google participates only while
        // the reversible small-chunk rollout is enabled; flag OFF preserves its
        // legacy whole-section, single-request behavior exactly.
        const { offset: batchOffset, limit: batchLimit } = resolveBatchWindow(body);
        const isBatched = batchLimit !== undefined && (
            provider !== 'google' || GOOGLE_SMALL_CHUNKING
        );
        const chunksForGeneration = isBatched
            ? baseChunksForGeneration.slice(batchOffset, batchOffset + batchLimit)
            : baseChunksForGeneration;
        const batchEndOffset = isBatched
            ? Math.min(baseChunksForGeneration.length, batchOffset + (batchLimit as number))
            : baseChunksForGeneration.length;
        const nextChunkAfterBatch = isBatched
            ? baseChunksForGeneration[batchEndOffset]
            : undefined;

        if (chunksForGeneration.length === 0) {
            return NextResponse.json(
                { error: 'No chunks available for generation.' },
                { status: 400 }
            );
        }

        assertAiUsageAvailable(entitlement, usageNow);

        if (provider === 'google') {
            const chunkingMode = GOOGLE_SMALL_CHUNKING ? 'even quality chunks' : `legacy max ${GOOGLE_TTS_MAX_CHUNK_SIZE} chars/request`;
            console.log(`[TTS] Google grouping: ${chunks.length} prepared chunks → ${baseChunksForGeneration.length} request chunks (${chunkingMode})`);
        }
        if (isBatched) {
            console.log(`[TTS] Batch slice: offset=${batchOffset}, limit=${batchLimit} → ${chunksForGeneration.length}/${baseChunksForGeneration.length} chunks`);
        }
        console.log(`[TTS] Processing ${chunksForGeneration.length} ${provider === 'google' ? 'Google request chunks' : 'chunks'}`);

        // 3. Create streaming response
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    const total = chunksForGeneration.length;

                    // Phase 1: Generate TTS for each chunk IN PARALLEL (0-80%)
                    // Serial generation blew past Vercel's function limit: one full chunk
                    // takes ~32s, so a 6-chunk sermon ran ~190s and was killed at the 60s
                    // cap. A bounded-concurrency pool keeps wall time near a single chunk
                    // while respecting OpenAI rate limits and preserving chunk order for
                    // concatenation (generatedChunks is index-addressed, not push-ordered).
                    const ttsOptions = {
                        provider,
                        voice,
                        model: selectedModel,
                        format: provider === 'google' ? 'wav' as const : 'mp3' as const,
                    };

                    const TTS_CONCURRENCY = provider === 'google' ? 1 : 6;
                    const generatedChunks: Array<{
                        blob: Blob;
                        chunk: AudioChunk;
                        index: number;
                        mimeType: string;
                    } | undefined> = new Array(chunksForGeneration.length);
                    let completed = 0;
                    let cursor = 0;

                    const worker = async () => {
                        while (cursor < chunksForGeneration.length) {
                            const i = cursor++;
                            const chunk = chunksForGeneration[i];
                            const preview = chunk.text.substring(0, 60).replace(/\n/g, ' ');

                            console.log(`[TTS] Generating chunk ${i + 1}/${total}: "${preview}..."`);

                            try {
                                const result = await generateChunkAudioWithRetry(chunk.text, ttsOptions);
                                generatedChunks[i] = {
                                    blob: result.audioBlob,
                                    chunk,
                                    index: i,
                                    mimeType: result.mimeType || result.audioBlob.type || (
                                        provider === 'google' ? 'audio/wav' : 'audio/mpeg'
                                    ),
                                };
                            } catch (error) {
                                console.error(`[TTS] Chunk ${i + 1}/${total} failed:`, error);
                            }

                            completed++;
                            const percent = Math.round((completed / total) * 80);
                            sendEvent(controller, {
                                type: 'progress',
                                current: completed,
                                total,
                                percent,
                                status: `Generating chunk ${completed}/${total}...`,
                            });
                        }
                    };

                    await Promise.allSettled(
                        Array.from({ length: Math.min(TTS_CONCURRENCY, chunksForGeneration.length) }, worker)
                    );
                    const successfulChunks = generatedChunks.filter((result): result is NonNullable<typeof result> =>
                        result !== undefined
                    );
                    if (successfulChunks.length === 0) {
                        throw new Error('All TTS chunks failed');
                    }

                    const measuredDurations = await Promise.all(successfulChunks.map(({ blob, chunk, mimeType }) =>
                        getMeteredAudioDurationSeconds(blob, mimeType, chunk.text)
                    ));
                    const audioSeconds = measuredDurations.reduce((sum, seconds) => sum + seconds, 0);
                    await consumeAudioSeconds(uid, audioSeconds, usageNow);
                    if (!isBatched || batchOffset === 0) {
                        await consumeAiUsage(uid, usageNow);
                    }

                    const audioBlobs = successfulChunks.map(({ blob }) => blob);
                    const successfulAudioChunks = successfulChunks.map(({ chunk }) => chunk);

                    // Phase 2: Concatenate MP3 chunks (80-90%)
                    // MP3 frames are self-contained, so a plain byte-level concat plays
                    // back as one continuous file — no WAV header surgery, and the payload
                    // is ~10x smaller than WAV, which is what keeps a sermon under Vercel's
                    // function size/time limits.
                    console.log(`[TTS] Concatenating ${audioBlobs.length} ${provider === 'google' ? 'WAV' : 'MP3'} chunks...`);
                    audioBlobs.forEach((b, idx) => console.log(`[TTS] Blob ${idx}: ${b.size} bytes`));
                    sendEvent(controller, {
                        type: 'progress',
                        percent: 85,
                        status: 'Merging audio files...',
                    });

                    const finalMimeType = provider === 'google' ? 'audio/wav' : 'audio/mpeg';
                    const finalAudio = provider === 'google'
                        ? await concatenateAudioBlobs(insertGoogleSectionPauses(
                            audioBlobs,
                            successfulAudioChunks,
                            nextChunkAfterBatch
                        ))
                        : new Blob(audioBlobs, { type: finalMimeType });

                    // Phase 4: Convert to data URL and STREAM it
                    // NOTE: We convert the FULL buffer to Base64 first to avoid padding corruption.
                    // Slicing binary buffers at arbitrary points (not multiple of 3) causes Base64 
                    // padding '=' to appear in the middle of the stream, corrupting the file.

                    const arrayBuffer = await finalAudio.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);

                    console.log(`[TTS] Encoding Base64 (${buffer.length} bytes)...`);
                    const base64Full = buffer.toString('base64');

                    const sizeMB = base64Full.length / 1024 / 1024;
                    console.log(`[TTS] Base64 Stream Size: ${sizeMB.toFixed(2)} MB`);

                    sendEvent(controller, {
                        type: 'progress',
                        percent: 90,
                        status: 'Preparing download...',
                    });

                    // Chunk the STRING, not the BUFFER.
                    // 32KB chunks of text is safe for transport.
                    const CHUNK_SIZE = 32 * 1024;
                    const totalChunks = Math.ceil(base64Full.length / CHUNK_SIZE);

                    console.log(`[TTS] Streaming ${totalChunks} text chunks...`);

                    for (let i = 0; i < totalChunks; i++) {
                        // Check if client disconnected
                        if (request.signal.aborted) {
                            console.log('[TTS] Client disconnected, stopping stream.');
                            break;
                        }

                        const start = i * CHUNK_SIZE;
                        const end = start + CHUNK_SIZE;
                        const chunkData = base64Full.slice(start, end);

                        sendEvent(controller, {
                            type: 'audio_chunk',
                            data: chunkData
                        });

                        // Report progress every ~10%
                        if (totalChunks > 10 && i % Math.ceil(totalChunks / 10) === 0) {
                            const streamProgress = 90 + Math.floor((i / totalChunks) * 9);
                            sendEvent(controller, {
                                type: 'progress',
                                percent: streamProgress,
                                status: `Downloading audio... ${Math.round((i / totalChunks) * 100)}%`
                            });
                            // Allow event loop to breathe
                            await new Promise(r => setTimeout(r, 0));
                        }
                    }

                    // Generate filename
                    const safeFilename = sermon.title
                        .toLowerCase()
                        .replace(/[^a-zа-яё0-9\s]/gi, '')
                        .replace(/\s+/g, '-')
                        .slice(0, 50) + (provider === 'google' ? '-audio.wav' : '-audio.mp3');

                    // Update metadata once per generation (first batch only — later
                    // batches would just rewrite identical values).
                    if (batchOffset === 0) {
                        await adminDb.collection('sermons').doc(sermonId).update({
                            'audioMetadata.provider': provider,
                            'audioMetadata.voice': voice,
                            'audioMetadata.model': requestedTarget.modelId,
                            'audioMetadata.lastGenerated': new Date().toISOString(),
                        });
                    }

                    console.log('[TTS] Generation complete!');

                    // Send completion event (without the huge body)
                    sendEvent(controller, {
                        type: 'download_complete',
                        filename: safeFilename,
                        audioUrl: '', // Client reassembles it
                        mimeType: finalMimeType,
                        totalChunks: baseChunksForGeneration.length,
                    });

                    controller.close();
                } catch (error) {
                    console.error('[TTS] Generation error:', error);
                    sendEvent(controller, {
                        type: 'error',
                        message: `TTS generation failed with ${provider}/${requestedTarget.modelId}: ${error instanceof Error ? error.message : 'Generation failed'}`,
                    });
                    controller.close();
                }
            },
        });

        return new NextResponse(stream, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Transfer-Encoding': 'chunked',
                'X-Content-Type-Options': 'nosniff',
            },
        });
    } catch (error) {
        console.error('[TTS] Route error:', error);
        if (isUsageExhaustedError(error)) {
            return NextResponse.json(
                { error: error.message },
                { status: 429 }
            );
        }
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Generation failed' },
            { status: 500 }
        );
    }
}
