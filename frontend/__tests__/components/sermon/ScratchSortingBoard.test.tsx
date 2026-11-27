import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ScratchSortingBoard, { resetPoolPanelForTests } from '@/components/sermon/scratch/ScratchSortingBoard';

import type { DndContext, DragEndEvent } from '@dnd-kit/core';
import type { ScratchNote, SermonOutline } from '@/models/models';
import type { ComponentProps } from 'react';

jest.mock('@locales/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

let mockDndProps: ComponentProps<typeof DndContext>;
jest.mock('@dnd-kit/core', () => {
  const actual = jest.requireActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    DndContext: (props: ComponentProps<typeof DndContext>) => {
      mockDndProps = props;
      return <actual.DndContext {...props} />;
    },
  };
});

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
function boardProps(overrides: Partial<Props> = {}): Props {
  return {
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
}
function renderBoard(overrides: Partial<Props> = {}) {
  const props = boardProps(overrides);
  render(<ScratchSortingBoard {...props} />);
  return props;
}
function renderBoardWithRerender(overrides: Partial<Props> = {}) {
  const props = boardProps(overrides);
  const { rerender, unmount } = render(<ScratchSortingBoard {...props} />);
  return { rerender, unmount, props };
}
const card = (id: string) => screen.getByTestId(`scratch-sketch-${id}`);
const plan = () => screen.getByRole('region', { name: 'scratch.sort.plan' });
const pointZone = () => within(plan()).getByLabelText('Point one', { selector: 'div' });
const subZone = () => within(plan()).getByLabelText('Sub one', { selector: 'div' });

const dragEvent = (overId?: string): DragEndEvent => ({
  active: { id: 'n5', data: { current: undefined }, rect: { current: { initial: null, translated: null } } },
  activatorEvent: new MouseEvent('mousedown', { clientX: 40, clientY: 40 }),
  collisions: null,
  delta: { x: 0, y: 0 },
  over: overId ? { id: overId, rect: card('n5').getBoundingClientRect(), disabled: false, data: { current: undefined } } : null,
});
const startDrag = () => act(() => mockDndProps.onDragStart?.(dragEvent()));
const endDrag = (overId?: string) => act(() => mockDndProps.onDragEnd?.(dragEvent(overId)));
const cancelDrag = () => act(() => mockDndProps.onDragCancel?.(dragEvent()));
const mockCardRect = (id: string, top: number, height: number) => {
  const cardNode = card(id);
  jest.spyOn(cardNode, 'getBoundingClientRect').mockReturnValue({
    ...cardNode.getBoundingClientRect(),
    top,
    left: height ? 20 : 0,
    width: height ? 100 : 0,
    height,
  });
};

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
    const note = card('n1');
    const move = within(note).getAllByRole('button', { name: 'scratch.sort.moveTo' })[0];
    const edit = within(note).getByRole('button', { name: 'scratch.card.edit' });
    expect(note).toHaveClass('row');
    expect(move.closest('.actions')).toContainElement(edit);
    await user.click(move);
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
    const renamePoint = within(pointZone()).getByRole('button', { name: 'scratch.sort.renamePoint' });
    const pointRow = renamePoint.closest('.row');
    expect(pointRow).toContainElement(within(pointZone()).getByText('Point one', { exact: true }));
    expect(renamePoint.closest('.actions')).toContainElement(within(pointZone()).getByRole('button', { name: 'scratch.sort.removePoint' }));
    await user.click(renamePoint);
    const pointTitle = screen.getByRole('textbox', { name: 'scratch.sort.pointTitle' });
    await user.clear(pointTitle);
    await user.type(pointTitle, 'Point renamed{Enter}');
    expect(props.onRenameTitle).toHaveBeenCalledWith({ kind: 'point', id: 'p1' }, 'Point renamed');

    const renameSubPoint = within(subZone()).getByRole('button', { name: 'scratch.sort.renameSubPoint' });
    const subPointRow = renameSubPoint.closest('.row');
    expect(subPointRow).toContainElement(within(subZone()).getByText('Sub one', { exact: true }));
    expect(renameSubPoint.closest('.actions')).toContainElement(within(subZone()).getByRole('button', { name: 'scratch.sort.removeSubPoint' }));
    await user.click(renameSubPoint);
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

  describe('folding the pool into a rail', () => {
    beforeEach(() => {
      window.localStorage.clear();
      resetPoolPanelForTests();
    });

    it('folds into a rail with the count and the two ways to start a note, and shows again', async () => {
      const user = userEvent.setup();
      renderBoard();

      await user.click(screen.getByRole('button', { name: 'scratch.sort.hidePool' }));

      const pool = screen.getByLabelText('scratch.sort.pool', { selector: 'div' });
      expect(within(pool).getByRole('button', { name: 'scratch.sort.showPool' })).toBeInTheDocument();
      expect(within(pool).getByRole('button', { name: 'audio.newRecording' })).toBeInTheDocument();
      expect(within(pool).getByRole('button', { name: 'scratch.capture.manualAdd' })).toBeInTheDocument();
      expect(within(pool).getByTitle('scratch.sort.tabPool')).toHaveTextContent('2');
      // Still one drop zone: the folded rail is the pool a note is dropped into.
      expect(screen.getAllByLabelText('scratch.sort.pool', { selector: 'div' })).toHaveLength(1);

      await user.click(within(pool).getByRole('button', { name: 'scratch.sort.showPool' }));
      expect(screen.queryByRole('button', { name: 'scratch.sort.showPool' })).not.toBeInTheDocument();
    });

    it('keeps the pool folded on this device for the next board', async () => {
      const user = userEvent.setup();
      const { unmount } = renderBoardWithRerender();
      await user.click(screen.getByRole('button', { name: 'scratch.sort.hidePool' }));
      expect(JSON.parse(window.localStorage.getItem('scratch:poolPanel') ?? '{}')).toMatchObject({ folded: true });

      // Another sermon's board, opened later on this device, starts folded.
      unmount();
      resetPoolPanelForTests();
      renderBoard();
      // The rail is drawn; the column stays mounted under it (only hidden by CSS on wide screens), so a phone still sees it.
      expect(screen.getByRole('button', { name: 'scratch.sort.showPool' })).toBeInTheDocument();
    });

    it('moves the keyboard to the paired button when it folds and shows', async () => {
      const user = userEvent.setup();
      renderBoard();

      await user.click(screen.getByRole('button', { name: 'scratch.sort.hidePool' }));
      expect(screen.getByRole('button', { name: 'scratch.sort.showPool' })).toHaveFocus();

      await user.click(screen.getByRole('button', { name: 'scratch.sort.showPool' }));
      expect(screen.getByRole('button', { name: 'scratch.sort.hidePool' })).toHaveFocus();
    });

    it('stays shown while a recording is under way and folds back once it is over', async () => {
      const user = userEvent.setup();
      const { rerender, props } = renderBoardWithRerender();
      await user.click(screen.getByRole('button', { name: 'scratch.sort.hidePool' }));

      rerender(<ScratchSortingBoard {...props} captureBusy />);
      // Nothing to fold while the recording is seen: no rail, no fold button.
      expect(screen.queryByRole('button', { name: 'scratch.sort.showPool' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'scratch.sort.hidePool' })).not.toBeInTheDocument();

      rerender(<ScratchSortingBoard {...props} captureBusy={false} />);
      expect(screen.getByRole('button', { name: 'scratch.sort.showPool' })).toBeInTheDocument();
    });

    it('says on the rail why the microphone cannot record', async () => {
      const user = userEvent.setup();
      const onRailCapture = jest.fn();
      renderBoard({ onRailCapture, railVoiceUnavailable: 'Voice notes are unavailable' });
      await user.click(screen.getByRole('button', { name: 'scratch.sort.hidePool' }));

      const mic = screen.getByRole('button', { name: 'audio.newRecording' });
      expect(mic).toBeDisabled();
      expect(mic).toHaveAttribute('title', 'Voice notes are unavailable');
    });

    it('starts a recording or a written note from the rail and opens the pool for it', async () => {
      const user = userEvent.setup();
      const onRailCapture = jest.fn();
      renderBoard({ onRailCapture });

      const choosePlanAndFold = async () => {
        await user.click(screen.getByRole('tab', { name: 'scratch.sort.tabPlan' }));
        await user.click(screen.getByRole('button', { name: 'scratch.sort.hidePool' }));
      };
      const poolTab = screen.getByRole('tab', { name: 'scratch.sort.tabPool' });
      await choosePlanAndFold();
      const mic = screen.getByRole('button', { name: 'audio.newRecording' });
      mic.focus();
      await user.keyboard('{Enter}');

      expect(onRailCapture).toHaveBeenCalledWith('voice');
      expect(screen.queryByRole('button', { name: 'scratch.sort.showPool' })).not.toBeInTheDocument();
      expect(poolTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('heading', { name: 'scratch.sort.pool' })).toHaveFocus();

      await choosePlanAndFold();
      await user.click(screen.getByRole('button', { name: 'scratch.capture.manualAdd' }));
      expect(onRailCapture).toHaveBeenCalledWith('write');
      expect(poolTab).toHaveAttribute('aria-selected', 'true');
    });

    it.each(['drop', 'cancel'])('keeps the drag-start width until %s after capture stops', async (finish) => {
      const user = userEvent.setup();
      const { rerender, props } = renderBoardWithRerender();
      await user.click(screen.getByRole('button', { name: 'scratch.sort.hidePool' }));
      rerender(<ScratchSortingBoard {...props} captureBusy />);
      startDrag();
      rerender(<ScratchSortingBoard {...props} captureBusy={false} />);

      expect(screen.getByLabelText('scratch.sort.pool', { selector: 'div' })).toHaveClass('md:w-[300px]');
      expect(screen.queryByRole('button', { name: 'scratch.sort.showPool' })).not.toBeInTheDocument();

      if (finish === 'drop') endDrag();
      else cancelDrag();

      expect(screen.getByRole('button', { name: 'scratch.sort.showPool' })).toBeInTheDocument();
    });

    it('keeps the rail width until a drag ends when capture becomes busy', async () => {
      const user = userEvent.setup();
      const { rerender, props } = renderBoardWithRerender();
      await user.click(screen.getByRole('button', { name: 'scratch.sort.hidePool' }));
      startDrag();
      rerender(<ScratchSortingBoard {...props} captureBusy />);
      expect(screen.getByLabelText('scratch.sort.pool', { selector: 'div' })).toHaveClass('md:w-14');

      cancelDrag();
      expect(screen.getByLabelText('scratch.sort.pool', { selector: 'div' })).toHaveClass('md:w-[300px]');
    });

    it.each([
      { layout: 'wide folded rail', firstHeight: 0, secondHeight: 0, beforeId: undefined },
      { layout: 'visible phone pool with the same stored choice', firstHeight: 40, secondHeight: 40, beforeId: 'n1' },
      { layout: 'pool with a hidden card before a visible card', firstHeight: 0, secondHeight: 40, beforeId: 'n2' },
    ])('finds the insertion slot for the $layout', async ({ firstHeight, secondHeight, beforeId }) => {
      const user = userEvent.setup();
      const { onPlace } = renderBoard();
      await user.click(screen.getByRole('button', { name: 'scratch.sort.hidePool' }));
      mockCardRect('n1', firstHeight ? 30 : 0, firstHeight);
      mockCardRect('n2', secondHeight ? 90 : 0, secondHeight);

      startDrag();
      endDrag('pool');

      expect(onPlace).toHaveBeenCalledWith(['n5'], { section: null, pointId: null, subPointId: null }, beforeId);
    });

    it('shows the pool while notes are ticked so they can be collected into a point', async () => {
      const user = userEvent.setup();
      renderBoard();
      await user.click(screen.getByRole('button', { name: 'scratch.sort.hidePool' }));
      expect(screen.getByRole('button', { name: 'scratch.sort.showPool' })).toBeInTheDocument();

      await user.click(within(card('n5')).getByRole('checkbox', { name: 'scratch.sort.select' }));

      expect(screen.queryByRole('button', { name: 'scratch.sort.showPool' })).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'scratch.sort.collect' }).length).toBeGreaterThan(0);
      // The pool's own «clear» (the phone's bottom bar has one too).
      await user.click(screen.getAllByRole('button', { name: 'scratch.sort.clearSelection' })[0]);
      expect(screen.getByRole('button', { name: 'scratch.sort.showPool' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'scratch.sort.showPool' }));
    });
  });
});
