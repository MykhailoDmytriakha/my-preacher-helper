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

it('keeps full source and orders nodes by position with stable IDs despite duplicate titles', () => {
  const message = JSON.parse(createNotePlanUserMessage(input));
  expect(message.targetNodes.map((node: { nodeId: string }) => node.nodeId)).toEqual(['p', 'a', 'b']);
  expect(message.targetNodes[0].reminder).toBe('Keep the uncertainty');
  expect(message.sourceNotes[0].content).toBe(input.notes[0].content);
  expect(message.supplementalThoughts).toEqual([]);
});

it('assembles the existing cue format into separate cells and exposes missing evidence', async () => {
  jest.mocked(callWithStructuredOutput).mockResolvedValue({ success: true, data: { nodes: [
    { nodeId: 'b', turn: null, cues: [], refs: [], missingMaterial: 'No example in the study' },
    { nodeId: 'p', turn: 'ask -> receive', cues: [], refs: [], missingMaterial: null },
    { nodeId: 'a', turn: null, cues: ['His words'], refs: ['John 10: no one will snatch them'], missingMaterial: null },
  ] } } as never);
  const result = await generateNotePlanPoint(input, 'narrative', 'owner');
  expect(result.contentByNodeId.p).toBe('**→ ask → receive**');
  expect(result.contentByNodeId.a).toBe('- His words\n\n*John 10: no one will snatch them*');
  expect(result.contentByNodeId.b).toBe('');
  expect(result.missingMaterial.b).toContain('No example');
  expect(callWithStructuredOutput).toHaveBeenCalledWith(expect.stringContaining('Preserve uncertainty'), expect.any(String), expect.anything(), expect.objectContaining({ userId: 'owner' }));
});

it.each([['p', 'a', 'a'], ['p', 'a', 'foreign'], ['p']])('rejects incomplete, duplicate or foreign node IDs: %j', async (...ids) => {
  jest.mocked(callWithStructuredOutput).mockResolvedValue({ success: true, data: { nodes: ids.map((nodeId) => ({ nodeId, turn: null, cues: [], refs: [], missingMaterial: null })) } } as never);
  await expect(generateNotePlanPoint(input, 'memory', 'owner')).rejects.toThrow('requested nodes');
});

it('rejects a provider refusal', async () => {
  jest.mocked(callWithStructuredOutput).mockResolvedValue({ success: false, data: null } as never);
  await expect(generateNotePlanPoint(input, 'memory', 'owner')).rejects.toThrow('generation failed');
});
