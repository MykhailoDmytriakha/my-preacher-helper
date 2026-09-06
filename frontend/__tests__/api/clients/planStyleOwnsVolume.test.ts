import { generateNotePlanPoint, generatePlanPointContent } from '@/api/clients/openAI.client';
import { PlanCueGroupSchema } from '@/config/schemas/zod/planPointContent.zod';

import type { NotePlanInput } from '@/config/prompts/user/notePlanTemplate';
import type { PlanStyle } from '@/api/clients/planTypes';

jest.mock('@clients/structuredOutput', () => ({
  callWithStructuredOutput: jest.fn(),
}));

/**
 * ONLY THE PLAN LENGTH SETTING MAY SAY HOW MANY CUES TO PRODUCE.
 *
 * "Plan volume" (SHORT / MEDIUM / DETAILED) asks for 2-4, 4-7 and 10-18 cue lines. It was
 * reaching the model — measured: the POST body carried `style: "exegetical"` and the style
 * block was in the system prompt — and it changed nothing, because the SAME request also
 * said "2-5 cues" twice: in the `cues` schema description and in the cue line of the plan
 * point system prompt. A field description is part of the JSON contract and outweighs a
 * sentence in the prompt, so every style landed on 5 cues: Short gave 5 (710 chars),
 * Detailed gave 5 (546 chars).
 *
 * The prompt file already knew the rule — its own DENSITY section says the plan length
 * instructions control how many cues per group. It just contradicted itself one line above.
 *
 * So the invariant is not "the style is passed" (it was) but: the count is stated in ONE
 * place. These tests read the prompt that actually gets sent.
 */

const structuredOutput = () =>
  jest.requireMock('@clients/structuredOutput') as { callWithStructuredOutput: jest.Mock };

/** The volume ranges each style asks for — see `getStyleInstructions`. */
const STYLE_TARGET: Record<PlanStyle, string> = {
  memory: '2-4',
  narrative: '4-7',
  exegetical: '10-18',
};

const noteInput = (): NotePlanInput => ({
  title: 'A sermon in progress',
  verse: '1 Chronicles 4:9-10',
  section: 'introduction',
  point: { id: 'p1', text: 'Who stood out' } as NotePlanInput['point'],
  outline: [{ section: 'introduction', title: 'Who stood out', subPoints: [] }],
  notes: [{ id: 'n1', title: 'Jabez', content: 'He called on the God of Israel', scriptureRefs: [] }],
  thoughts: [],
});

/** Ranges stated anywhere in the text, e.g. "2-5" or "10–18". */
const ranges = (text: string) => text.match(/\b\d{1,2}\s*[-–]\s*\d{1,2}\b/g) ?? [];

const capturedSystemPrompt = (): string => {
  const call = structuredOutput().callWithStructuredOutput.mock.calls[0];
  expect(call).toBeDefined();
  return call[0] as string;
};

beforeEach(() => {
  jest.clearAllMocks();
  structuredOutput().callWithStructuredOutput.mockResolvedValue({
    success: true,
    data: { nodes: [{ nodeId: 'p1', turn: null, cues: [], refs: [], missingMaterial: null }] },
    refusal: null,
  });
});

describe('the plan length setting is the only thing that states cue volume', () => {
  it('does not put a cue count in the schema field description', () => {
    const description = PlanCueGroupSchema.shape.cues.description ?? '';

    expect(description).not.toBe('');
    // The valuable half — "in the author's own words" — must stay; only the number goes.
    expect(ranges(description)).toEqual([]);
  });

  it.each(['memory', 'narrative', 'exegetical'] as const)(
    'sends the %s target, and no competing count on the cue line, to the note editor',
    async (style) => {
      await generateNotePlanPoint(noteInput(), style, 'user-1');
      const systemPrompt = capturedSystemPrompt();

      expect(systemPrompt).toContain(STYLE_TARGET[style]);

      const cueLine = systemPrompt
        .split('\n')
        .filter((line) => /\bcues\b/.test(line) && !/PLAN LENGTH/i.test(line));
      cueLine.forEach((line) => expect(ranges(line)).toEqual([]));
    }
  );

  it.each(['memory', 'narrative', 'exegetical'] as const)(
    'sends the %s target, and no competing count on the cue line, to the paired editor',
    async (style) => {
      structuredOutput().callWithStructuredOutput.mockResolvedValue({
        success: true,
        data: { groups: [{ heading: null, cues: ['a'], refs: [] }], turn: null },
        refusal: null,
      });

      await generatePlanPointContent(
        'A sermon in progress',
        '1 Chronicles 4:9-10',
        'Who stood out',
        ['A thought about who stood out'],
        'introduction',
        [],
        undefined,
        style,
        undefined,
        'user-1'
      );
      const systemPrompt = capturedSystemPrompt();

      expect(systemPrompt).toContain(STYLE_TARGET[style]);

      /**
       * The line that tells the model what `cues` is must carry no number of its own. Other
       * ranges in this prompt are about different things and stay: "5-7 key words" describes
       * one reference, and "Еф. 2:20-22" is a Bible reference inside an example.
       */
      const cueLines = systemPrompt
        .split('\n')
        .filter((line) => /^-\s*cues:/.test(line.trim()));

      expect(cueLines.length).toBeGreaterThan(0);
      cueLines.forEach((line) => expect(ranges(line)).toEqual([]));
    }
  );

  /**
   * A cap does not have to be a number. The note prompt opened with "short concrete memory
   * anchors, not an essay" — unconditional, on every style — and that alone held DETAILED
   * down to 6 cues after the numeric caps were gone. So each prompt must name the plan
   * length block as the authority on volume, out loud.
   */
  it.each([
    ['note editor', async () => { await generateNotePlanPoint(noteInput(), 'exegetical', 'user-1'); }],
    ['paired editor', async () => {
      await generatePlanPointContent(
        'A sermon in progress', '1 Chronicles 4:9-10', 'Who stood out',
        ['A thought about who stood out'], 'introduction', [], undefined, 'exegetical', undefined, 'user-1'
      );
    }],
  ] as const)('tells the %s that volume is set by the plan length block', async (_name, run) => {
    await run();

    expect(capturedSystemPrompt()).toMatch(/PLAN LENGTH/);
  });

  /**
   * The examples show what the FIELDS look like, not how much to write. Each carries 3-5
   * cues, which quietly pulls DETAILED back down to SHORT, so the prompt has to say out
   * loud that their length is not the target.
   */
  it('tells the model the examples show shape, not volume', async () => {
    await generatePlanPointContent(
      'A sermon in progress',
      '1 Chronicles 4:9-10',
      'Who stood out',
      ['A thought about who stood out'],
      'introduction',
      [],
      undefined,
      'exegetical',
      undefined,
      'user-1'
    );

    expect(capturedSystemPrompt()).toMatch(/examples?[^\n]*\bshape\b[^\n]*\bnot\b[^\n]*volume/i);
  });
});
