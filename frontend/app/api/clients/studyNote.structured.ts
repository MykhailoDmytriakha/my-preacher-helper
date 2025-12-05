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

  // Detect specific language by unique characters
  const hasUkrainianChars = /[їієґЇІЄҐ]/.test(text);  // ї, і, є, ґ - only in Ukrainian
  const hasRussianChars = /[ыэъЫЭЪ]/.test(text);     // ы, э, ъ - only in Russian

  let languageHint: string;
  if (hasUkrainianChars) {
    languageHint = "Ukrainian";
  } else if (hasRussianChars) {
    languageHint = "Russian";
  } else if (isCyrillic) {
    languageHint = "Cyrillic (Russian or Ukrainian)";
  } else if (hasNonLatinChars) {
    languageHint = "non-English";
  } else {
    languageHint = "English";
  }

  return { isCyrillic, hasNonLatinChars, languageHint };
}

/**
 * Build the system prompt for study note analysis.
 */
function buildSystemPrompt(languageHint: string): string {
  // Build language directive based on detected language
  let languageDirective: string;

  if (languageHint === "Russian") {
    languageDirective = `LANGUAGE RULES:
- The note is written in Russian.
- Generate the title in Russian.
- Generate tags in Russian.
- Scripture book names MUST ALWAYS be in English (e.g., "Matthew", NOT "Матфей").`;
  } else if (languageHint === "Ukrainian") {
    languageDirective = `LANGUAGE RULES:
- The note is written in Ukrainian.
- Generate the title in Ukrainian.
- Generate tags in Ukrainian.
- Scripture book names MUST ALWAYS be in English (e.g., "Matthew", NOT "Матвія").`;
  } else if (languageHint === "Cyrillic (Russian or Ukrainian)") {
    languageDirective = `LANGUAGE RULES:
- The note is written in Cyrillic. Try to detect if it's Russian or Ukrainian based on context.
- Generate the title in the SAME language as the note.
- Generate tags in the SAME language as the note.
- Scripture book names MUST ALWAYS be in English.`;
  } else if (languageHint === "English") {
    languageDirective = `LANGUAGE RULES:
- Generate title and tags in English.
- Scripture book names in English.`;
  } else {
    languageDirective = `LANGUAGE RULES:
- Generate title and tags in the SAME language as the note content.
- Scripture book names MUST ALWAYS be in English.`;
  }

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
- IMPORTANT: Extract MULTIPLE references when the note discusses different sections:
  * If a note discusses "the book of Ezekiel" AND mentions events in specific chapters, extract BOTH the book-level reference AND the chapter-specific references
  * Example: "Книга Иезекииля... видение славы в начале... слава отошла... в конце храм" should yield:
    - Ezekiel (entire book as context)
    - Ezekiel 1 (initial glory vision)
    - Ezekiel 10-11 (glory departing)
    - Ezekiel 40-48 (temple vision, glory returns)
- Use the appropriate level of specificity for EACH reference:
  * For entire book references (e.g., "the book of Ezekiel"): only include "book" field
  * For entire chapter (e.g., "Psalm 23", "Romans 8"): include "book" and "chapter", omit verse fields
  * For chapter ranges (e.g., "Matthew 5-7", "chapters 40-48"): include "book", "chapter", and "toChapter"
  * For specific verse: include "book", "chapter", and "fromVerse"
  * For verse range: include "book", "chapter", "fromVerse", and "toVerse"
- If a verse range is mentioned (e.g., "verses 1-12"), include both fromVerse and toVerse
- If only one verse is mentioned, only include fromVerse (omit toVerse)
- Use your biblical knowledge to infer chapter numbers for well-known events even if not explicitly stated
- IMPORTANT: Infer scripture references from well-known theological concepts:
  * "666" or "число зверя" → Revelation 13:18
  * "Нагорная проповедь" → Matthew 5-7
  * "Отче наш" / "молитва Господня" → Matthew 6:9-13 or Luke 11:2-4
  * "заповеди блаженства" → Matthew 5:3-12
  * "Добрый Самарянин" → Luke 10:25-37
  * and other well-known passages based on your biblical knowledge

TAGGING RULES:
- Suggest 2-5 relevant tags based on the content
- Tags should help categorize the note by theme, topic, or type
- Common categories: theological themes, book names, concepts, study types

TITLE RULES:
- Create a concise, descriptive title (5-15 words)
- Title should capture the main theme or insight of the note

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

  // Always log for easier debugging (content preview truncated for readability)
  const contentPreview = noteContent.length > 500
    ? noteContent.substring(0, 500) + '...'
    : noteContent;
  logger.debug('AnalyzeStudyNote', "Starting analysis", {
    contentLength: noteContent.length,
    contentPreview,
    languageHint,
    existingTagsCount: existingTags?.length ?? 0,
  });

  try {
    const systemPrompt = buildSystemPrompt(languageHint);
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
    // Now supporting flexible references: book-only, chapter-only, chapter-range, verse-level
    const validatedRefs = result.data.scriptureRefs
      .filter(ref => {
        // Book is always required
        if (!ref.book) return false;

        // If chapter is present, it must be positive
        if (ref.chapter !== undefined && ref.chapter <= 0) return false;

        // If toChapter is present, chapter must also be present and toChapter >= chapter
        if (ref.toChapter !== undefined) {
          if (ref.chapter === undefined || ref.toChapter < ref.chapter) return false;
        }

        // If fromVerse is present, chapter must also be present and fromVerse must be positive
        if (ref.fromVerse !== undefined) {
          if (ref.chapter === undefined || ref.fromVerse <= 0) return false;
        }

        // If toVerse is present, fromVerse must also be present and toVerse >= fromVerse
        if (ref.toVerse !== undefined) {
          if (ref.fromVerse === undefined || ref.toVerse < ref.fromVerse) return false;
        }

        return true;
      })
      .map(ref => {
        // Remove toVerse if it equals fromVerse (single verse, not a range)
        if (ref.toVerse !== undefined && ref.fromVerse !== undefined && ref.toVerse === ref.fromVerse) {
          const { toVerse, ...rest } = ref;
          return rest;
        }
        // Remove toChapter if it equals chapter (single chapter, not a range)
        if (ref.toChapter !== undefined && ref.chapter !== undefined && ref.toChapter === ref.chapter) {
          const { toChapter, ...rest } = ref;
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

