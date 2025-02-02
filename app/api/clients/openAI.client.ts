import OpenAI from 'openai';

// Configure the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const audioModel = process.env.OPENAI_AUDIO_MODEL as string;
const gptModel = process.env.OPEANAI_GPT_MODEL as string;

interface Thought {
  text: string;
  tag: string;
}
interface Sermon {
  id: string;
  title: string;
  verse: string;
  date: string;
  thoughts: Thought[];
  structure?: string;
}

/**
 * Transcribes the provided audio file using OpenAI Whisper.
 * 
 * @param file - The audio file to transcribe.
 * @returns The transcription text.
 */
export async function createTranscription(file: File): Promise<string> {
  console.log('createTranscription: Received file for transcription', file);
  const transcriptionResponse = await openai.audio.transcriptions.create({
    file,
    model: audioModel,
    response_format: "text",
  });
  console.log('createTranscription: Transcription response received', transcriptionResponse);
  // The response might be in a `data` property or directly as a string.
  return transcriptionResponse;
}

/**
 * Generates a thought analysis from sermon content and transcription
 * using OpenAI's JSON response format
 */
export async function generateThought(
  transcription: string,
  sermon: Sermon
): Promise<Thought> {
  try {
    // TODO : this function should be improved, to return thought or if not related to sermon return transcript as is
    // so we need to implemetn schema, and validation of relation to sermon
    console.log('generateThought: Starting thought generation with transcription and sermon content');
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Проанализируйте содержание проповеди и транскрипцию. Ответьте в формате JSON с:
          {
            "text": "key insight from the content on russian",
            "tag": "category from [devotional, practical, theological, empty]"
          }
          если Transcription не относится к проповеди, тогда просто верни Transcription как есть
          `
        },
        {
          role: "user",
          content: `Sermon Content: ${sermon}\n\nTranscription: ${transcription}`
        }
      ]
    });
    console.log('generateThought: Received response from OpenAI', response);
    const rawJson = response.choices[0].message.content;
    console.log('generateThought: Raw JSON response', rawJson);
    const result = JSON.parse(rawJson || '{}');
    
    // Validate response structure
    if (!result.text || !result.tag) {
      console.error('generateThought: Invalid JSON structure received', result);
      throw new Error('Invalid JSON structure from OpenAI');
    }
    console.log('generateThought: Successfully generated thought', result);
    return result as Thought;
  } catch (error) {
    console.error('generateThought: OpenAI API Error:', error);
    throw new Error('Failed to generate structured thought');
  }
}
