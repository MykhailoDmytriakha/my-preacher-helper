jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: { collection: jest.fn() },
}));

import { getFunctionDefault } from '@/api/clients/ai/functionCatalog';
import { adminDb } from '@/config/firebaseAdminConfig';
import { getAiModelDefaults, getAiModelDefaultsState } from '@/services/aiModelDefaults.server';

const mockGet = jest.fn();
const mockDoc = jest.fn(() => ({ get: mockGet }));
const mockCollection = adminDb.collection as jest.Mock;

describe('aiModelDefaults.server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCollection.mockReturnValue({ doc: mockDoc });
  });

  it('falls back independently to corrected catalog defaults when the document is absent', async () => {
    mockGet.mockResolvedValue({ exists: false, data: jest.fn() });

    await expect(getAiModelDefaults()).resolves.toEqual({
      transcription: expect.objectContaining({
        providerId: getFunctionDefault('transcription').providerId,
        modelId: getFunctionDefault('transcription').modelId,
      }),
      text: expect.objectContaining({
        providerId: getFunctionDefault('text').providerId,
        modelId: getFunctionDefault('text').modelId,
      }),
      tts: expect.objectContaining({
        providerId: getFunctionDefault('tts').providerId,
        modelId: getFunctionDefault('tts').modelId,
      }),
    });
    expect(mockCollection).toHaveBeenCalledWith('config');
    expect(mockDoc).toHaveBeenCalledWith('aiModelDefaults');
  });

  it('returns valid stored defaults and falls back for missing or invalid functions', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        text: { providerId: 'openrouter', modelId: 'deepseek/deepseek-v4-pro' },
        transcription: { providerId: 'openai', modelId: 'not-in-catalog' },
      }),
    });

    await expect(getAiModelDefaultsState()).resolves.toEqual({
      stored: {
        text: { providerId: 'openrouter', modelId: 'deepseek/deepseek-v4-pro' },
      },
      effective: {
        transcription: expect.objectContaining({
          providerId: getFunctionDefault('transcription').providerId,
          modelId: getFunctionDefault('transcription').modelId,
        }),
        text: { providerId: 'openrouter', modelId: 'deepseek/deepseek-v4-pro' },
        tts: expect.objectContaining({
          providerId: getFunctionDefault('tts').providerId,
          modelId: getFunctionDefault('tts').modelId,
        }),
      },
    });
  });
});
