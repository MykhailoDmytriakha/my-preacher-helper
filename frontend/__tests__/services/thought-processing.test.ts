import { generateThoughtStructured } from '@/api/clients/thought.structured';

// Mock structured thought client
jest.mock('@/api/clients/thought.structured', () => ({
  generateThoughtStructured: jest.fn(),
}));

const mockGenerateThought = generateThoughtStructured as jest.MockedFunction<typeof generateThoughtStructured>;

describe('Thought Processing - Dictated Speech Artifacts', () => {
  const mockSermon = {
    id: 'test-sermon',
    title: 'Test Sermon',
    verse: 'John 3:16',
    thoughts: [],
    structure: { introduction: [], main: [], conclusion: [], ambiguous: [] },
    userId: 'test-user',
    date: '2023-01-01',
  };

  const availableTags = ['Вступление', 'Основная часть', 'Заключение'];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Self-corrections and revisions', () => {
    it('should preserve final version while maintaining emotional weight', async () => {
      const dictatedText = 'это важно... нет, даже очень важно для нашего понимания';
      const expectedFormatted = 'это даже очень важно для нашего понимания';

      mockGenerateThought.mockResolvedValue({
        originalText: dictatedText,
        formattedText: expectedFormatted,
        tags: ['Основная часть'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThoughtStructured(dictatedText, mockSermon, availableTags);

      expect(result.formattedText).toBe(expectedFormatted);
      expect(result.meaningSuccessfullyPreserved).toBe(true);
    });

    it('should handle multiple revisions in one sentence', async () => {
      const dictatedText = 'я думаю... нет, я уверен... точнее, я глубоко убежден, что это правильно';
      const expectedFormatted = 'я глубоко убежден, что это правильно';

      mockGenerateThought.mockResolvedValue({
        originalText: dictatedText,
        formattedText: expectedFormatted,
        tags: ['Основная часть'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThoughtStructured(dictatedText, mockSermon, availableTags);

      expect(result.formattedText).toBe(expectedFormatted);
    });
  });

  describe('Repetitions for emphasis', () => {
    it('should preserve intentional repetitions that show passion', async () => {
      const dictatedText = 'да, да, именно так нужно поступать';
      const expectedFormatted = 'да, да, именно так нужно поступать';

      mockGenerateThought.mockResolvedValue({
        originalText: dictatedText,
        formattedText: expectedFormatted,
        tags: ['Заключение'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThoughtStructured(dictatedText, mockSermon, availableTags);

      expect(result.formattedText).toBe(expectedFormatted);
    });

    it('should preserve rhetorical repetitions', async () => {
      const dictatedText = 'Бог есть любовь, любовь, любовь совершенная';
      const expectedFormatted = 'Бог есть любовь, любовь, любовь совершенная';

      mockGenerateThought.mockResolvedValue({
        originalText: dictatedText,
        formattedText: expectedFormatted,
        tags: ['Основная часть'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThoughtStructured(dictatedText, mockSermon, availableTags);

      expect(result.formattedText).toBe(expectedFormatted);
    });
  });

  describe('False starts and restarts', () => {
    it('should remove incomplete thoughts and false starts', async () => {
      const dictatedText = 'ну вот, я хотел сказать что... эээ... короче, суть в том, что нужно доверять Богу';
      const expectedFormatted = 'суть в том, что нужно доверять Богу';

      mockGenerateThought.mockResolvedValue({
        originalText: dictatedText,
        formattedText: expectedFormatted,
        tags: ['Основная часть'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThoughtStructured(dictatedText, mockSermon, availableTags);

      expect(result.formattedText).toBe(expectedFormatted);
    });

    it('should keep final complete thought after false starts', async () => {
      const dictatedText = 'когда мы... м-м-м... когда мы сталкиваемся с трудностями, важно помнить';
      const expectedFormatted = 'когда мы сталкиваемся с трудностями, важно помнить';

      mockGenerateThought.mockResolvedValue({
        originalText: dictatedText,
        formattedText: expectedFormatted,
        tags: ['Вступление'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThoughtStructured(dictatedText, mockSermon, availableTags);

      expect(result.formattedText).toBe(expectedFormatted);
    });
  });

  describe('Tangential thoughts', () => {
    it('should smoothly integrate or remove tangents while keeping main thread', async () => {
      const dictatedText = 'кстати, вспомнил про прошлую проповедь... но вернемся, сегодня мы говорим о доверии';
      const expectedFormatted = 'сегодня мы говорим о доверии';

      mockGenerateThought.mockResolvedValue({
        originalText: dictatedText,
        formattedText: expectedFormatted,
        tags: ['Вступление'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThoughtStructured(dictatedText, mockSermon, availableTags);

      expect(result.formattedText).toBe(expectedFormatted);
    });

    it('should handle transitions back to main topic', async () => {
      const dictatedText = 'как я уже говорил раньше... хотя сейчас не время углубляться, главное - это вера';
      const expectedFormatted = 'главное - это вера';

      mockGenerateThought.mockResolvedValue({
        originalText: dictatedText,
        formattedText: expectedFormatted,
        tags: ['Основная часть'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThoughtStructured(dictatedText, mockSermon, availableTags);

      expect(result.formattedText).toBe(expectedFormatted);
    });
  });

  describe('Filler words', () => {
    it('should remove filler words that do not serve rhetorical purpose', async () => {
      const dictatedText = 'ну, в общем, короче говоря, это типа очень важно';
      const expectedFormatted = 'это очень важно';

      mockGenerateThought.mockResolvedValue({
        originalText: dictatedText,
        formattedText: expectedFormatted,
        tags: ['Основная часть'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThoughtStructured(dictatedText, mockSermon, availableTags);

      expect(result.formattedText).toBe(expectedFormatted);
    });

    it('should preserve conversational style and personal touch', async () => {
      const dictatedText = 'братья и сестры, послушайте, это действительно важно для каждого из нас';
      const expectedFormatted = 'братья и сестры, послушайте, это действительно важно для каждого из нас';

      mockGenerateThought.mockResolvedValue({
        originalText: dictatedText,
        formattedText: expectedFormatted,
        tags: ['Вступление'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThoughtStructured(dictatedText, mockSermon, availableTags);

      expect(result.formattedText).toBe(expectedFormatted);
    });
  });

  describe('Stream of consciousness', () => {
    it('should convert rambling streams into coherent paragraphs while preserving conversational flow', async () => {
      const dictatedText = 'когда мы молимся, то есть, когда обращаемся к Богу, понимаете, через молитву, мы устанавливаем связь, ну вот так вот, с небесным Отцом';
      const expectedFormatted = 'когда мы молимся и обращаемся к Богу через молитву, мы устанавливаем связь с небесным Отцом';

      mockGenerateThought.mockResolvedValue({
        originalText: dictatedText,
        formattedText: expectedFormatted,
        tags: ['Основная часть'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThoughtStructured(dictatedText, mockSermon, availableTags);

      expect(result.formattedText).toBe(expectedFormatted);
    });

    it('should preserve personal touch and emotional elements', async () => {
      const dictatedText = 'я вот, знаете, каждый раз, когда читаю Писание, сердце просто загорается, понимаете, это живое слово';
      const expectedFormatted = 'я вот каждый раз, когда читаю Писание, сердце просто загорается - это живое слово';

      mockGenerateThought.mockResolvedValue({
        originalText: dictatedText,
        formattedText: expectedFormatted,
        tags: ['Вступление'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThoughtStructured(dictatedText, mockSermon, availableTags);

      expect(result.formattedText).toBe(expectedFormatted);
    });
  });

  describe('Preserving speaker personality', () => {
    it('should maintain unique voice and passion', async () => {
      const dictatedText = 'ребята, это же невероятно! понимаете? Бог сделал для нас невозможное!';
      const expectedFormatted = 'ребята, это же невероятно! понимаете? Бог сделал для нас невозможное!';

      mockGenerateThought.mockResolvedValue({
        originalText: dictatedText,
        formattedText: expectedFormatted,
        tags: ['Заключение'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThoughtStructured(dictatedText, mockSermon, availableTags);

      expect(result.formattedText).toBe(expectedFormatted);
    });

    it('should preserve rhetorical questions and emphasis', async () => {
      const dictatedText = 'а что если... подумайте, что если Бог действительно любит нас?';
      const expectedFormatted = 'а что если... подумайте, что если Бог действительно любит нас?';

      mockGenerateThought.mockResolvedValue({
        originalText: dictatedText,
        formattedText: expectedFormatted,
        tags: ['Основная часть'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThoughtStructured(dictatedText, mockSermon, availableTags);

      expect(result.formattedText).toBe(expectedFormatted);
    });
  });

  describe('Complex scenarios', () => {
    it('should handle multiple types of artifacts in one text', async () => {
      const dictatedText = 'ну вот, я хотел сказать что... эээ... короче, это очень важно... нет, критически важно для нас, братья и сестры, понимаете? да, да, именно так!';
      const expectedFormatted = 'это критически важно для нас, братья и сестры, понимаете? да, да, именно так!';

      mockGenerateThought.mockResolvedValue({
        originalText: dictatedText,
        formattedText: expectedFormatted,
        tags: ['Заключение'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThoughtStructured(dictatedText, mockSermon, availableTags);

      expect(result.formattedText).toBe(expectedFormatted);
    });

    it('should maintain theological accuracy while cleaning up speech patterns', async () => {
      const dictatedText = 'когда Иисус сказал... м-м-м... когда Он сказал "приидите ко Мне вси труждающиеся", это значит... ну, короче, это призыв к покаянию';
      const expectedFormatted = 'когда Иисус сказал: "приидите ко Мне вси труждающиеся", это призыв к покаянию';

      mockGenerateThought.mockResolvedValue({
        originalText: dictatedText,
        formattedText: expectedFormatted,
        tags: ['Основная часть'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThoughtStructured(dictatedText, mockSermon, availableTags);

      expect(result.formattedText).toBe(expectedFormatted);
    });

    it('should preserve biblical quotes with proper formatting and connecting words', async () => {
      const dictatedText = 'Посмотрите, этот стих заканчивается призывом. Итак, что ты, Петр, хочешь нам сказать? Он хочет показать нам пример, как Христос пострадал. То и вы, говорит, вооружитесь этой мыслью. Из всего этого нам нужно понять, нам нужно вооружиться, нам нужно приготовиться к тому, чтобы проходить страдания. Тому, чтобы жить по воле Божьей. Оставаться верными. Как в послании к евреям написано, будем проходить предлежащее нам поприще, взирая на начальника и совершителя веры.';
      const expectedFormatted = 'Посмотрите, этот стих заканчивается призывом. "Итак" - что ты, Петр, хочешь нам сказать? Он хочет показать нам пример, "как Христос пострадал, То и вы" - , говорит, "вооружитесь этой мыслью". Из всего этого нам нужно понять: нам нужно вооружиться, нам нужно приготовиться к тому, чтобы проходить страдания, чтобы жить по воле Божьей, и оставаться верными. Как в послании к евреям написано: "будем проходить предлежащее нам поприще, взирая на начальника и совершителя веры" (Евр. 12:2).';

      mockGenerateThought.mockResolvedValue({
        originalText: dictatedText,
        formattedText: expectedFormatted,
        tags: ['Основная часть'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThoughtStructured(dictatedText, mockSermon, availableTags);

      expect(result.formattedText).toBe(expectedFormatted);
    });
  });
});
