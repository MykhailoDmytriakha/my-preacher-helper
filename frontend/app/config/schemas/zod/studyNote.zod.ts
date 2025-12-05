/**
 * Zod schema for study note analysis structured output.
 * Used with OpenAI's structured output feature for type-safe AI responses.
 */
import { z } from "zod";

/**
 * Schema for a single Scripture reference.
 * Book name is ALWAYS in English for consistency with storage format.
 * 
 * Semantic rules:
 * - book only: entire book reference
 * - book + chapter: entire chapter reference
 * - book + chapter + toChapter: chapter range
 * - book + chapter + fromVerse: specific verse
 * - book + chapter + fromVerse + toVerse: verse range
 */
export const ScriptureRefSchema = z.object({
  book: z
    .string()
    .describe("English book name: Genesis, Exodus, Leviticus, Numbers, Deuteronomy, Joshua, Judges, Ruth, 1 Samuel, 2 Samuel, 1 Kings, 2 Kings, 1 Chronicles, 2 Chronicles, Ezra, Nehemiah, Esther, Job, Psalms, Proverbs, Ecclesiastes, Song of Solomon, Isaiah, Jeremiah, Lamentations, Ezekiel, Daniel, Hosea, Joel, Amos, Obadiah, Jonah, Micah, Nahum, Habakkuk, Zephaniah, Haggai, Zechariah, Malachi, Matthew, Mark, Luke, John, Acts, Romans, 1 Corinthians, 2 Corinthians, Galatians, Ephesians, Philippians, Colossians, 1 Thessalonians, 2 Thessalonians, 1 Timothy, 2 Timothy, Titus, Philemon, Hebrews, James, 1 Peter, 2 Peter, 1 John, 2 John, 3 John, Jude, Revelation"),
  chapter: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Chapter number (use Hebrew/Protestant numbering for Psalms). Omit if reference is to entire book."),
  toChapter: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Ending chapter number for chapter ranges (e.g., Matthew 5-7). Must be >= chapter."),
  fromVerse: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Starting verse number. Omit if reference is to entire chapter."),
  toVerse: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Ending verse number if it's a range (must be >= fromVerse)"),
});

/**
 * Schema for AI-analyzed study note.
 * 
 * @property title - Short descriptive title in the SAME language as the note
 * @property scriptureRefs - All Scripture references found in the note (books in English)
 * @property tags - Relevant categorization tags in the SAME language as the note
 */
export const StudyNoteAnalysisSchema = z.object({
  title: z
    .string()
    .describe("Short, descriptive title for the note (5-15 words). MUST be in the SAME language as the note content."),
  scriptureRefs: z
    .array(ScriptureRefSchema)
    .describe("All Scripture references mentioned or alluded to in the note. Book names MUST be in English."),
  tags: z
    .array(z.string())
    .describe("Relevant categorization tags (2-5 tags). MUST be in the SAME language as the note content."),
});

/**
 * TypeScript types inferred from the Zod schemas.
 */
export type ScriptureRefAnalysis = z.infer<typeof ScriptureRefSchema>;
export type StudyNoteAnalysis = z.infer<typeof StudyNoteAnalysisSchema>;

