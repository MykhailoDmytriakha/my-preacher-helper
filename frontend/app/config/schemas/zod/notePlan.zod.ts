import { z } from 'zod';

/**
 * A plan cell built from a note (v5, owner 2026-11-21): the model fills the parts of a point — entry, the point's
 * own verses, numbered steps each standing on its place of Scripture, an optional comparison table, conclusion —
 * and `assembleNotePlanMarkdown` (`utils/notePlanMarkdown.ts`) gives them their form.
 *
 * Every object is declared INLINE and every field is REQUIRED (nullable or an empty array when absent): a reused
 * object plus an optional field is what the converter hoists into self-referential definitions — the cycle that
 * hung Gemini for 107 s (see `project_zod_optional_self_reference_gemini`).
 */
const verseLines = (purpose: string) => z.array(z.string()).describe(
  `${purpose} Each line = reference + the words of the place itself, e.g. «Мф. 1:19–20: «Иосиф же… хотел тайно отпустить Её. `
  + 'Но когда он помыслил это, — се, Ангел Господень явился ему во сне и сказал: …не бойся принять Марию, жену твою»». '
  + 'Adjacent verses of one chapter that tell one moment are ONE line with a range. The quote retells the place in its own '
  + 'words with its turns kept (who acted, what happened, what was said), so one glance brings back the whole passage; cut '
  + 'with «…» only what carries no turn. Only Scripture words — never the author\'s comment about the verse. Empty when none.',
);

export const NotePlanResponseSchema = z.object({
  nodes: z.array(z.object({
    nodeId: z.string(),
    entry: z.string().nullable().describe(
      'The way into the point, said first: a question the point answers, or one or two sentences that turn the listener '
      + 'to its theme and sum up where it goes. Grounded in the material; null only if the node has no own content.',
    ),
    refs: verseLines('The point\'s own main verse(s), read right after the entry, before the steps — only when the whole point stands on one place.'),
    table: z.object({
      columns: z.array(z.string()).describe('Column headings, e.g. «Братьям», «Сёстрам».'),
      rows: z.array(z.object({
        label: z.string().describe('The row\'s name, e.g. «Порядок».'),
        cells: z.array(z.string()).describe('One cell per column, in column order: a verse line and/or a few words.'),
      })),
    }).nullable().describe(
      'REQUIRED when the point applies the same aspects to two or more groups of listeners (husbands / wives, brothers / '
      + 'sisters, parents / children) — then steps stay EMPTY. Otherwise null: a series of examples is steps, not a table.',
    ),
    steps: z.array(z.object({
      title: z.string().describe('The step\'s name in a few words (a person, a pair, an event, a word of the text) — no number.'),
      gist: z.string().nullable().describe('What this step is about in a few words — the problem, the turn or the core; null if the title says it.'),
      refs: verseLines('The place(s) this step stands on, read before its thoughts.'),
      thoughts: z.array(z.string()).describe(
        'What the preacher says about this place, in the author\'s own living words: explanation first, an example or '
        + 'illustration last. HOW MANY is set by the PLAN LENGTH block — the steps and their verses never change with it.',
      ),
    })).describe('Numbered steps of the point in the order they are preached. Empty when the point has no steps.'),
    conclusion: z.string().nullable().describe('One sentence that closes the point\'s thought, so the next point can begin; from the material.'),
    missingMaterial: z.string().nullable(),
  })),
});
