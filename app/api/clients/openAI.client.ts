import OpenAI from 'openai';
import { Sermon, Thought } from '@/models/models';
import { log } from '@utils/logger';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const audioModel = process.env.OPENAI_AUDIO_MODEL as string;
const gptModel = process.env.OPENAI_GPT_MODEL as string;

export async function createTranscription(file: File): Promise<string> {
  log.info('createTranscription: Received file for transcription', file);
  const transcriptionResponse = await openai.audio.transcriptions.create({
    file,
    model: audioModel,
    response_format: "text",
  });
  log.info('createTranscription: Transcription response received', transcriptionResponse);
  return transcriptionResponse;
}

/**
 * Generate a Thought by sending the transcription to GPT and returning a structured response.
 * @param transcription Raw transcription text from Whisper
 * @param sermon The current sermon context (for reference)
 * @param availableTags List of tags that the user can actually use
 * @returns Thought object with text, tags, relevant, date
 */
export async function generateThought(
  transcription: string,
  sermon: Sermon,
  availableTags: string[]
): Promise<Thought> {
  try {
    const promptSystemMessage = `Анализируйте содержание проповеди и предоставленную транскрипцию.
Если транскрипция актуальна, верните транскрипцию на русском языке с минимальными исправлениями — исправьте только грамматические ошибки, пунктуацию и очевидные ошибки транскрипции, не перефразируя, не сокращая и не изменяя порядок идей.
Если транскрипция не актуальна, верните исходную транскрипцию без изменений.
Если транскрипция содержит ЛЮБЫЕ упоминания:
- библейских персонажей, событий или учений из проповеди
- прямые или косвенные ссылки на текст проповеди
- размышления, связанные с тематикой проповеди
то считайте её АКТУАЛЬНОЙ (relevant: true).

ВАЖНО:
- При малейшей связи с содержанием проповеди считайте контент актуальным
- Пример актуальной мысли: "По-видимому, Пётр после разговора с собирателем дидрахм пошёл домой..." для проповеди о Матфея 17:24-27
- Только полное отсутствие связи с тематикой проповеди помечайте как неактуальное
- Все библейские ссылки должны быть отформатированы в стандартном виде: "Сокр.Книга Глава:Стих". Например: "Рим. 14:20" вместо "Римлянам 14 глава 20 стих"
- Обязательно сохраняйте кавычки вокруг прямых цитат из Писания и речей
- Исправляйте распространённые ошибки:
  * "сынный свободный" → "сыны свободны"
  * "дидрахм" → "дидрахмы"
  * "Пётр" → "апостол Пётр" при первом упоминании
- При исправлении цитат строго сохраняйте оригинальную формулировку текста Синодального перевода
- Если в транскрипции есть частичная цитата (например, "чтобы их не соблазнить"), дополните её до полной цитаты в кавычках: "чтобы не соблазнить их"
- Ваш вывод должен быть единственным валидным JSON объектом с ровно тремя ключами: "text", "tags" и "relevant". Не включайте дополнительные ключи.
- "text": Исправленная транскрипция на русском языке.
- "tags": Массив строк, который должен содержать как минимум один основной тег ("Вступление", "Основная часть" или "Заключение"). Если транскрипция содержит рассказ или иллюстративный пример, добавьте тег "пример". Если в транскрипции обсуждаются ключевые термины из проповеди (например, если упоминается "познавать"), добавьте тег "объяснение".
- Кроме того, если обнаружена очевидная ошибка (например, "знание" вместо "здание" в контексте строительства), исправьте её.
- "relevant": Булево значение, true если транскрипция связана с проповедью, false в противном случае.
Если транскрипция не актуальна, выведите:
{
  "text": "<исходная транскрипция>",
  "tags": [],
  "relevant": false
}
Верните JSON строго в указанном формате.`;

    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: promptSystemMessage },
        { role: "user", content: `Содержание проповеди: ${JSON.stringify(sermon)}\n\nТранскрипция: ${transcription}\n\nДоступные tags: ${availableTags.join(', ')}. Используйте ТОЛЬКО эти tags!` }
      ]
    });

    const rawJson = response.choices[0].message.content;
    log.info('generateThought: Raw JSON response', rawJson);

    let result;
    try {
      result = JSON.parse(rawJson || '{}');
    } catch (jsonError) {
      console.error('generateThought: JSON parsing error:', jsonError);
      throw new Error('Invalid JSON structure from OpenAI');
    }

    if (typeof result.text !== 'string' || !Array.isArray(result.tags) || typeof result.relevant !== 'boolean') {
      console.error('generateThought: Invalid JSON structure received', result);
      throw new Error('Invalid JSON structure from OpenAI');
    }

    // If relevant is false, force empty tags array
    if (!result.relevant) {
      result.tags = [];
    }

    const labelWidth = 16;
    const transcriptionLabel = '- Transcription:'.padEnd(labelWidth);
    const thoughtLabel = '- Thought:'.padEnd(labelWidth);
    log.info("\x1b[31m\n\nComparison:\x1b[0m\n%s%o\n%s%o\n\n", transcriptionLabel, transcription, thoughtLabel, result.text);
    return result as Thought;
  } catch (error) {
    console.error('generateThought: OpenAI API Error:', error);
    return {
      text: transcription,
      tags: [],
      relevant: false,
      date: new Date().toISOString(),
    };
  }
}
