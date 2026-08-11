import { renderHook, act, waitFor } from '@testing-library/react';

import { useColumnOutlineState } from '@/components/column/useColumnOutlineState';
import { OutlineCollisionError } from '@/services/sermons.client';
import { mergeOutline } from '@/utils/mergeOutline';

import type { SermonOutline, SermonPoint } from '@/models/models';

/**
 * A PLAN EDIT MADE IN THE COLUMN VIEW MUST NOT ERASE A POINT ADDED ELSEWHERE.
 *
 * The plan lives as ONE whole field, so a writer that sends its own list replaces
 * every point that list does not contain. The merge that prevents this already
 * exists (`mergeOutline`) and the writer already accepts it — but only when the
 * caller states the plan it OPENED with. Callers that state nothing keep the old
 * whole-field overwrite, and this column view is one of them.
 *
 * THE STAND IS THE OWNER'S OWN SCENARIO: a point captured on the phone in the
 * morning, a laptop that has been open since last night and never saw it, and an
 * ordinary text edit saved from that laptop in the afternoon.
 *
 * The assertion is deliberately about the RESULT ON THE SERVER, not about which
 * arguments were passed: a test that only checks "the base was handed over" stays
 * green if the merge itself is broken, and the point of all of this is the text
 * surviving — not the call shape.
 */

/** Stands in for the stored document, so a test can assert what SURVIVED. */
let mockServerOutline: SermonOutline;

jest.mock('@/services/outline.service', () => ({
  getSermonOutline: jest.fn(async () => mockServerOutline),
  updateSermonOutline: jest.fn(
    async (
      _sermonId: string,
      mine: SermonOutline,
      base?: SermonOutline | null,
      onCollision?: 'refuse' | 'preferMine'
    ) => {
      if (base === undefined) {
        // Exactly what the unguarded path does: replace the whole field.
        mockServerOutline = mine;
        return mockServerOutline;
      }
      // And exactly what the guarded path does — the real merge, not an imitation,
      // INCLUDING its refusal, so a caller with nowhere to put a refused plan is
      // caught here rather than in production.
      const { outline, collisions } = mergeOutline(base, mine, mockServerOutline);
      if (collisions.length > 0 && onCollision !== 'preferMine') {
        throw new OutlineCollisionError(collisions, mockServerOutline, 1);
      }
      mockServerOutline = outline;
      return mockServerOutline;
    }
  ),
  generateSermonPointsForSection: jest.fn(),
}));

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const laptopPoint: SermonPoint = { id: 'p1', text: 'Grace' };
/** Captured on the phone this morning; the laptop's column never saw it. */
const phonePoint: SermonPoint = { id: 'p2', text: 'Added on the phone' };

/**
 * STABLE ACROSS RENDERS. Built inline it is a new array every render, and the hook's
 * sync effect then re-runs forever — the test heap-crashes instead of failing.
 */
const initialPoints: SermonPoint[] = [laptopPoint];

const renderColumn = () =>
  renderHook(() =>
    useColumnOutlineState({
      id: 'main',
      sermonId: 's1',
      initialSermonPoints: initialPoints,
      isOnline: true,
      // Run the debounced save immediately — the debounce is not what is under test.
      scheduleTask: (callback) => {
        void callback();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
      clearScheduledTask: () => undefined,
      t: ((key: string) => key) as never,
    })
  );

describe('the column plan editor merges instead of replacing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServerOutline = {
      introduction: [],
      main: [laptopPoint, phonePoint],
      conclusion: [],
    };
  });

  it('keeps the point added on another device when a text edit is saved', async () => {
    const { result } = renderColumn();

    act(() => {
      result.current.handleSaveEditDirect('p1', 'Grace, revised');
    });

    await waitFor(() =>
      expect(mockServerOutline.main.map((point) => point.text)).toContain('Grace, revised')
    );
    // The edit landed — and the phone's point is still there.
    expect(mockServerOutline.main.map((point) => point.id)).toContain('p2');
  });

  /**
   * A REFUSAL HERE WOULD BE WORSE THAN THE ORIGINAL BUG.
   *
   * Handing over a base lets the writer REFUSE when the very same point was rewritten
   * in two places. The plan editor can afford that — it stores the refused plan and
   * asks the person to choose. This column cannot: it has no such surface, so a
   * refusal reaches a plain `catch`, becomes an error toast, and the edit is gone at
   * the next reload. That turns "overwrote someone else" into "silently lost your
   * own", which the whole review loop was fought over.
   *
   * So this view merges WITHOUT refusing: everything the other device added still
   * survives, and for the one point edited in both places the local wording wins —
   * exactly what happened before any of this existed, so it cannot be worse.
   */
  it('does not lose the edit when the SAME point was rewritten elsewhere', async () => {
    mockServerOutline = {
      introduction: [],
      // Same id, different wording — a genuine collision.
      main: [{ id: 'p1', text: 'Rewritten on the phone' }, phonePoint],
      conclusion: [],
    };
    const { result } = renderColumn();

    act(() => {
      result.current.handleSaveEditDirect('p1', 'Rewritten on the laptop');
    });

    await waitFor(() =>
      expect(mockServerOutline.main.map((point) => point.text)).toContain(
        'Rewritten on the laptop'
      )
    );
    // And the unrelated point from the other device is still there.
    expect(mockServerOutline.main.map((point) => point.id)).toContain('p2');
  });

  /**
   * THE SECOND EDIT IS WHERE THE OTHER DEVICE'S POINT ACTUALLY DIES.
   *
   * After a save this column adopts the COMMITTED section as its merge base — right,
   * because the next edit must be judged against what is really stored. But the
   * visible list stays local, so base and screen now disagree: the base knows the
   * phone's point, the list does not.
   *
   * On the next edit that disagreement is read as an intention. A point present in
   * the base and absent from `mine` means "deleted here" (mergeOutline.ts), so the
   * merge dutifully removes it — and the phone's point is gone from the server. The
   * person saw it vanish from the screen one edit earlier and never asked for that.
   *
   * Adopting the committed plan into BOTH the base and the list is what keeps the
   * two in step; adopting it into neither would be the older bug back again.
   */
  it('still keeps the other device point after a SECOND edit here', async () => {
    const { result } = renderColumn();

    act(() => {
      result.current.handleSaveEditDirect('p1', 'Grace, revised');
    });
    await waitFor(() =>
      expect(mockServerOutline.main.map((point) => point.text)).toContain('Grace, revised')
    );

    act(() => {
      result.current.handleSaveEditDirect('p1', 'Grace, revised twice');
    });
    await waitFor(() =>
      expect(mockServerOutline.main.map((point) => point.text)).toContain('Grace, revised twice')
    );

    expect(mockServerOutline.main.map((point) => point.id)).toContain('p2');
  });

  it('keeps it when a point is deleted, too', async () => {
    // Deletion sends the remaining list, so it erases an unseen point just as a text
    // edit does — with the person believing they removed exactly one point.
    const { result } = renderColumn();

    // Deletion is armed first and confirmed second, the same two steps the UI takes.
    act(() => {
      result.current.setDeletePointId('p1');
    });
    act(() => {
      result.current.confirmDeletePoint();
    });

    await waitFor(() => expect(mockServerOutline.main.map((point) => point.id)).not.toContain('p1'));
    expect(mockServerOutline.main.map((point) => point.id)).toContain('p2');
  });
});
