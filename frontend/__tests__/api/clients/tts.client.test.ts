import { TextEncoder } from 'util';

import OpenAI from 'openai';

import {
  createAudioChunks,
  estimateDuration,
  generateAllChunksAudio,
  generateChunkAudio,
  getTTSModel,
  splitTextIntoChunks,
} from '@/api/clients/tts.client';

jest.mock('openai', () => {
  const mockSpeechCreate = jest.fn();

  const MockOpenAI = jest.fn().mockImplementation(() => ({
    audio: {
      speech: {
        create: mockSpeechCreate,
      },
    },
  }));

  (MockOpenAI as unknown as { mockSpeechCreate: jest.Mock }).mockSpeechCreate = mockSpeechCreate;

  return {
    __esModule: true,
    default: MockOpenAI,
  };
});

const getMockSpeechCreate = () =>
  (OpenAI as unknown as { mockSpeechCreate: jest.Mock }).mockSpeechCreate;

const createSpeechResponse = (content: string) => ({
  arrayBuffer: jest.fn().mockResolvedValue(new TextEncoder().encode(content).slice().buffer),
});

describe('tts client', () => {
  let mockSpeechCreate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSpeechCreate = getMockSpeechCreate();
    mockSpeechCreate.mockReset();
  });

  it('generates chunk audio with default wav format and estimated duration', async () => {
    mockSpeechCreate.mockResolvedValueOnce(createSpeechResponse('audio-bytes'));

    const result = await generateChunkAudio('one two three four five', {
      voice: 'onyx',
      model: 'gpt-4o-mini-tts',
    });

    expect(mockSpeechCreate).toHaveBeenCalledWith({
      model: 'gpt-4o-mini-tts',
      voice: 'onyx',
      input: 'one two three four five',
      response_format: 'wav',
    });
    expect(result.index).toBe(0);
    expect(result.audioBlob).toBeInstanceOf(Blob);
    expect(result.audioBlob.type).toBe('audio/wav');
    expect(result.durationSeconds).toBe(2);
  });

  it('passes through explicit response format', async () => {
    mockSpeechCreate.mockResolvedValueOnce(createSpeechResponse('mp3-audio'));

    await generateChunkAudio('short text', {
      voice: 'echo',
      model: 'custom-model',
      format: 'mp3',
    });

    expect(mockSpeechCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: 'mp3',
      })
    );
  });

  it('rejects text longer than the OpenAI chunk limit', async () => {
    await expect(
      generateChunkAudio('x'.repeat(4097), {
        voice: 'onyx',
        model: 'gpt-4o-mini-tts',
      })
    ).rejects.toThrow('Text exceeds maximum length of 4096 characters');

    expect(mockSpeechCreate).not.toHaveBeenCalled();
  });

  it('generates all chunk audio in order and emits progress updates', async () => {
    mockSpeechCreate
      .mockResolvedValueOnce(createSpeechResponse('chunk-1'))
      .mockResolvedValueOnce(createSpeechResponse('chunk-2'));

    const onProgress = jest.fn();
    const blobs = await generateAllChunksAudio(
      [
        { text: 'first chunk', sectionId: 'mainPart', createdAt: '2026-02-27T00:00:00.000Z', index: 0 },
        { text: 'second chunk', sectionId: 'mainPart', createdAt: '2026-02-27T00:00:00.000Z', index: 1 },
      ],
      {
        voice: 'onyx',
        model: 'gpt-4o-mini-tts',
      },
      onProgress
    );

    expect(blobs).toHaveLength(2);
    expect(onProgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        step: 'generating',
        percent: 55,
        currentChunk: 1,
        totalChunks: 2,
      })
    );
    expect(onProgress).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        step: 'generating',
        percent: 80,
        currentChunk: 2,
        totalChunks: 2,
      })
    );
  });

  it('supports generation without a progress callback', async () => {
    mockSpeechCreate.mockResolvedValueOnce(createSpeechResponse('single-chunk'));

    const blobs = await generateAllChunksAudio(
      [
        { text: 'single chunk', sectionId: 'mainPart', createdAt: '2026-02-27T00:00:00.000Z', index: 0 },
      ],
      {
        voice: 'onyx',
        model: 'gpt-4o-mini-tts',
      }
    );

    expect(blobs).toHaveLength(1);
  });

  it('returns a single chunk when text is already within the max size', () => {
    expect(splitTextIntoChunks('short text', 100)).toEqual(['short text']);
  });

  it('splits long paragraphs on sentence boundaries when possible', () => {
    const text = [
      'Sentence one is short. Sentence two is also short.',
      'Paragraph two should be kept separate.',
    ].join('\n\n');

    const chunks = splitTextIntoChunks(text, 35);

    expect(chunks).toEqual([
      'Sentence one is short.',
      'Sentence two is also short.',
      'Paragraph two should be kept',
      'separate.',
    ]);
  });

  it('splits oversized sentences by words', () => {
    const text = 'alpha beta gamma delta epsilon zeta eta theta';

    const chunks = splitTextIntoChunks(text, 12);

    expect(chunks).toEqual([
      'alpha beta',
      'gamma delta',
      'epsilon zeta',
      'eta theta',
    ]);
    expect(chunks.every(chunk => chunk.length <= 12)).toBe(true);
  });

  it('creates audio chunk metadata and maps all-section exports to mainPart', () => {
    const allChunks = createAudioChunks(['First', 'Second'], 'all');
    const introChunks = createAudioChunks(['Intro'], 'introduction');

    expect(allChunks).toHaveLength(2);
    expect(allChunks[0]).toEqual(
      expect.objectContaining({
        text: 'First',
        sectionId: 'mainPart',
        index: 0,
        createdAt: expect.any(String),
      })
    );
    expect(allChunks[1]).toEqual(expect.objectContaining({ index: 1 }));
    expect(introChunks[0]).toEqual(expect.objectContaining({ sectionId: 'introduction' }));
  });

  it('estimates duration and resolves quality-to-model mapping', () => {
    expect(estimateDuration('one two three four five six seven eight nine ten')).toBe(4);
    expect(getTTSModel('standard')).toBe('gpt-4o-mini-tts');
    expect(getTTSModel('hd')).toBe('tts-1');
  });
});
