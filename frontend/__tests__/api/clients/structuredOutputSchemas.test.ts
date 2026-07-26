/**
 * Guard against the failure that took compose-plan down on 2026-07-26.
 *
 * `z.string().optional()` inside a named strict schema compiles to a SELF-REFERENTIAL
 * definition:  {"anyOf":[{"not":{}},{"$ref":"#/definitions/<that very definition>"}]}
 *
 * Gemini cannot build a constrained-decoding grammar over that cycle. Measured on the live
 * endpoint with identical prompt/model/data:
 *     cyclic schema  -> 84s, 93s, 107.8s  -> "500 status code (no body)"
 *     flat schema    -> 12.7s             -> success
 * Under the 60s Vercel wall the cyclic case surfaces as FUNCTION_INVOCATION_TIMEOUT with
 * no response body, so nothing downstream can explain it to the user.
 *
 * This test regenerates every response schema that actually reaches a provider and fails
 * on a cycle. It is a necessary guard, not a sufficient one — provider compatibility is
 * wider than cycles (unsupported keywords, depth, nullable encodings), so a live canary
 * still matters.
 */
import { zodResponseFormat } from 'openai/helpers/zod';

import { BrainstormSuggestionSchema } from '@/config/schemas/zod/brainstorm.zod';
import { ComposePlanResponseSchema } from '@/config/schemas/zod/composePlan.zod';
import { InsightsResponseSchema } from '@/config/schemas/zod/insights.zod';
import { PolishTranscriptionSchema } from '@/config/schemas/zod/polishTranscription.zod';
import { SectionHintsResponseSchema } from '@/config/schemas/zod/sectionHints.zod';
import { SermonPointsResponseSchema } from '@/config/schemas/zod/sermonPoints.zod';
import { SortingResponseSchema } from '@/config/schemas/zod/sorting.zod';
import { SpeechOptimizationResponseSchema } from '@/config/schemas/zod/speechOptimization.zod';
import { StudyNoteAnalysisSchema } from '@/config/schemas/zod/studyNote.zod';
import { ThoughtResponseSchema } from '@/config/schemas/zod/thought.zod';
import { TopicsResponseSchema } from '@/config/schemas/zod/topics.zod';
import { VersesResponseSchema } from '@/config/schemas/zod/verses.zod';

import type { z } from 'zod';

const STRUCTURED_OUTPUT_SCHEMAS: Array<[string, z.ZodType]> = [
  ['thought', ThoughtResponseSchema],
  ['insights', InsightsResponseSchema],
  ['topics', TopicsResponseSchema],
  ['verses', VersesResponseSchema],
  ['section_hints', SectionHintsResponseSchema],
  ['sermon_points', SermonPointsResponseSchema],
  ['compose_plan_from_scratch', ComposePlanResponseSchema],
  ['brainstorm', BrainstormSuggestionSchema],
  ['polishTranscription', PolishTranscriptionSchema],
  ['sorting', SortingResponseSchema],
  ['speech_optimization', SpeechOptimizationResponseSchema],
  ['studyNoteAnalysis', StudyNoteAnalysisSchema],
];

type GeneratedSchema = { json_schema: { schema: Record<string, unknown> } };

function definitionsOf(generated: GeneratedSchema): Record<string, unknown> {
  const schema = generated.json_schema.schema;
  return (schema.definitions ?? schema.$defs ?? {}) as Record<string, unknown>;
}

function selfReferentialDefinitions(generated: GeneratedSchema): string[] {
  return Object.entries(definitionsOf(generated))
    .filter(([name, body]) => JSON.stringify(body).includes(`/${name}"`))
    .map(([name]) => name);
}

describe('structured-output schemas stay provider-compilable', () => {
  it.each(STRUCTURED_OUTPUT_SCHEMAS)(
    '%s generates no self-referential definition',
    (name, schema) => {
      const generated = zodResponseFormat(schema, name) as unknown as GeneratedSchema;

      expect(selfReferentialDefinitions(generated)).toEqual([]);
    }
  );

  it('detects a cycle when one is introduced (the guard can actually fail)', () => {
    // Reproduces the exact construct that broke production. The trigger is narrower than
    // "an optional field": the SAME object must be REUSED in several places, which makes
    // the converter hoist it into `definitions` — and only then does the optional parser
    // emit a $ref pointing at the very definition it is describing.
    // One array alone does not reproduce it; three sharing one item type does, which is
    // exactly the shape composePlan had (introduction / main / conclusion).
    const zod = jest.requireActual('zod') as typeof import('zod');
    const item = zod.z.object({ id: zod.z.string(), maybe: zod.z.string().optional() });
    const cyclic = zod.z.object({
      introduction: zod.z.array(item),
      main: zod.z.array(item),
      conclusion: zod.z.array(item),
    });

    const generated = zodResponseFormat(cyclic, 'cyclic_probe') as unknown as GeneratedSchema;

    expect(selfReferentialDefinitions(generated).length).toBeGreaterThan(0);
  });

  it('compose-plan asks for note keys, never raw ids or note text', () => {
    // The model echoed list ordinals instead of UUIDs in 4 of 5 measured runs, and the
    // whole response was discarded. Short keys make that unreachable; raw text echoing
    // cost 5287 wasted characters on a 25-note sermon.
    const generated = zodResponseFormat(
      ComposePlanResponseSchema,
      'compose_plan_from_scratch'
    ) as unknown as GeneratedSchema;
    const serialized = JSON.stringify(generated);

    expect(serialized).toContain('noteKey');
    expect(serialized).not.toContain('scratchNoteId');
    expect(serialized).not.toContain('"note"');
  });
});
