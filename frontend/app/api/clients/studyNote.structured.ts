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

import { logger } from "./openAIHelpers";
import { buildSimplePromptBlueprint } from "./promptBuilder";
import { callWithStructuredOutput, StructuredOutputResult } from "./structuredOutput";

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
- **PRIMARY RULE: EXTRACT ALL SCRIPTURE REFERENCES** - Your job is to find and return EVERY Scripture reference mentioned in the note
  * Do NOT limit yourself to any arbitrary number (no "2-5" or "up to 10" limits)
  * Short note with many citations? Return all of them.
  * Long note with few references? Return those few.
  * The note determines quantity, NOT arbitrary limits
  * If the note mentions 1 passage - return 1
  * If the note mentions 25 passages - return all 25
- **CRITICAL: AVOID DUPLICATES** - Each scripture reference must be unique
  * If the same verse/chapter would be returned multiple times, return it ONLY ONCE
  * Return DIVERSE references when note discusses multiple sections
- **COMPLETENESS OVER LIMITS** - Include every Scripture reference the note discusses, whether explicit citation or clear allusion

**CRITICAL BOOK NAME MAPPINGS (Russian/Ukrainian → English):**
When analyzing Russian or Ukrainian notes, you MUST use these mappings:

Historical Books (MOST CRITICAL - numbering differs):
  Russian               Ukrainian           English (RETURN THIS)
  1 Царств         →    1 Самуїлова    →    1 Samuel
  2 Царств         →    2 Самуїлова    →    2 Samuel
  3 Царств         →    1 Царів        →    1 Kings
  4 Царств         →    2 Царів        →    2 Kings
  1 Паралипоменон  →    1 Хроніки      →    1 Chronicles
  2 Паралипоменон  →    2 Хроніки      →    2 Chronicles

Gospels (remove prefixes):
  От Матфея        →    Від Матвія     →    Matthew
  От Марка         →    Від Марка      →    Mark
  От Луки          →    Від Луки       →    Luke
  От Иоанна        →    Від Івана      →    John

Epistles (remove prefixes):
  К Римлянам       →    До Римлян      →    Romans
  К Галатам        →    До Галатів     →    Galatians
  К Евреям         →    До Євреїв      →    Hebrews
  (and similar "К.../До..." patterns)

**EXAMPLE:** If Russian text says "во 2 Царств 7 глава" → you MUST return { book: "2 Samuel", chapter: 7 }
**NOT** { book: "2 Kings" } - that would be wrong!

**PSALM NUMBERING CONVERSION (CRITICAL for Russian/Ukrainian notes):**
- Storage format ALWAYS uses Hebrew/Protestant numbering (KJV, NIV, ESV)
- When analyzing Russian/Ukrainian notes, users refer to Psalms using Septuagint/Orthodox numbering
- YOU MUST CONVERT Septuagint → Hebrew before returning:
  * Psalms 1-9 and 148-150: Same in both (no conversion needed)
  * Psalms 10-147 (Septuagint) → add +1 to get Hebrew number
  * Example: Russian user writes "Псалом 22" → return { book: "Psalms", chapter: 23 }
  * Example: Russian user writes "Псалом 90" → return { book: "Psalms", chapter: 91 }
- For English notes: use the number as-is (already Hebrew)

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
- **PRIMARY RULE: EXTRACT ALL RELEVANT THEMES** - Your job is to identify EVERY significant theme, topic, or concept in the note
  * Do NOT limit yourself to any fixed number (no "2-5 tags" limit)
  * The note content determines tag count, NOT arbitrary limits
  * Simple note with one theme? Return 2-3 tags.
  * Rich theological note with many themes? Return 10+ tags if needed.
  * Completeness matters: capture all distinct themes the note discusses
- **Each tag must be unique** - no duplicate tags
- Tags should help categorize the note by theme, topic, or type
- Common categories: theological themes, book names, concepts, study types, doctrines, biblical characters, events
- Include both broad themes (e.g., "спасение") and specific topics (e.g., "оправдание верой")
- Prefer specific, meaningful tags over generic ones

TITLE RULES:
- Create a concise, descriptive title (5-15 words)
- Title should capture the main theme or insight of the note

EXAMPLES:

Example 1 - Russian note with Psalm reference:
Input: "Псалом 22 говорит о Господе как пастыре..."
Output:
{
  "title": "Господь - мой пастырь",
  "scriptureRefs": [{ "book": "Psalms", "chapter": 23 }],  // 22 + 1 = 23 (Septuagint → Hebrew)
  "tags": ["Псалтирь", "Пастырь", "провидение"]
}

Example 2 - Russian note with "Царств" (CRITICAL book name mapping):
Input: "Во 2 Царств 7 главе Бог обещает Давиду вечное царство..."
Output:
{
  "title": "Обетование Давиду о вечном царстве",
  "scriptureRefs": [{ "book": "2 Samuel", "chapter": 7 }],  // NOT "2 Kings"! See mapping table.
  "tags": ["Давид", "завет", "мессианское пророчество"]
}

Example 3 - Multiple unique references (NOT duplicates):
Input: "Книга Даниила показывает верность Богу. В начале (глава 1) искушение компромисса, в главе 6 - львиный ров, в главах 7-12 - пророчества."
Output:
{
  "title": "Верность Богу в книге Даниила",
  "scriptureRefs": [
    { "book": "Daniel" },                           // entire book context
    { "book": "Daniel", "chapter": 1 },             // chapter 1 - compromise temptation
    { "book": "Daniel", "chapter": 6 },             // chapter 6 - lions' den
    { "book": "Daniel", "chapter": 7, "toChapter": 12 }  // chapters 7-12 - prophecies
  ],  // Four UNIQUE references, NOT duplicates
  "tags": ["Даниил", "верность", "пророчества", "испытания"]
}

Example 4 - Avoid duplicates when ranges overlap:
Input: "В Матфея 5 Иисус учит о блаженствах. Нагорная проповедь в Матфея 5-7."
Output:
{
  "title": "Нагорная проповедь и блаженства",
  "scriptureRefs": [
    { "book": "Matthew", "chapter": 5, "toChapter": 7 }  // ONE reference covering all
  ],  // NOT [Matthew 5, Matthew 5-7] - chapter 5 is already included in 5-7 range
  "tags": ["Нагорная проповедь", "блаженства", "учение Иисуса"]
}

Example 5 - Ukrainian note with book name variations:
Input: "У 1 Самуїлова 17 розділ - Давид і Голіаф..."
Output:
{
  "title": "Давид і Голіаф",
  "scriptureRefs": [{ "book": "1 Samuel", "chapter": 17 }],  // "Самуїлова" → "Samuel"
  "tags": ["Давид", "віра", "перемога"]
}

Example 6 - SHORT NOTE with MANY references (extract ALL, ignore length):
Input: "Творение Богом: Быт 1:1, Пс 19:1, Пс 33:6, Ис 40:28, Иер 10:12, Ин 1:3, Деян 17:24, Кол 1:16, Евр 1:2, Откр 4:11"
Output:
{
  "title": "Библейские свидетельства о творении Богом",
  "scriptureRefs": [
    { "book": "Genesis", "chapter": 1, "fromVerse": 1 },
    { "book": "Psalms", "chapter": 20, "fromVerse": 1 },  // Пс 19 + 1 = 20 (Septuagint → Hebrew)
    { "book": "Psalms", "chapter": 34, "fromVerse": 6 },  // Пс 33 + 1 = 34
    { "book": "Isaiah", "chapter": 40, "fromVerse": 28 },
    { "book": "Jeremiah", "chapter": 10, "fromVerse": 12 },
    { "book": "John", "chapter": 1, "fromVerse": 3 },
    { "book": "Acts", "chapter": 17, "fromVerse": 24 },
    { "book": "Colossians", "chapter": 1, "fromVerse": 16 },
    { "book": "Hebrews", "chapter": 1, "fromVerse": 2 },
    { "book": "Revelation", "chapter": 4, "fromVerse": 11 }
  ],  // 10 references in SHORT note - extracted ALL because they're all mentioned
  "tags": ["творение", "Бог-Творец", "Слово Божье"]
}

Example 7 - LONG NOTE with many references and tags:
Input: "Тема спасения проходит через всю Библию. В Бытие 3:15 первое обетование о Спасителе. Исход 12 - пасхальный агнец, прообраз Христа. Левит 16 - день искупления. Исаия 53 - страдающий Раб. Иезекииль 36:26 - новое сердце. Даниил 9:24-27 - пророчество о Мессии. В Новом Завете: Иоанна 3:16 - суть Евангелия, Римлянам 3:23-24 - оправдание верой, Римлянам 5:8 - любовь Божья, Ефесянам 2:8-9 - спасение по благодати, Филиппийцам 2:5-11 - смирение Христа, Евреям 9:12 - вечное искупление, 1 Петра 1:18-19 - искуплены кровью, Откровение 5:9 - песнь искупленных."
Output:
{
  "title": "Библейская тема спасения от Бытия до Откровения",
  "scriptureRefs": [
    { "book": "Genesis", "chapter": 3, "fromVerse": 15 },
    { "book": "Exodus", "chapter": 12 },
    { "book": "Leviticus", "chapter": 16 },
    { "book": "Isaiah", "chapter": 53 },
    { "book": "Ezekiel", "chapter": 36, "fromVerse": 26 },
    { "book": "Daniel", "chapter": 9, "fromVerse": 24, "toVerse": 27 },
    { "book": "John", "chapter": 3, "fromVerse": 16 },
    { "book": "Romans", "chapter": 3, "fromVerse": 23, "toVerse": 24 },
    { "book": "Romans", "chapter": 5, "fromVerse": 8 },
    { "book": "Ephesians", "chapter": 2, "fromVerse": 8, "toVerse": 9 },
    { "book": "Philippians", "chapter": 2, "fromVerse": 5, "toVerse": 11 },
    { "book": "Hebrews", "chapter": 9, "fromVerse": 12 },
    { "book": "1 Peter", "chapter": 1, "fromVerse": 18, "toVerse": 19 },
    { "book": "Revelation", "chapter": 5, "fromVerse": 9 }
  ],  // 14 references - ALL mentioned passages extracted
  "tags": [
    "спасение",
    "искупление",
    "Мессия",
    "благодать",
    "вера",
    "жертва Христа",
    "оправдание",
    "пророчества о Христе",
    "прообразы Христа"
  ]  // 9 tags - comprehensive coverage of long note's themes
}

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
  const { languageHint } = detectLanguage(noteContent);

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
    const promptBlueprint = buildSimplePromptBlueprint({
      promptName: "studyNoteAnalysis",
      promptVersion: "v1",
      expectedLanguage: languageHint,
      systemPrompt,
      userMessage,
      context: {
        contentLength: noteContent.length,
        languageHint,
        existingTagsCount: existingTags?.length ?? 0,
      },
    });

    const result: StructuredOutputResult<StudyNoteAnalysis> = await callWithStructuredOutput(
      promptBlueprint.systemPrompt,
      promptBlueprint.userMessage,
      StudyNoteAnalysisSchema,
      {
        formatName: "studyNoteAnalysis",
        promptBlueprint,
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
        // Normalize redundant fields without early returns to avoid skipping later cleanup
        const normalizedRef = { ...ref };

        // Remove toVerse if it equals fromVerse (single verse, not a range)
        if (
          normalizedRef.toVerse !== undefined &&
          normalizedRef.fromVerse !== undefined &&
          normalizedRef.toVerse === normalizedRef.fromVerse
        ) {
          delete normalizedRef.toVerse;
        }

        // Remove toChapter if it equals chapter (single chapter, not a range)
        if (
          normalizedRef.toChapter !== undefined &&
          normalizedRef.chapter !== undefined &&
          normalizedRef.toChapter === normalizedRef.chapter
        ) {
          delete normalizedRef.toChapter;
        }

        return normalizedRef;
      });

    // Deduplicate references
    const uniqueRefsMap = new Map<string, typeof validatedRefs[0]>();

    for (const ref of validatedRefs) {
      // Create a unique key for the reference
      // Use a consistent format: Book:Chapter:FromVerse:ToVerse
      // Note: optional fields might be undefined
      const key = `${ref.book}|${ref.chapter ?? ''}|${ref.toChapter ?? ''}|${ref.fromVerse ?? ''}|${ref.toVerse ?? ''}`;

      if (!uniqueRefsMap.has(key)) {
        uniqueRefsMap.set(key, ref);
      }
    }

    const uniqueRefs = Array.from(uniqueRefsMap.values());

    // Deduplicate tags (case-sensitive, exact match)
    const uniqueTags = Array.from(new Set(result.data.tags));

    logger.success('AnalyzeStudyNote', "Analysis completed", {
      title: result.data.title,
      refsCount: uniqueRefs.length,
      originalRefsCount: result.data.scriptureRefs.length,
      tagsCount: uniqueTags.length,
      originalTagsCount: result.data.tags.length,
    });

    return {
      success: true,
      data: {
        ...result.data,
        scriptureRefs: uniqueRefs,
        tags: uniqueTags,
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
