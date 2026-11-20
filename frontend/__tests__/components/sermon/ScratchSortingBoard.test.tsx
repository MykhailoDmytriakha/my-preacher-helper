import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ScratchSortingBoard from '@/components/sermon/scratch/ScratchSortingBoard';

import type { ScratchNote, SermonOutline } from '@/models/models';
import type { ComponentProps } from 'react';

jest.mock('@locales/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

const outline: SermonOutline = {
  introduction: [],
  main: [{ id: 'p1', text: 'Point one', subPoints: [{ id: 's1', text: 'Sub one', position: 1 }] }],
  conclusion: [],
};
const note = (id: string, place: Partial<ScratchNote> = {}): ScratchNote => ({ id, text: `Words of ${id}`, createdAt: '2026-11-19T00:00:00.000Z', ...place });
const notes: ScratchNote[] = [
  note('n1'),
  note('n2'),
  note('n3', { section: 'main', outlinePointId: 'p1' }),
  note('n4', { section: 'main', outlinePointId: 'p1', subPointId: 's1' }),
  note('n5', { section: 'main' }),
];

type Props = ComponentProps<typeof ScratchSortingBoard>;
function renderBoard(overrides: Partial<Props> = {}) {
  const props: Props = {
    notes,
    outline,
    capture: null,
    isReadOnly: false,
    pointThoughtCount: () => 0,
    renderText: (shown, editSignal) => <span data-signal={editSignal}>{shown.text}</span>,
    onDelete: jest.fn(),
    onPlace: jest.fn(),
    onCreatePoint: jest.fn(),
    onAddPoint: jest.fn(),
    onAddSubPoint: jest.fn(),
    onRemovePoint: jest.fn(),
    onRenameTitle: jest.fn(),
    onRemoveSubPoint: jest.fn(),
    ...overrides,
  };
  render(<ScratchSortingBoard {...props} />);
  return props;
}
const card = (id: string) => screen.getByTestId(`scratch-sketch-${id}`);
const plan = () => screen.getByRole('region', { name: 'scratch.sort.plan' });
const pointZone = () => within(plan()).getByLabelText('Point one', { selector: 'div' });
const subZone = () => within(plan()).getByLabelText('Sub one', { selector: 'div' });

describe('ScratchSortingBoard', () => {
  it('shows each note where it was filed, with the notes of a part without a point first', () => {
    renderBoard();
    const pool = screen.getByLabelText('scratch.sort.pool', { selector: 'div' });
    expect(within(pool).getByTestId('scratch-sketch-n1')).toBeInTheDocument();
    expect(within(pool).getByTestId('scratch-sketch-n2')).toBeInTheDocument();
    expect(within(subZone()).getByTestId('scratch-sketch-n4')).toBeInTheDocument();
    expect(within(pointZone()).getByTestId('scratch-sketch-n3')).toBeInTheDocument();
    const main = within(plan()).getByLabelText('structure.mainPart', { selector: 'div' });
    expect(within(main).getByTestId('scratch-sketch-n5')).toBeInTheDocument();
    expect(card('n5').compareDocumentPosition(pointZone()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('moves a note to the point chosen in «Move to…»', async () => {
    const user = userEvent.setup();
    const props = renderBoard();
    await user.click(within(card('n1')).getAllByRole('button', { name: 'scratch.sort.moveTo' })[0]);
    await user.click(await screen.findByRole('menuitem', { name: 'Point one' }));
    expect(props.onPlace).toHaveBeenCalledWith(['n1'], { section: 'main', pointId: 'p1', subPointId: null }, undefined);
  });

  it('collects ticked notes into a new point only once it has a title and a part', async () => {
    const user = userEvent.setup();
    const props = renderBoard();
    await user.click(within(card('n1')).getByRole('checkbox', { name: 'scratch.sort.select' }));
    await user.click(within(card('n2')).getByRole('checkbox', { name: 'scratch.sort.select' }));
    await user.click(screen.getByRole('button', { name: 'scratch.sort.collect' }));

    const parts = screen.getByRole('radiogroup', { name: 'scratch.sort.whichPart' });
    expect(within(parts).getAllByRole('radio').filter((radio) => radio.getAttribute('aria-checked') === 'true')).toHaveLength(0);
    const create = screen.getByRole('button', { name: 'scratch.sort.createPoint' });
    expect(create).toBeDisabled();
    await user.type(screen.getByPlaceholderText('scratch.sort.pointTitlePlaceholder'), 'Family first');
    expect(create).toBeDisabled();
    await user.click(within(parts).getByRole('radio', { name: 'structure.conclusion' }));
    expect(create).toBeEnabled();

    await user.click(create);
    expect(props.onCreatePoint).toHaveBeenCalledWith('conclusion', 'Family first', ['n1', 'n2']);
  });

  it('renames a point and a sub-point in place', async () => {
    const user = userEvent.setup();
    const props = renderBoard();
    await user.click(within(pointZone()).getByRole('button', { name: 'scratch.sort.renamePoint' }));
    const pointTitle = screen.getByRole('textbox', { name: 'scratch.sort.pointTitle' });
    await user.clear(pointTitle);
    await user.type(pointTitle, 'Point renamed{Enter}');
    expect(props.onRenameTitle).toHaveBeenCalledWith({ kind: 'point', id: 'p1' }, 'Point renamed');

    await user.click(within(subZone()).getByRole('button', { name: 'scratch.sort.renameSubPoint' }));
    const subTitle = screen.getByRole('textbox', { name: 'scratch.sort.subPointTitle' });
    await user.clear(subTitle);
    await user.type(subTitle, 'Sub renamed');
    await user.click(screen.getByRole('button', { name: 'scratch.card.save' }));
    expect(props.onRenameTitle).toHaveBeenCalledWith({ kind: 'subpoint', id: 's1' }, 'Sub renamed');
  });

  it('removes a sub-point and a point only after the question, and keeps them when it is declined', async () => {
    const user = userEvent.setup();
    const props = renderBoard({ pointThoughtCount: (pointId) => (pointId === 'p1' ? 2 : 0) });

    await user.click(within(subZone()).getByRole('button', { name: 'scratch.sort.removeSubPoint' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'common.cancel' }));
    expect(props.onRemoveSubPoint).not.toHaveBeenCalled();

    await user.click(within(subZone()).getByRole('button', { name: 'scratch.sort.removeSubPoint' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'common.delete' }));
    expect(props.onRemoveSubPoint).toHaveBeenCalledWith('s1');

    await user.click(within(pointZone()).getByRole('button', { name: 'scratch.sort.removePoint' }));
    const question = await screen.findByRole('dialog');
    // A point with thoughts on it says where they go instead of refusing.
    expect(within(question).getByText('scratch.sort.removePointWithThoughts')).toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: 'common.delete' }));
    expect(props.onRemovePoint).toHaveBeenCalledWith('p1');
  });

  it('opens a note for editing from its pencil and shows only the editing field meanwhile', async () => {
    const user = userEvent.setup();
    renderBoard({
      renderText: (shown, editSignal, onEditingChange) => (
        <span data-testid={`words-${shown.id}`} data-signal={editSignal}>
          {shown.text}
          <button type="button" onClick={() => onEditingChange(true)}>open-{shown.id}</button>
        </span>
      ),
    });
    await user.click(within(card('n1')).getByRole('button', { name: 'scratch.card.edit' }));
    expect(screen.getByTestId('words-n1')).toHaveAttribute('data-signal', '1');

    await user.click(screen.getByRole('button', { name: 'open-n1' }));
    expect(within(card('n1')).queryByRole('button', { name: 'scratch.card.edit' })).not.toBeInTheDocument();
    expect(within(card('n1')).queryByRole('button', { name: 'scratch.card.delete' })).not.toBeInTheDocument();
  });

  it('keeps the how-to behind the question mark', async () => {
    const user = userEvent.setup();
    renderBoard();
    expect(screen.queryByText('scratch.sort.poolHint')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'scratch.sort.howTo' }));
    expect(await screen.findByText('scratch.sort.poolHint')).toBeInTheDocument();
  });
});
