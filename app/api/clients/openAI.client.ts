import OpenAI from 'openai';

// Initialize OpenAI client using the API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const audioModel = process.env.OPENAI_AUDIO_MODEL as string;
const gptModel = process.env.OPEANAI_GPT_MODEL as string; // Verify that this environment variable is correct

// Define interfaces for Thought and Sermon
export interface Thought {
  text: string;
  tags: string[]; // Array of tags (e.g., "introduction", "main", "conclusion", "example", "explanation", etc.)
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
 * IMPORTANT:
 * - If the transcription is not related to the sermon, return the original transcription unchanged,
 *   assign the tag ["not_relevant"], and set "relevant" to false.
 * - If the transcription is relevant, return it in Russian with only minimal corrections—only fix grammar,
 *   punctuation, and obvious transcription errors without rephrasing, shortening, or altering the order of ideas.
 * - The "tags" array must include at least one strict tag ("introduction", "main", or "conclusion").
 * - In addition, if the transcription includes an anecdote or illustrative example, include the tag "example".
 * - Also, if the transcription contains discussion or reflection on key terms from the sermon (for instance,
 *   if it refers to words like "познавать" from the sermon verse), include the tag "explanation".
 * - Additionally, if there is an obvious transcription error where a word is misheard—for example, if the
 *   transcription contains "знание" in a context where "здание" (building) is expected, particularly in relation
 *   to construction—correct it accordingly.
 * - The array may include up to 5 tags.
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

    // Updated system prompt:
    // Instruct the model to add "example" if an anecdote is detected,
    // "explanation" if key terms from the sermon (e.g. "познавать") are discussed,
    // and to correct obvious transcription errors (e.g. replacing "знание" with "здание" when the context indicates construction).
    const promptSystemMessage = `Analyze the sermon content and the provided transcription.
If the transcription is relevant to the sermon, return the transcription in Russian with only minimal corrections—only fix grammar, punctuation, and obvious transcription errors without rephrasing, shortening, or altering the order of ideas.
If the transcription is not relevant, return the original transcription unchanged.
IMPORTANT:
- Your output must be a single, valid JSON object with exactly three keys: "text", "tags", and "relevant". Do not include any extra keys.
- "text": The (corrected) transcription text in Russian.
- "tags": An array of strings that must include at least one strict tag ("introduction", "main", or "conclusion"). In addition, if the transcription includes an anecdote or illustrative example, include the tag "example". Also, if the transcription contains discussion or reflection on key terms from the sermon (for instance, if it refers to words like "познавать"), include the tag "explanation".
- Additionally, if there is an obvious transcription error where a word is misheard—for example, if the transcription contains "знание" in a context where "здание" is expected (especially in relation to construction)—correct it accordingly.
- "relevant": A boolean that is true if the transcription is related to the sermon, or false otherwise.
If the transcription is not relevant, output:
{
  "text": "<original transcription>",
  "tags": ["not_relevant"],
  "relevant": false
}
Return the JSON exactly as specified.`;

    // Call OpenAI Chat Completion API with the system prompt and user message containing sermon content and transcription.
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

    console.log("\x1b[31m received transcrip: %o\x1b[0m", transcription);
    console.log("\x1b[31m generateThought: Successfully generated thought: %o\x1b[0m", result);
    return result as Thought;
  } catch (error) {
    console.error('generateThought: OpenAI API Error:', error);
    // In case of an error, return the original transcription with the tag "not_relevant" and relevant set to false
    return {
      text: transcription,
      tags: ['not_relevant'],
      relevant: false
    };
  }
}
