import {
  aiFunctionIds,
  functionCatalog,
  getFunctionCatalog,
  getFunctionDefault,
} from '../functionCatalog';

describe('functionCatalog defaults', () => {
  it('uses the product order text -> transcription -> tts', () => {
    expect(aiFunctionIds).toEqual(['text', 'transcription', 'tts']);
  });

  it('has exactly one default per function', () => {
    for (const fn of aiFunctionIds) {
      expect(functionCatalog.filter((entry) => entry.fn === fn && entry.isDefault)).toHaveLength(1);
    }
  });

  it('provides a human-readable admin price for every catalog entry', () => {
    expect(functionCatalog.every((entry) => entry.priceLabel.length > 0)).toBe(true);
    expect(getFunctionCatalog('transcription').map((entry) => entry.priceLabel)).toEqual([
      '$0.006 / min',
      '$0.003 / min',
    ]);
    expect(getFunctionCatalog('tts').every((entry) => entry.priceLabel.includes('est.'))).toBe(true);
  });

  it('matches current production text and transcription models', () => {
    expect(getFunctionDefault('text')).toMatchObject({
      providerId: 'gemini',
      modelId: 'gemini-3.1-flash-lite-preview',
    });
    expect(getFunctionDefault('transcription')).toMatchObject({
      providerId: 'openai',
      modelId: 'gpt-4o-transcribe',
    });
  });

  it('contains only executable Google/OpenAI TTS targets', () => {
    expect(functionCatalog.filter(entry => entry.fn === 'tts').map(({ providerId, modelId, isDefault }) => ({
      providerId,
      modelId,
      isDefault,
    }))).toEqual([
      { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts', isDefault: true },
      { providerId: 'gemini', modelId: 'gemini-2.5-flash-tts', isDefault: false },
      { providerId: 'openai', modelId: 'gpt-4o-mini-tts', isDefault: false },
    ]);
    expect(getFunctionCatalog('tts').some(entry => entry.providerId === 'openrouter')).toBe(false);
  });
});
