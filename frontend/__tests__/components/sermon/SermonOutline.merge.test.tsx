import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';

import SermonOutline from '@/components/sermon/SermonOutline';
import { mergeOutline } from '@/utils/mergeOutline';

import type { Sermon, SermonOutline as SermonOutlineType, SermonPoint } from '@/models/models';

/**
 * THE PLAN PANEL MUST NOT LOSE — OR DUPLICATE — A POINT ADDED ON ANOTHER DEVICE.
 *
 * This view had the merge and the base already; what it did NOT have was symmetry.
 * It adopted the COMMITTED plan into its base and left the screen showing its own
 * list, so the two disagreed about a point the merge had kept. The person saw the
 * point vanish (and could add it again by hand, hence two copies with different
 * ids), and on the next save the gap between base and screen was read as
 * "deleted here" — the point left the server for good.
 *
 * Everything here is asserted on WHAT SURVIVED on the stand-in server and on WHAT
 * THE PERSON SEES, never on the arguments of the call: a call-shape assertion stays
 * green while the merge underneath is broken.
 */

/** Stands in for the stored plan, so a test can assert what SURVIVED. */
let mockServerOutline: SermonOutlineType;

jest.mock('@/services/outline.service', () => ({
  getSermonOutline: jest.fn(async () => ({
    introduction: [...mockServerOutline.introduction],
    main: [...mockServerOutline.main],
    conclusion: [...mockServerOutline.conclusion],
  })),
  updateSermonOutline: jest.fn(
    async (
      _sermonId: string,
      mine: SermonOutlineType,
      base?: SermonOutlineType | null,
      onCollision?: 'refuse' | 'preferMine'
    ) => {
      if (base === undefined) {
        // Exactly what the unguarded path does: replace the whole field.
        mockServerOutline = mine;
        return mockServerOutline;
      }
      // The real merge, not an imitation, so a broken caller is caught here rather
      // than in production.
      const { outline, collisions } = mergeOutline(
        base,
        mine,
        mockServerOutline,
        onCollision === 'preferMine'
      );
      mockServerOutline = outline;
      return mockServerOutline;
    }
  ),
  generateSermonPointsForSection: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Droppable: ({ children }: { children: any }) =>
    children({ innerRef: jest.fn(), droppableProps: {}, placeholder: null }),
  Draggable: ({ children }: { children: any }) =>
    children(
      { innerRef: jest.fn(), draggableProps: {}, dragHandleProps: {} },
      { isDragging: false, isDropAnimating: false, draggingOver: null }
    ),
}));

jest.mock('@/utils/themeColors', () => ({
  getSectionStyling: () => ({
    headerBg: '',
    headerHover: '',
    border: '',
    dragBg: '',
    badge: '',
  }),
}));

jest.mock('@/providers/ConnectionProvider', () => ({
  useConnection: () => ({ isOnline: true, isMagicAvailable: true, checkConnection: jest.fn() }),
  ConnectionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

/** Captured on the phone this morning; this panel loaded before it existed. */
const phonePoint: SermonPoint = { id: 'p2', text: 'Added on the phone' };

const sermon = { id: 's1', title: 'Sermon', verse: '', date: '', userId: 'u1', thoughts: [] } as unknown as Sermon;

const addPointHere = async (text: string) => {
  const section = screen.getByText('structure.introduction').closest('div')!;
  const addButton = within(section.parentElement as HTMLElement).getByLabelText(
    'structure.addPointButton'
  );
  await act(async () => {
    fireEvent.click(addButton);
  });
  const input = screen.getByPlaceholderText('structure.addPointPlaceholder');
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
  });
};

describe('the sermon plan panel keeps what another device added', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServerOutline = {
      introduction: [{ id: 'p1', text: 'Grace' }],
      main: [],
      conclusion: [],
    };
  });

  it('shows the point the merge kept instead of leaving it off the screen', async () => {
    render(<SermonOutline sermon={sermon} />);
    await waitFor(() => expect(screen.getByText('Grace')).toBeInTheDocument());

    // The phone adds its point AFTER this panel loaded — so this view has never
    // seen it, exactly like a laptop left open since last night.
    mockServerOutline.introduction = [...mockServerOutline.introduction, phonePoint];

    await addPointHere('Added on the laptop');

    await waitFor(() =>
      expect(mockServerOutline.introduction.map((point) => point.text)).toContain(
        'Added on the laptop'
      )
    );
    // Both survive on the server...
    expect(mockServerOutline.introduction.map((point) => point.id)).toContain('p2');
    // ...and the phone's point is on the screen, so nobody re-adds it by hand.
    await waitFor(() => expect(screen.getByText('Added on the phone')).toBeInTheDocument());
  });

  it('still keeps it after a SECOND edit made here', async () => {
    render(<SermonOutline sermon={sermon} />);
    await waitFor(() => expect(screen.getByText('Grace')).toBeInTheDocument());

    mockServerOutline.introduction = [...mockServerOutline.introduction, phonePoint];

    await addPointHere('First addition');
    await waitFor(() =>
      expect(mockServerOutline.introduction.map((point) => point.text)).toContain('First addition')
    );

    await addPointHere('Second addition');
    await waitFor(() =>
      expect(mockServerOutline.introduction.map((point) => point.text)).toContain('Second addition')
    );

    // The base and the screen moved together, so the second save did not read the
    // phone's point as "deleted here".
    expect(mockServerOutline.introduction.map((point) => point.id)).toContain('p2');
  });
});
