/**
 * Zod schema for cutting a study note into atomic scratch notes.
 *
 * THE UNIT IS A CLAIM, NOT A SECTION. One claim = one cornerstone thought the preacher
 * can say from the pulpit on its own, together with what it rests on (the Scripture
 * quotation or the example as written in the note). The shape mirrors how the cut is
 * decided — section by section, claim by claim — so the COUNT is explainable: the caller
 * can show "this section gave three claims" instead of a bare number.
 *
 * Every field is required and the tree is only two levels deep on purpose. A reused
 * object with `.optional()` produced a self-referential JSON schema that Gemini could
 * not build a grammar for (107s → 500, see structuredOutputSchemas.test.ts); absence is
 * expressed with an empty string or an empty array, never with an optional key.
 */
import { z } from 'zod';

export const CutNoteClaimSchema = z.object({
  text: z
    .string()
    .describe(
      'ONE cornerstone claim, preachable on its own: one to three sentences cut from the note in the author\'s own words (trimmed, not paraphrased), followed by what it rests on — the Scripture quotation exactly as the note quotes it, or the example/image — with the reference in parentheses. Same language as the note.'
    ),
  scripture: z
    .string()
    .describe(
      'The Scripture reference(s) this claim rests on, written the way the note writes them (e.g. "1 Пар 4:9-10; Нав 14:12"). Empty string when the claim rests on no verse.'
    ),
});

export const CutNoteSectionSchema = z.object({
  heading: z
    .string()
    .describe(
      'The section heading exactly as written in the note, without the leading # marks. Empty string for text that comes before the first heading.'
    ),
  claims: z
    .array(CutNoteClaimSchema)
    .describe(
      'The cornerstone claims found in this section, in reading order. An empty array when the section only carries transitions, context or lists without a claim of its own.'
    ),
});

export const CutNoteResponseSchema = z.object({
  keyPassage: z
    .string()
    .describe(
      'The single Scripture passage the whole note is built on, as a reference in the note\'s language (e.g. "1 Пар 4:9-10"). Empty string when there is no such passage.'
    ),
  sections: z
    .array(CutNoteSectionSchema)
    .describe('Every section of the note in document order, including sections that yielded no claim.'),
});

export type CutNoteClaim = z.infer<typeof CutNoteClaimSchema>;
export type CutNoteSection = z.infer<typeof CutNoteSectionSchema>;
export type CutNoteResponse = z.infer<typeof CutNoteResponseSchema>;
