import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import PlanEditorModal from '@/components/plan-editor/PlanEditorModal';
import { updateSermonOutline } from '@/services/outline.service';
import { OutlineCollisionError } from '@/services/sermons.client';
import '@testing-library/jest-dom';

import type { Sermon, SermonOutline } from '@/models/models';

/**
 * THE PLAN IS THE ONE PLACE THE OWNER ACTUALLY LOST WORK.
 *
 * It is stored as a single whole field, so a save from a laptop that has been open
 * since last night used to replace every point — including the one added from a
 * phone this morning, with no warning at all. These pin the two halves of the fix:
 * the write is told what the editor OPENED with (so it can merge), and a genuine
 * same-point overlap becomes a visible choice instead of a silent winner.
 */
jest.mock('@/services/outline.service', () => ({
  updateSermonOutline: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/hooks/usePlanTemplates', () => ({
  usePlanTemplates: () => ({ templates: [], createTemplate: jest.fn() }),
}));
jest.mock('@/hooks/useScrollLock', () => ({ useScrollLock: () => undefined }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
/**
 * The board itself is a large drag-and-drop surface; what matters here is the
 * contract between it and the modal, which is exactly `onChange(nextOutline)` —
 * the same call the real board makes for every edit.
 */
let editCount = 0;
jest.mock('@/components/plan-editor/OutlineBoard', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
  }: {
    value: { main: Array<{ id: string; text: string }> };
    onChange: (next: unknown) => void;
  }) => (
    <div>
      {/* RENDER the text. Without this the board is blind and a test asking "was my
          text replaced?" passes no matter what the component does. */}
      <span data-testid="board-text">{value.main.map((point) => point.text).join('|')}</span>
      <button
        type="button"
        onClick={() => {
          editCount += 1;
          onChange({
            introduction: [],
            main: [{ id: 'p1', text: `edit ${editCount}` }],
            conclusion: [],
          });
        }}
      >
        edit-a-point
      </button>
    </div>
  ),
}));

const mockSave = updateSermonOutline as jest.MockedFunction<typeof updateSermonOutline>;

const outline: SermonOutline = {
  introduction: [],
  main: [{ id: 'p1', text: 'Grace' }],
  conclusion: [],
};

const sermon = {
  id: 's1',
  userId: 'u1',
  title: 'Sermon',
  verse: '',
  date: '2026-07-01',
  thoughts: [],
  outline,
} as unknown as Sermon;

const openEditor = () =>
  render(
    <PlanEditorModal isOpen sermon={sermon} onClose={() => undefined} onOutlineUpdate={jest.fn()} />
  );

beforeAll(() => {
  const root = document.createElement('div');
  root.id = 'portal-root';
  document.body.appendChild(root);
});

describe('the plan editor saves with what it opened with', () => {
  beforeEach(() => {
    // A refused plan is now stored DURABLY, so it survives between tests exactly as
    // it survives a closed modal — which is the point, and which means each test
    // must start from an empty store or it inherits the previous refusal.
    localStorage.clear();
    editCount = 0;
    mockSave.mockReset();
    mockSave.mockResolvedValue(null);
  });

  it('passes the OPENING plan so the write can merge instead of replace', async () => {
    openEditor();

    fireEvent.click(screen.getByText('edit-a-point'));

    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    const [, , baseOutline] = mockSave.mock.calls[0];
    // NOT undefined: undefined means "replace the whole field", which is the
    // behaviour that erased the other device's point.
    expect(baseOutline).toEqual(outline);
  });

  it('shows a choice when the same point was rewritten in two places', async () => {
    mockSave.mockRejectedValue(
      new OutlineCollisionError(
        ['p1'],
        { introduction: [], main: [{ id: 'p1', text: 'phone wording' }], conclusion: [] },
        5
      )
    );
    openEditor();

    fireEvent.click(screen.getByText('edit-a-point'));

    expect(await screen.findByText('freshness.conflictTitle')).toBeInTheDocument();
    expect(screen.getByText('freshness.conflictKeepMine')).toBeInTheDocument();
    expect(screen.getByText('freshness.conflictTakeTheirs')).toBeInTheDocument();
  });

  it('KEEP MINE actually sends the plan', async () => {
    // It did not. The handler cleared the collision state and called persist in the
    // same tick, but the guard reads a ref assigned during render — still set — so
    // the resend was cancelled and the button did nothing at all. Closing the modal
    // afterwards took the plan with it.
    mockSave.mockRejectedValueOnce(
      new OutlineCollisionError(['p1'], { introduction: [], main: [{ id: 'p1', text: 'phone' }], conclusion: [] }, 5)
    );
    openEditor();

    fireEvent.click(screen.getByText('edit-a-point'));
    fireEvent.click(await screen.findByText('freshness.conflictKeepMine'));

    await waitFor(() => expect(mockSave.mock.calls.length).toBeGreaterThan(1));
    // And it states the SERVER's plan as the base: the person has seen the other
    // version and chose theirs, so there is nothing left to collide with.
    const [, , baseOutline] = mockSave.mock.calls[mockSave.mock.calls.length - 1];
    expect(baseOutline).toEqual({ introduction: [], main: [{ id: 'p1', text: 'phone' }], conclusion: [] });
  });

  it('does not apply an older response over text typed since', async () => {
    // The response to the edit of one point used to be applied unconditionally, so
    // it replaced a later edit under the cursor — text lost while the app looked
    // like it was saving, and worse than before, when nothing was applied back.
    let resolveFirst: ((value: SermonOutline | null) => void) | undefined;
    mockSave.mockImplementationOnce(
      () =>
        new Promise<SermonOutline | null>((resolve) => {
          resolveFirst = resolve;
        })
    );
    // The SECOND save never settles, so the only thing that can touch the board is
    // the stale first response. Otherwise the second response lands last and hides
    // the defect — the test would pass while the text was being clobbered.
    mockSave.mockImplementation(() => new Promise<SermonOutline | null>(() => undefined));
    openEditor();

    fireEvent.click(screen.getByText('edit-a-point')); // first edit -> request starts
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('edit-a-point')); // types more meanwhile

    resolveFirst?.({ introduction: [], main: [{ id: 'p1', text: 'THE OLD ANSWER' }], conclusion: [] });
    await new Promise((resolve) => setTimeout(resolve, 200));

    // The board still holds what the person typed LAST, not the stale answer.
    expect(screen.getByTestId('board-text')).toHaveTextContent('edit 2');
  });

  it('stops autosaving until the person decides', async () => {
    mockSave.mockRejectedValue(
      new OutlineCollisionError(['p1'], { introduction: [], main: [], conclusion: [] }, 5)
    );
    openEditor();

    fireEvent.click(screen.getByText('edit-a-point'));
    await screen.findByText('freshness.conflictTitle');
    const callsAtRefusal = mockSave.mock.calls.length;

    // Keep editing: not one more write may go out, or one of them would land and
    // silently answer the question being asked of the person.
    fireEvent.click(screen.getByText('edit-a-point'));
    fireEvent.click(screen.getByText('edit-a-point'));
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(mockSave.mock.calls).toHaveLength(callsAtRefusal);
  });
});

/**
 * The person keeps writing while they think about the question. The durable copy used
 * to be a snapshot of the FIRST refusal, so everything typed afterwards died with the
 * modal — the ninth review called it a hard-law regression, since before any of this
 * every change still went out through `persist`.
 */
describe('a refusal keeps the LATEST text durable, not the first snapshot', () => {
  beforeEach(() => {
    localStorage.clear();
    editCount = 0;
    mockSave.mockReset();
    mockSave.mockRejectedValue(
      new OutlineCollisionError(['p1'], { introduction: [], main: [], conclusion: [] }, 5)
    );
  });

  it('stores what is on the board now, and does not write again', async () => {
    openEditor();

    fireEvent.click(screen.getByText('edit-a-point')); // -> refusal for "edit 1"
    await screen.findByText('freshness.conflictTitle');
    const callsAtRefusal = mockSave.mock.calls.length;

    // Keep typing while the question is up.
    fireEvent.click(screen.getByText('edit-a-point')); // "edit 2"
    await new Promise((resolve) => setTimeout(resolve, 200));

    // No further write went out…
    expect(mockSave.mock.calls).toHaveLength(callsAtRefusal);
    // …and the durable copy is the LATER text, not the first one.
    const stored = Object.keys(localStorage).filter((k) => k.includes('outlineConflict'));
    expect(stored).toHaveLength(1);
    const payload = JSON.parse(localStorage.getItem(stored[0]) as string).value.payload;
    expect(payload.outline.main[0].text).toBe('edit 2');
  });
});
