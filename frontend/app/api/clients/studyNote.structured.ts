/**
 * Structured Output Implementation for Study Note Analysis
 * 
 * This module provides AI-powered analysis of study notes to:
 * - Generate a descriptive title
 * - Extract Scripture references mentioned in the note
 * - Suggest relevant tags for categorization
 * 
 * All outputs respect the language of the input note.
 */
import { StudyNoteAnalysisSchema, StudyNoteAnalysis } from "@/config/schemas/zod";
import { callWithStructuredOutput, StructuredOutputResult } from "./structuredOutput";
import { logger } from "./openAIHelpers";

const isDebugMode = process.env.DEBUG_MODE === 'true';

/**
 * Result structure for analyzeStudyNote operation.
 */
export interface AnalyzeStudyNoteResult {
  success: boolean;
  data: StudyNoteAnalysis | null;
  error: string | null;
}

/**
 * Detect language characteristics of the text.
 */
function detectLanguage(text: string): {
  isCyrillic: boolean;
  hasNonLatinChars: boolean;
  languageHint: string;
} {
  const isCyrillic = /[\u0400-\u04FF]/.test(text);
  const hasNonLatinChars = /[^\u0000-\u007F]/.test(text);
  
  const languageHint = isCyrillic
    ? "Cyrillic (Russian/Ukrainian)"
    : hasNonLatinChars
      ? "non-English"
      : "English";
  
  return { isCyrillic, hasNonLatinChars, languageHint };
}

/**
 * Build the system prompt for study note analysis.
 */
function buildSystemPrompt(isCyrillic: boolean, hasNonLatinChars: boolean): string {
  const languageDirective = isCyrillic
    ? `LANGUAGE RULES:
- The note is written in Cyrillic (Russian or Ukrainian).
- Generate the title in the SAME Cyrillic language as the note.
- Generate tags in the SAME Cyrillic language as the note.
- Scripture book names MUST ALWAYS be in English (e.g., "Matthew", NOT "Матфей" or "Матвія").`
    : hasNonLatinChars
      ? `LANGUAGE RULES:
- Generate title and tags in the SAME language as the note content.
- Scripture book names MUST ALWAYS be in English.`
      : `LANGUAGE RULES:
- Generate title and tags in English.
- Scripture book names in English.`;

  return `You are a biblical study assistant that helps organize and categorize study notes.

Your task is to analyze a study note and extract:
1. A short, descriptive TITLE that captures the main theme (5-15 words)
2. All SCRIPTURE REFERENCES mentioned or alluded to in the note
3. Relevant TAGS for categorization (2-5 tags)

${languageDirective}

SCRIPTURE REFERENCE RULES:
- Extract ALL Bible references mentioned in the note (explicit or implied)
- Book names MUST be in English: Genesis, Exodus, Matthew, John, Psalms, etc.
- Use Hebrew/Protestant chapter numbering for Psalms
- If a verse range is mentioned (e.g., "verses 1-12"), include both fromVerse and toVerse
- If only one verse is mentioned, only include fromVerse (omit toVerse)

TAGGING RULES:
- Suggest 2-5 relevant tags based on the content
- Tags should help categorize the note by theme, topic, or type
- Common categories: theological themes, book names, concepts, study types
- Tags MUST be in the same language as the note

TITLE RULES:
- Create a concise, descriptive title (5-15 words)
- Title should capture the main theme or insight of the note
- Title MUST be in the same language as the note

Return ONLY the structured JSON response with title, scriptureRefs, and tags.`;
}

/**
 * Build the user message for study note analysis.
 */
function buildUserMessage(noteContent: string, existingTags?: string[]): string {
  let message = `Analyze the following study note and extract the title, scripture references, and tags:

---
NOTE CONTENT:
${noteContent}
---`;

  if (existingTags && existingTags.length > 0) {
    message += `

EXISTING TAGS (prefer using these when relevant):
${existingTags.join(', ')}`;
  }

  return message;
}

/**
 * Analyze a study note using AI to extract title, scripture refs, and tags.
 * 
 * @param noteContent - The text content of the study note
 * @param existingTags - Optional list of existing tags to prefer
 * @returns Analysis result with title, scriptureRefs, and tags
 * 
 * @example
 * ```typescript
 * const result = await analyzeStudyNote(
 *   "В Матфея 5:1-12 Иисус учит о блаженствах...",
 *   ["Нагорная проповедь", "Евангелия"]
 * );
 * 
 * if (result.success && result.data) {
 *   console.log(result.data.title); // "Блаженства в Нагорной проповеди"
 *   console.log(result.data.scriptureRefs); // [{ book: "Matthew", chapter: 5, ... }]
 * }
 * ```
 */
export async function analyzeStudyNote(
  noteContent: string,
  existingTags?: string[]
): Promise<AnalyzeStudyNoteResult> {
  if (!noteContent.trim()) {
    return {
      success: false,
      data: null,
      error: "Note content is empty",
    };
  }

  // Detect language for proper prompt construction
  const { isCyrillic, hasNonLatinChars, languageHint } = detectLanguage(noteContent);

  if (isDebugMode) {
    logger.debug('AnalyzeStudyNote', "Starting analysis", {
      contentLength: noteContent.length,
      languageHint,
      existingTagsCount: existingTags?.length ?? 0,
    });
  }

  try {
    const systemPrompt = buildSystemPrompt(isCyrillic, hasNonLatinChars);
    const userMessage = buildUserMessage(noteContent, existingTags);

    const result: StructuredOutputResult<StudyNoteAnalysis> = await callWithStructuredOutput(
      systemPrompt,
      userMessage,
      StudyNoteAnalysisSchema,
      {
        formatName: "studyNoteAnalysis",
        logContext: {
          contentLength: noteContent.length,
          languageHint,
        },
      }
    );

    // Handle refusal
    if (result.refusal) {
      logger.warn('AnalyzeStudyNote', `Model refused: ${result.refusal}`);
      return {
        success: false,
        data: null,
        error: `AI refused to analyze: ${result.refusal}`,
      };
    }

    // Handle error
    if (result.error || !result.data) {
      const errorMessage = result.error?.message ?? "No data received from AI";
      logger.error('AnalyzeStudyNote', errorMessage);
      return {
        success: false,
        data: null,
        error: errorMessage,
      };
    }

    // Validate and clean scripture refs
    const validatedRefs = result.data.scriptureRefs
      .filter(ref => 
        ref.book && 
        ref.chapter > 0 && 
        ref.fromVerse > 0 &&
        (!ref.toVerse || ref.toVerse >= ref.fromVerse)
      )
      .map(ref => {
        // Remove toVerse if it equals fromVerse (single verse, not a range)
        if (ref.toVerse === ref.fromVerse) {
          const { toVerse, ...rest } = ref;
          return rest;
        }
        return ref;
      });

    logger.success('AnalyzeStudyNote', "Analysis completed", {
      title: result.data.title,
      refsCount: validatedRefs.length,
      tagsCount: result.data.tags.length,
    });

    return {
      success: true,
      data: {
        ...result.data,
        scriptureRefs: validatedRefs,
      },
      error: null,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('AnalyzeStudyNote', `Failed: ${errorMessage}`);
    return {
      success: false,
      data: null,
      error: errorMessage,
    };
  }
}

