import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NodeSketches, PlacedSketchesProvider } from '@/components/sermon/scratch/PlacedSketches';
import { StructureWriterContext, type StructureWriter } from '@/components/sermon/structureWriter';

import type { ScratchNote, SermonOutline } from '@/models/models';

jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, language: 'en' }) }));
jest.mock('@/components/bible/ScriptureLinks', () => ({ ScriptureText: ({ text }: { text: string }) => <>{text}</> }));

const outline: SermonOutline = {
  introduction: [],
  main: [{ id: 'p1', text: 'Point', note: 'Old glued reminder', subPoints: [{ id: 's1', text: 'Sub', position: 1 }] }],
  conclusion: [],
};
const notes: ScratchNote[] = [
  { id: 'a', text: 'On the point', createdAt: '2026-11-19', section: 'main', outlinePointId: 'p1' },
  { id: 'b', text: 'On the sub-point', createdAt: '2026-11-19', section: 'main', outlinePointId: 'p1', subPointId: 's1' },
  { id: 'c', text: 'Still in the pool', createdAt: '2026-11-19' },
];
const rejected = () => Promise.reject(new Error('unused'));

function renderNode(node: { kind: 'point' | 'subpoint'; id: string }, outlineNote?: { text?: string; onChange: jest.Mock }) {
  const writer: StructureWriter = {
    updateStructure: rejected, updateThought: rejected, deleteThought: rejected, createManualThought: rejected, updateSermonOutline: rejected,
    addSketch: jest.fn(() => Promise.resolve()), editSketch: jest.fn(() => Promise.resolve()), deleteSketch: jest.fn(() => Promise.resolve()),
  };
  render(
    <StructureWriterContext.Provider value={writer}>
      <PlacedSketchesProvider notes={notes} outline={outline}>
        <div data-testid="node"><NodeSketches node={node} outlineNote={outlineNote} /></div>
      </PlacedSketchesProvider>
    </StructureWriterContext.Provider>,
  );
  return writer;
}

describe('NodeSketches', () => {
  it('shows the old reminder first and then each note filed on the node, all as reminders', () => {
    renderNode({ kind: 'point', id: 'p1' }, { text: 'Old glued reminder', onChange: jest.fn() });
    const node = within(screen.getByTestId('node'));
    const texts = node.getAllByText(/Old glued reminder|On the point/).map((element) => element.textContent);
    expect(texts).toEqual(['Old glued reminder', 'On the point']);
    expect(node.queryByText('On the sub-point')).not.toBeInTheDocument();
    expect(node.queryByText('Still in the pool')).not.toBeInTheDocument();
  });

  it('adds a new note as a piece of its own, never into the old reminder', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const writer = renderNode({ kind: 'subpoint', id: 's1' }, { text: undefined, onChange });
    await user.click(screen.getByRole('button', { name: 'scratch.node.label' }));
    await user.type(screen.getByRole('textbox'), 'A second thing to say{Enter}');
    expect(writer.addSketch).toHaveBeenCalledWith({ kind: 'subpoint', id: 's1' }, 'A second thing to say');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('deletes a filed note only after the question', async () => {
    const user = userEvent.setup();
    const writer = renderNode({ kind: 'subpoint', id: 's1' });
    const piece = within(screen.getByTestId('node-sketch-b'));
    await user.click(piece.getByRole('button', { name: 'scratch.node.delete' }));
    expect(writer.deleteSketch).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /delete/i }));
    expect(writer.deleteSketch).toHaveBeenCalledWith('b');
  });
});
