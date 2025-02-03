import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const audioModel = process.env.OPENAI_AUDIO_MODEL as string;
const gptModel = process.env.OPEANAI_GPT_MODEL as string; // Verify that this environment variable is correct

// Define interfaces
export interface Thought {
  text: string;
  tags: string[];
  relevant: boolean;
}

export interface Sermon {
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
 * @param file - Audio file to transcribe.
 * @returns Transcribed text.
 */
export async function createTranscription(file: File): Promise<string> {
  console.log('createTranscription: Received file for transcription', file);
  const transcriptionResponse = await openai.audio.transcriptions.create({
    file,
    model: audioModel,
    response_format: "text",
  });
  console.log('createTranscription: Transcription response received', transcriptionResponse);
  return transcriptionResponse;
}

/**
 * Generates a thought analysis based on the sermon content and the transcription,
 * using OpenAI. The expected JSON schema is:
 *
 * {
 *   "text": "Corrected text in Russian (with only minimal corrections) or the original transcription if not relevant",
 *   "tags": ["tag1", "tag2", ...],
 *   "relevant": true | false
 * }
 *
 * - The "tags" array must include at least one strict tag ("introduction", "main", or "conclusion")
 *   and can include up to 5 tags (optional tags may include "example", "illustration", "context",
 *   "real_life_application", "question_to_audience", etc.).
 *
 * IMPORTANT:
 * - If the transcription is not related to the sermon, return the original transcription unchanged,
 *   assign the tag ["not_relevant"], and set "relevant" to false.
 * - If the transcription is relevant, return it in Russian with only minimal corrections—only fix grammar,
 *   punctuation, and obvious transcription errors. Do not rephrase, shorten, or add any extra commentary.
 * - The output must be a valid JSON object with exactly three keys: "text", "tags", and "relevant". No extra keys are allowed.
 *
 * @param transcription - The transcription text.
 * @param sermon - The sermon object.
 * @returns A Thought object with the corrected text, an array of tags, and a relevance boolean.
 */
export async function generateThought(
  transcription: string,
  sermon: Sermon
): Promise<Thought> {
  try {
    console.log('generateThought: Starting thought generation with transcription and sermon content');
    console.log('received transcript', transcription);

    const promptSystemMessage = `Analyze the sermon content and the provided transcription.
If the transcription is relevant to the sermon, return the transcription in Russian with only minimal corrections—only fix grammar, punctuation, and obvious transcription errors without rephrasing, shortening, or altering the order of ideas.
If the transcription is not relevant, return the original transcription unchanged.
IMPORTANT: Your output must be a single, valid JSON object with exactly three keys: "text", "tags", and "relevant". Do not include any extra keys.
- "text": The (corrected) transcription text in Russian.
- "tags": An array of strings that must include at least one strict tag ("introduction", "main", or "conclusion"). The array may include up to 5 tags.
- "relevant": A boolean that is true if the transcription is related to the sermon, or false otherwise.
If the transcription is not relevant, output:
{
  "text": "<original transcription>",
  "tags": ["not_relevant"],
  "relevant": false
}
Return the JSON exactly as specified.`;

    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: promptSystemMessage },
        { role: "user", content: `Sermon Content: ${JSON.stringify(sermon)}\n\nTranscription: ${transcription}` }
      ]
    });
    console.log('generateThought: Received response from OpenAI', response);

    const rawJson = response.choices[0].message.content;
    console.log('generateThought: Raw JSON response', rawJson);

    let result;
    try {
      result = JSON.parse(rawJson || '{}');
    } catch (jsonError) {
      console.error('generateThought: JSON parsing error:', jsonError);
      throw new Error('Invalid JSON structure from OpenAI');
    }

    // Validate the structure: must have a string 'text', an array 'tags', and a boolean 'relevant'
    if (typeof result.text !== 'string' || !Array.isArray(result.tags) || typeof result.relevant !== 'boolean') {
      console.error('generateThought: Invalid JSON structure received', result);
      throw new Error('Invalid JSON structure from OpenAI');
    }

    // Ensure at least one strict tag is present if relevant is true
    const strictTags = ['introduction', 'main', 'conclusion'];
    if (result.relevant) {
      const hasStrictTag = result.tags.some((tag: string) => strictTags.includes(tag));
      if (!hasStrictTag) {
        console.warn('generateThought: No strict tag found in tags. Assigning default strict tag "introduction".');
        result.tags.unshift('introduction');
      }
      // Limit the total number of tags to 5
      if (result.tags.length > 5) {
        result.tags = result.tags.slice(0, 5);
      }
    }

    console.log('received transcrip', transcription)
    console.log('generateThought: Successfully generated thought', result);
    return result as Thought;
  } catch (error) {
    console.error('generateThought: OpenAI API Error:', error);
    // In case of an error, return the original transcription with the tag "not_relevant" and relevant false
    return {
      text: transcription,
      tags: ['not_relevant'],
      relevant: false
    };
  }
}
