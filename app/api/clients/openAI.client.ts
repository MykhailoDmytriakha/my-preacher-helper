import OpenAI from 'openai';
import { Sermon, Thought } from '@/models/models';
import { log } from '@utils/logger';
import { promptSystemMessage } from '@/config/prompt';

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
 * @param thoughtText Raw transcription text from Whisper
 * @param sermon The current sermon context (for reference)
 * @param availableTags List of tags that the user can actually use
 * @returns Thought object with text, tags, date
 */
export async function generateThought(
  thoughtText: string,
  sermon: Sermon,
  availableTags: string[]
): Promise<Thought> {
  try {
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: promptSystemMessage },
        { role: "user", content: `Содержание проповеди: ${JSON.stringify(sermon)}\n\nТранскрипция: ${thoughtText}\n\nДоступные tags: ${availableTags.join(', ')}. Используйте ТОЛЬКО эти tags!` }
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

    if (typeof result.text !== 'string' || !Array.isArray(result.tags)) {
      console.error('generateThought: Invalid JSON structure received', result);
      throw new Error('Invalid JSON structure from OpenAI');
    }

    const labelWidth = 16;
    const transcriptionLabel = '- Transcription:'.padEnd(labelWidth);
    const thoughtLabel = '- Thought:'.padEnd(labelWidth);
    log.info("\x1b[31m\n\nComparison:\x1b[0m\n%s%o\n%s%o\n\n", transcriptionLabel, thoughtText, thoughtLabel, result.text);
    return result as Thought;
  } catch (error) {
    console.error('generateThought: OpenAI API Error:', error);
    return {
      text: thoughtText,
      tags: [],
      date: new Date().toISOString(),
    };
  }
}
