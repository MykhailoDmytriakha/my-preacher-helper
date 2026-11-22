import { generateNotePlanPoint } from '@/api/clients/openAI.client';
import { createNotePlanUserMessage, type NotePlanInput } from '@/config/prompts/user/notePlanTemplate';
import { callWithStructuredOutput } from '@/api/clients/structuredOutput';

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
  expect(result.contentByNodeId.p).toBe('Who will snatch them?\n\n**Conclusion:** No one.');
  expect(result.contentByNodeId.a).toBe('1. **The shepherd** — he holds them\n\n   *John 10:28: no one will snatch them*\n\n   - His words');
  expect(result.contentByNodeId.b).toBe('');
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
