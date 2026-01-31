/**
 * Generate TTS API Route
 * 
 * POST /api/sermons/[id]/audio/generate
 * 
 * Step 3 of step-by-step audio generation:
 * Streams real-time progress updates and generates audio.
 */

import { NextRequest, NextResponse } from 'next/server';

import { generateChunkAudio, getTTSModel } from '@/api/clients/tts.client';
import { adminDb } from '@/config/firebaseAdminConfig';
import { concatenateAudioBlobs, insertSilenceBetweenBlobs } from '@/utils/audioConcat';

import type { Sermon } from '@/models/models';
import type { AudioChunk, TTSVoice, AudioQuality } from '@/types/audioGeneration.types';

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
};

type ErrorEvent = {
    type: 'error';
    message: string;
};

type StreamEvent = ProgressEvent | CompleteEvent | ErrorEvent | AudioChunkEvent | DownloadCompleteEvent;

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
        const voice: TTSVoice = body.voice || 'onyx';
        const quality: AudioQuality = body.quality || 'standard';
        const sections: string = body.sections || 'all'; // 'all' | 'introduction' | 'mainPart' | 'conclusion'
        const userId = body.userId;

        if (!userId) {
            return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
        }

        console.log(`[TTS] Starting audio generation for sermon ${sermonId}`);
        console.log(`[TTS] Settings: voice=${voice}, quality=${quality}, sections=${sections}`);

        // 1. Load sermon with chunks
        const sermonDoc = await adminDb.collection('sermons').doc(sermonId).get();
        if (!sermonDoc.exists) {
            return NextResponse.json({ error: 'Sermon not found' }, { status: 404 });
        }
        const sermon = { id: sermonDoc.id, ...sermonDoc.data() } as Sermon;

        // Verify ownership
        if (sermon.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden: You do not own this sermon' }, { status: 403 });
        }

        // 2. Check for saved chunks
        let chunks = (sermon.audioChunks || []) as AudioChunk[];
        if (chunks.length === 0) {
            return NextResponse.json(
                { error: 'No saved chunks. Run optimize step first.' },
                { status: 400 }
            );
        }

        // 3. Filter chunks by selected sections
        if (sections !== 'all') {
            const originalCount = chunks.length;
            chunks = chunks.filter(chunk => chunk.sectionId === sections);
            console.log(`[TTS] Filtered chunks: ${originalCount} → ${chunks.length} (section: ${sections})`);

            if (chunks.length === 0) {
                return NextResponse.json(
                    { error: `No chunks found for section: ${sections}` },
                    { status: 400 }
                );
            }
        }

        console.log(`[TTS] Processing ${chunks.length} chunks`);

        // 3. Create streaming response
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    const total = chunks.length;
                    const audioBlobs: Blob[] = [];

                    // Phase 1: Generate TTS for each chunk (0-80%)
                    const ttsOptions = {
                        voice,
                        model: getTTSModel(quality),
                        format: 'wav' as const,
                    };

                    for (let i = 0; i < chunks.length; i++) {
                        const chunk = chunks[i];
                        const preview = chunk.text.substring(0, 60).replace(/\n/g, ' ');

                        console.log(`[TTS] Generating chunk ${i + 1}/${total}: "${preview}..."`);

                        // Generate audio
                        const result = await generateChunkAudio(chunk.text, ttsOptions);
                        audioBlobs.push(result.audioBlob);

                        // Send progress (distribute 0-80% across chunks)
                        const percent = Math.round(((i + 1) / total) * 80);
                        sendEvent(controller, {
                            type: 'progress',
                            current: i + 1,
                            total,
                            percent,
                            status: `Generating chunk ${i + 1}/${total}...`,
                        });
                    }

                    // Phase 2: Add silence between chunks (80-90%)
                    // Phase 2: Add silence between chunks (80-90%)
                    console.log(`[TTS] chunks generated. Adding silence (${audioBlobs.length} blobs)...`);
                    sendEvent(controller, {
                        type: 'progress',
                        percent: 82,
                        status: 'Adding pauses...',
                    });

                    // Log sizes for debugging
                    audioBlobs.forEach((b, idx) => console.log(`[TTS] Blob ${idx}: ${b.size} bytes`));

                    const withSilence = await insertSilenceBetweenBlobs(audioBlobs, 500);

                    // Phase 3: Concatenate all audio (90-100%)
                    console.log('[TTS] Concatenating audio files...');
                    sendEvent(controller, {
                        type: 'progress',
                        percent: 85,
                        status: 'Merging audio files...',
                    });

                    let finalAudio: Blob;
                    try {
                        finalAudio = await concatenateAudioBlobs(withSilence);
                    } catch (mergeError) {
                        console.error('[TTS] Merge error:', mergeError);
                        // Fallback: just take the first one or error out? 
                        // For now let's throw to see the error, but log it clearly
                        throw mergeError;
                    }

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
                        .slice(0, 50) + '-audio.wav';

                    // Update metadata
                    await adminDb.collection('sermons').doc(sermonId).update({
                        'audioMetadata.voice': voice,
                        'audioMetadata.model': getTTSModel(quality),
                        'audioMetadata.lastGenerated': new Date().toISOString(),
                    });

                    console.log('[TTS] Generation complete!');

                    // Send completion event (without the huge body)
                    sendEvent(controller, {
                        type: 'download_complete',
                        filename: safeFilename,
                        audioUrl: '', // Client reassembles it
                    });

                    controller.close();
                } catch (error) {
                    console.error('[TTS] Generation error:', error);
                    sendEvent(controller, {
                        type: 'error',
                        message: error instanceof Error ? error.message : 'Generation failed',
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
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Generation failed' },
            { status: 500 }
        );
    }
}
