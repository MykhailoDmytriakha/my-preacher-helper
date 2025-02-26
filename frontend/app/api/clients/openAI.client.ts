import OpenAI from "openai";
import { Sermon, Thought } from "@/models/models";
import { log } from "@utils/logger";
import { promptSystemMessage } from "@/config/prompt";
import { v4 as uuidv4 } from 'uuid';
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const audioModel = process.env.OPENAI_AUDIO_MODEL as string;
const gptModel = process.env.OPENAI_GPT_MODEL as string;

export async function createTranscription(file: File): Promise<string> {
  log.info("createTranscription: Received file for transcription", file);
  const transcriptionResponse = await openai.audio.transcriptions.create({
    file,
    model: audioModel,
    response_format: "text",
  });
  log.info(
    "createTranscription: Transcription response received",
    transcriptionResponse
  );
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
  const userMessage = `
    Контекст проповеди:
    Название проповеди: ${sermon.title}
    Текст проповеди: ${sermon.verse}
    Доступные tags: ${availableTags.join(", ")}. Используйте ТОЛЬКО эти tags!
    --------------------------------
    Транскрипция: ${thoughtText}
    --------------------------------
    `;
  // console.log("system prompt: ", promptSystemMessage);
  // console.log("user message: ", userMessage);
  try {
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: promptSystemMessage },
        { role: "user", content: userMessage },
      ],
      max_completion_tokens: 500
    });

    const rawJson = response.choices[0].message.content;
    // log.info('generateThought: Raw JSON response', rawJson);

    let result;
    try {
      result = JSON.parse(rawJson || "{}");
    } catch (jsonError) {
      console.error("generateThought: JSON parsing error:", jsonError);
      throw new Error("Invalid JSON structure from OpenAI");
    }

    if (typeof result.text !== "string" || !Array.isArray(result.tags)) {
      console.error("generateThought: Invalid JSON structure received", result);
      throw new Error("Invalid JSON structure from OpenAI");
    }

    const labelWidth = 16;
    const transcriptionLabel = "- Transcription:".padEnd(labelWidth);
    const thoughtLabel = "- Thought:".padEnd(labelWidth);
    console.log(
      "Comparison:\n%s%o\n%s%o\n\n",
      transcriptionLabel,
      thoughtText,
      thoughtLabel,
      result.text
    );
    return {
      ...result,
      id: uuidv4(),
      date: new Date().toISOString()
    } as Thought;
  } catch (error) {
    console.error("generateThought: OpenAI API Error:", error);
    return {
      id: uuidv4(),
      text: thoughtText,
      tags: [],
      date: new Date().toISOString(),
    };
  }
}
