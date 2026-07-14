import en from '../../locales/en/translation.json';
import ru from '../../locales/ru/translation.json';
import uk from '../../locales/uk/translation.json';

describe('admin model-default translations', () => {
  it.each([
    ['en', en],
    ['ru', ru],
    ['uk', uk],
  ])('provides the complete admin.modelDefaults tree in %s', (_locale, translation) => {
    expect(translation.admin.modelDefaults).toEqual(expect.objectContaining({
      title: expect.any(String),
      description: expect.any(String),
      nav: {
        users: expect.any(String),
        modelDefaults: expect.any(String),
      },
      provider: expect.any(String),
      model: expect.any(String),
      price: expect.any(String),
      functions: {
        transcription: expect.any(String),
        text: expect.any(String),
        tts: expect.any(String),
      },
      loading: expect.any(String),
      loadFailed: expect.any(String),
      save: expect.any(String),
      saving: expect.any(String),
      success: expect.any(String),
      saveFailed: expect.any(String),
    }));
  });

  it('uses the required Russian title', () => {
    expect(ru.admin.modelDefaults.title).toBe('Модели по умолчанию');
  });

  it.each([
    ['en', en],
    ['ru', ru],
    ['uk', uk],
  ])('provides tier-aware audio model selector copy in %s', (_locale, translation) => {
    expect(translation.audioExport).toEqual(expect.objectContaining({
      modelsLoading: expect.any(String),
      modelsLoadError: expect.any(String),
      freeModelLocked: expect.any(String),
      openaiModelDesc: expect.any(String),
      voiceAsh: expect.any(String),
      voiceWarm: expect.any(String),
    }));
  });
});
