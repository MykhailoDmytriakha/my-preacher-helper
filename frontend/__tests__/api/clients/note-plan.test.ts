import { generateNotePlanPoint } from '@/api/clients/openAI.client';
import { createNotePlanUserMessage, notePlanSystemPrompt, type NotePlanInput } from '@/config/prompts/user/notePlanTemplate';
import { callWithStructuredOutput } from '@/api/clients/structuredOutput';
import { notePlanSketchSteps } from '@/utils/notePlan';

jest.mock('@/api/clients/structuredOutput', () => ({ callWithStructuredOutput: jest.fn() }));

const input: NotePlanInput = {
  title: 'Title', verse: 'John 10', section: 'main', outline: [],
  point: { id: 'p', text: 'Same title', note: 'Keep the uncertainty', subPoints: [
    { id: 'b', text: 'Same title', note: 'Second', position: 2 }, { id: 'a', text: 'Same title', position: 1 },
  ] },
  notes: [{ id: 'n', title: 'Study', content: 'Probably, not certainly. Full study.', scriptureRefs: [] }], thoughts: [],
};

beforeEach(() => jest.resetAllMocks());

/** A node of the v5 answer: the parts of a point (`utils/notePlanMarkdown.ts`), empty unless given. */
const node = (nodeId: string, parts: Record<string, unknown> = {}) => ({
  nodeId, entry: null, refs: [], table: null, steps: [], conclusion: null, missingMaterial: null, ...parts,
});
const step = (title: string, refs: string[] = [], thoughts: string[] = [], gist: string | null = null) => ({ title, gist, refs, thoughts });

it('keeps full source and orders nodes by position with stable IDs despite duplicate titles', () => {
  const message = JSON.parse(createNotePlanUserMessage(input));
  expect(message.targetNodes.map((node: { nodeId: string }) => node.nodeId)).toEqual(['p', 'a', 'b']);
  expect(message.targetNodes[0].reminder).toBe('Keep the uncertainty');
  expect(message.sourceNotes[0].content).toBe(input.notes[0].content);
  expect(message.supplementalThoughts).toEqual([]);
});

it('assembles each cell in the plan shape — entry, steps on their verses, conclusion — and exposes missing evidence', async () => {
  jest.mocked(callWithStructuredOutput).mockResolvedValue({ success: true, data: { nodes: [
    node('b', { missingMaterial: 'No example in the study' }),
    node('p', { entry: 'Who will snatch them?', conclusion: 'No one.' }),
    node('a', { steps: [step('The shepherd', ['John 10:28: no one will snatch them'], ['His words'], 'he holds them')] }),
  ] } } as never);
  const result = await generateNotePlanPoint(input, 'narrative', 'owner');
  expect(result.contentByNodeId.p).toBe('Who will snatch them?');
  expect(result.contentByNodeId.a).toBe('1. **The shepherd** — he holds them\n\n   *John 10:28: no one will snatch them*\n\n   - His words');
  // The point's conclusion closes it after its last sub-point (owner, 2026-11-22).
  expect(result.contentByNodeId.b).toBe('**Conclusion:** No one.');
  expect(result.missingMaterial.b).toContain('No example');
  expect(callWithStructuredOutput).toHaveBeenCalledWith(expect.stringContaining('Preserve uncertainty'), expect.any(String), expect.anything(), expect.objectContaining({ userId: 'owner' }));
});

it.each([['p', 'a', 'a'], ['p', 'a', 'foreign'], ['p']])('rejects incomplete, duplicate or foreign node IDs: %j', async (...ids) => {
  jest.mocked(callWithStructuredOutput).mockResolvedValue({ success: true, data: { nodes: ids.map((nodeId) => node(nodeId)) } } as never);
  await expect(generateNotePlanPoint(input, 'memory', 'owner')).rejects.toThrow('requested nodes');
});

it('rejects a provider refusal', async () => {
  jest.mocked(callWithStructuredOutput).mockResolvedValue({ success: false, data: null } as never);
  await expect(generateNotePlanPoint(input, 'memory', 'owner')).rejects.toThrow('generation failed');
});

it('requests and returns only the selected child while retaining the full study and parent context', async () => {
  const selected = { ...input, targetNodeId: 'a' };
  const message = JSON.parse(createNotePlanUserMessage(selected));
  expect(message.targetNodes).toEqual([{ nodeId: 'a', title: 'Same title', reminder: '', kind: 'subPoint' }]);
  expect(message.parentContext).toEqual({ title: input.point.text, reminder: input.point.note });
  expect(message.sourceNotes).toEqual(input.notes);
  jest.mocked(callWithStructuredOutput).mockResolvedValue({ success: true, data: { nodes: [
    node('a', { steps: [step('Only this child')] }),
  ] } } as never);
  expect(await generateNotePlanPoint(selected, 'memory', 'owner')).toEqual({ contentByNodeId: { a: '1. **Only this child**' }, missingMaterial: {} });
});

it('rejects extra parent content from a single-child generation', async () => {
  jest.mocked(callWithStructuredOutput).mockResolvedValue({ success: true, data: { nodes: ['a', 'p'].map((nodeId) => ({
    ...node(nodeId), steps: [step('Unexpected expansion')],
  })) } } as never);
  await expect(generateNotePlanPoint({ ...input, targetNodeId: 'a' }, 'memory', 'owner')).rejects.toThrow('requested nodes');
});

it('refuses an unknown target before calling the provider', async () => {
  await expect(generateNotePlanPoint({ ...input, targetNodeId: 'foreign' }, 'memory', 'owner')).rejects.toThrow('requested nodes');
  expect(callWithStructuredOutput).not.toHaveBeenCalled();
});

it('includes current unsaved text and the requested edit in the prompt', () => {
  const revision = { instruction: 'Keep the opening, add examples', mode: 'edit' as const, currentContentByNodeId: { a: 'Unsaved draft' } };
  const message = JSON.parse(createNotePlanUserMessage({ ...input, targetNodeId: 'a', revision }));
  expect(message.revision).toEqual(revision);
  expect(message.targetNodes.map((node: { nodeId: string }) => node.nodeId)).toEqual(['a']);
});

it('mechanically preserves the main text for references-only requests even if the model rewrites it', async () => {
  jest.mocked(callWithStructuredOutput).mockResolvedValue({ success: true, data: { nodes: [
    node('a', { entry: 'Unwanted rewrite', steps: [step('Unwanted', ['John 10:2: supplied verse'], ['Unwanted new cue'])] }),
  ] } } as never);
  const result = await generateNotePlanPoint({ ...input, targetNodeId: 'a', revision: {
    mode: 'references', instruction: 'Improve references', currentContentByNodeId: { a: '**→ Original turn**\n\n- Exact original cue\n\n*John 10:1: old*' },
  } }, 'memory', 'owner');
  expect(result.contentByNodeId.a).toBe('**→ Original turn**\n\n- Exact original cue\n\n*John 10:2: supplied verse*');
});

it('keeps existing references when the study cannot supply a replacement', async () => {
  jest.mocked(callWithStructuredOutput).mockResolvedValue({ success: true, data: { nodes: [
    node('a', { missingMaterial: 'No evidence' }),
  ] } } as never);
  const result = await generateNotePlanPoint({ ...input, targetNodeId: 'a', revision: {
    mode: 'references', instruction: 'Improve references', currentContentByNodeId: { a: 'Existing text and references' },
  } }, 'memory', 'owner');
  expect(result.contentByNodeId.a).toBe('Existing text and references');
  expect(result.missingMaterial.a).toBe('No evidence');
});

it('replaces each step\'s verses inside that step and keeps every word the preacher wrote', async () => {
  const current = [
    'Why did they go together?',
    '1. **Ruth** — she stays',
    '   *Ruth 1:15: old*',
    '   - Her own words',
    '2. **Orpah** — she goes back',
    '   *Ruth 1:14: old too*',
    '**Conclusion:** Choose.',
  ].join('\n\n');
  jest.mocked(callWithStructuredOutput).mockResolvedValue({ success: true, data: { nodes: [
    node('a', { entry: 'Rewritten entry', steps: [step('Ruth', ['Ruth 1:16: thy people shall be my people'], ['Rewritten']), step('Orpah', ['Ruth 1:14: Orpah kissed her mother in law'])] }),
  ] } } as never);
  const result = await generateNotePlanPoint({ ...input, targetNodeId: 'a', revision: {
    mode: 'references', instruction: 'Better verses', currentContentByNodeId: { a: current },
  } }, 'memory', 'owner');
  expect(result.contentByNodeId.a).toBe(current
    .replace('Ruth 1:15: old', 'Ruth 1:16: thy people shall be my people')
    .replace('Ruth 1:14: old too', 'Ruth 1:14: Orpah kissed her mother in law'));
});

it('says why a references-only answer changed nothing, when its verses found no step to stand under', async () => {
  const current = '1. **Ruth** — she stays\n\n   *Ruth 1:15: old*';
  jest.mocked(callWithStructuredOutput).mockResolvedValue({ success: true, data: { nodes: [
    node('a', { steps: [step('Naomi', ['Ruth 1:20: call me Mara'])] }),
  ] } } as never);
  const result = await generateNotePlanPoint({ ...input, targetNodeId: 'a', language: 'en', revision: {
    mode: 'references', instruction: 'Better verses', currentContentByNodeId: { a: current },
  } }, 'memory', 'owner');
  expect(result.contentByNodeId.a).toBe(current);
  expect(result.missingMaterial.a).toMatch(/could not be placed/);
});

// Owner on production, 2026-11-22: «вывод пошёл почему-то вверху, а должен быть в конце, после двух подпунктов».
describe('the conclusion closes the whole point, so it stands at the end of its last cell', () => {
  const answer = (nodes: ReturnType<typeof node>[]) => jest.mocked(callWithStructuredOutput).mockResolvedValue({ success: true, data: { nodes } } as never);

  it('moves the point\'s conclusion after its last sub-point, and drops the sub-points\' own', async () => {
    answer([
      node('p', { entry: 'Why?', conclusion: 'Whole point.' }),
      node('a', { steps: [step('First', [], ['x'])], conclusion: 'Only a.' }),
      node('b', { steps: [step('Second', [], ['y'])], conclusion: 'Only b.' }),
    ]);
    const result = await generateNotePlanPoint(input, 'exegetical', 'owner');
    expect(result.contentByNodeId.p).toBe('Why?');
    expect(result.contentByNodeId.a).not.toContain('Conclusion');
    expect(result.contentByNodeId.b).toBe('1. **Second**\n\n   - y\n\n**Conclusion:** Whole point.');
  });

  it('writes no conclusion into a point cell generated alone when its sub-points close it', async () => {
    answer([node('p', { entry: 'Why?', conclusion: 'Whole point.' })]);
    expect((await generateNotePlanPoint({ ...input, targetNodeId: 'p' }, 'memory', 'owner')).contentByNodeId.p).toBe('Why?');
  });

  it('keeps it in the last sub-point generated alone, and in a point with no sub-points', async () => {
    answer([node('b', { steps: [step('Second')], conclusion: 'Closing.' })]);
    expect((await generateNotePlanPoint({ ...input, targetNodeId: 'b' }, 'memory', 'owner')).contentByNodeId.b).toContain('**Conclusion:** Closing.');
    answer([node('a', { steps: [step('First')], conclusion: 'Middle.' })]);
    expect((await generateNotePlanPoint({ ...input, targetNodeId: 'a' }, 'memory', 'owner')).contentByNodeId.a).not.toContain('Conclusion');
    answer([node('p', { entry: 'Why?', conclusion: 'Alone.' })]);
    const single = { ...input, point: { ...input.point, subPoints: [] } };
    expect((await generateNotePlanPoint(single, 'memory', 'owner')).contentByNodeId.p).toBe('Why?\n\n**Conclusion:** Alone.');
  });
});

// Owner on production, 2026-11-22: «выбрал коротко, но сгенерировалось некоротко» — the model ignored SHORT.
describe('the plan length holds whatever the model returns', () => {
  const many = (count: number) => Array.from({ length: count }, (_, index) => `thought ${index + 1}`);
  const single = { ...input, point: { ...input.point, subPoints: [] } };
  const thoughtsIn = (markdown: string) => (markdown.match(/^\s+- /gm) ?? []).length;

  it.each([['memory', 1], ['narrative', 3], ['exegetical', 5]] as const)('%s keeps at most %i thoughts a step, the first ones', async (style, most) => {
    jest.mocked(callWithStructuredOutput).mockResolvedValue({ success: true, data: { nodes: [node('p', { steps: [step('One', [], many(7))] })] } } as never);
    const markdown = (await generateNotePlanPoint(single, style, 'owner')).contentByNodeId.p;
    expect(thoughtsIn(markdown)).toBe(most);
    expect(markdown).toContain('thought 1');
  });

  it('lets a written request for more thoughts outweigh the length', async () => {
    jest.mocked(callWithStructuredOutput).mockResolvedValue({ success: true, data: { nodes: [node('p', { steps: [step('One', [], many(4))] })] } } as never);
    const result = await generateNotePlanPoint({ ...single, revision: { mode: 'edit', instruction: 'More thoughts', currentContentByNodeId: { p: 'old' } } }, 'memory', 'owner');
    expect(thoughtsIn(result.contentByNodeId.p)).toBe(4);
  });
});

describe('the conclusion rule leaves what it must not touch (Codex check, 2026-11-22)', () => {
  it('keeps a conclusion an edit of a middle sub-point preserves', async () => {
    jest.mocked(callWithStructuredOutput).mockResolvedValue({ success: true, data: { nodes: [node('a', { entry: 'The shepherd is near.', conclusion: 'A shepherd stays.' })] } } as never);
    const result = await generateNotePlanPoint({ ...input, targetNodeId: 'a', revision: { mode: 'edit', instruction: 'Change the opening', currentContentByNodeId: { a: 'The shepherd is here.\n\n**Conclusion:** A shepherd stays.' } } }, 'memory', 'owner');
    expect(result.contentByNodeId.a).toContain('**Conclusion:** A shepherd stays.');
  });

  it('never lets a sub-point\'s line close the whole point when the point has none', async () => {
    jest.mocked(callWithStructuredOutput).mockResolvedValue({ success: true, data: { nodes: [
      node('p', { entry: 'Two women.' }), node('a', { steps: [step('Ruth')] }), node('b', { steps: [step('Orpah')], conclusion: 'Orpah went home.' }),
    ] } } as never);
    expect((await generateNotePlanPoint(input, 'memory', 'owner')).contentByNodeId.b).not.toContain('Orpah went home');
  });
});

// Owner on production, 2026-11-22: a sketch of three «name: places» lines came back as a table of the people in them.
it('tells the model that a sketch listing names with places is steps, in order, and never a table', () => {
  expect(notePlanSystemPrompt).toContain('REMINDER LINES ARE STEPS');
  expect(notePlanSystemPrompt).toMatch(/reminder lines that list names with places are steps/);
});


describe('a sketch that is the steps travels as its own field (owner on production, 2026-11-22)', () => {
  const CLOTHING = ['Одежда первосвященика: Исх.28:2,40 = Пс.8:6 (Скиния - образ Эдемского сада)', 'Одежда торжественная: Зах.3:1-4', 'Одежда правды: Ис.61:10'];

  it('reads every «name: places» line as a step, in order', () => {
    expect(notePlanSketchSteps(CLOTHING.join('\n'))).toEqual([
      { title: 'Одежда первосвященика', places: 'Исх.28:2,40 = Пс.8:6 (Скиния - образ Эдемского сада)' },
      { title: 'Одежда торжественная', places: 'Зах.3:1-4' },
      { title: 'Одежда правды', places: 'Ис.61:10' },
    ]);
  });

  it('gives none for audiences paired in a line, a second name in a line, a mixed sketch or a single line', () => {
    expect(notePlanSketchSteps('Братья: Еф. 5:25; Сестры: Еф. 5:22\nМужья: 1 Пет 3:7; Жены: 1 Пет 3:1')).toEqual([]);
    expect(notePlanSketchSteps('Листья: Быт.3:7 vs Одежды кожаные: Быт.3:21\nСвятой обмен: 2Кор.5:21')).toEqual([]);
    expect(notePlanSketchSteps('Святой обмен: 2Кор.5:21\nЛистья vs Одежда кожаная: наша праведность')).toEqual([]);
    expect(notePlanSketchSteps('Одежда правды: Ис.61:10')).toEqual([]);
  });

  it('puts the steps on the target node of the request', () => {
    const message = JSON.parse(createNotePlanUserMessage({ ...input, point: { ...input.point, note: undefined, subPoints: [] }, filed: { p: CLOTHING } }));
    expect(message.targetNodes[0].sketchSteps.map((step: { title: string }) => step.title)).toEqual(['Одежда первосвященика', 'Одежда торжественная', 'Одежда правды']);
    expect(JSON.parse(createNotePlanUserMessage(input)).targetNodes[0].sketchSteps).toBeUndefined();
  });
});

it('reads a pair split by «/» as a table row and a time code as no place (Codex check)', () => {
  expect(notePlanSketchSteps('Мужья: Еф. 5:25 (любовь) / Жёны: Тит. 2:4 (любовь)\nМужья: 1 Пет. 3:7 (уважение) / Жёны: Еф. 5:33 (уважение)')).toEqual([]);
  expect(notePlanSketchSteps('Иллюстрация: фрагмент интервью с 02:15 до 02:40\nОбетование: Пс. 33:19')).toEqual([]);
  expect(notePlanSketchSteps('Одежда правды: Ис.61:10: «Он облёк меня»\nОдежда торжественная: Зах.3:1-4')).toHaveLength(2);
});
