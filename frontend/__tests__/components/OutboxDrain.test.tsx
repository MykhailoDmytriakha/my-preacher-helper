import { render } from '@testing-library/react';

import { OutboxDrain } from '@/components/OutboxDrain';
import { replayOutbox } from '@/services/outboxReplay.client';
import { replayMembershipOutbox } from '@/services/seriesMembership.client';

/**
 * The worker must exist on EVERY private screen.
 *
 * It used to live inside the visible conflict banner, and the layout hides that
 * banner on the preaching-plan screen — the one a preacher keeps open for an hour.
 * On that screen nothing drained the queue: an edit typed offline just waited, with
 * no worker and no way for the person to know.
 */
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn().mockResolvedValue(undefined) }),
}));
jest.mock('@/services/outboxReplay.client', () => ({
  replayOutbox: jest
    .fn()
    .mockResolvedValue({ replayed: 0, conflicted: 0, failed: 0, touched: [] }),
}));
jest.mock('@/services/seriesMembership.client', () => ({
  replayMembershipOutbox: jest.fn().mockResolvedValue(0),
}));

const mockReplay = replayOutbox as jest.MockedFunction<typeof replayOutbox>;
const mockMembership = replayMembershipOutbox as jest.MockedFunction<typeof replayMembershipOutbox>;

describe('OutboxDrain', () => {
  beforeEach(() => {
    mockReplay.mockClear();
    mockMembership.mockClear();
  });

  it('drains text edits AND membership operations on mount, rendering nothing', async () => {
    const { container } = render(<OutboxDrain />);

    // Renders nothing at all: it can therefore be mounted on a screen that hides
    // every other piece of chrome.
    expect(container).toBeEmptyDOMElement();
    await Promise.resolve();
    expect(mockReplay).toHaveBeenCalledWith('u1');
    expect(mockMembership).toHaveBeenCalledWith('u1');
  });

  it('drains again when the connection comes back', async () => {
    render(<OutboxDrain />);
    // Let the mount drain finish before clearing, or the in-flight guard would
    // swallow the second run and the test would pass for the wrong reason.
    await new Promise((resolve) => setTimeout(resolve, 0));
    mockReplay.mockClear();

    window.dispatchEvent(new Event('online'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockReplay).toHaveBeenCalledWith('u1');
  });

  it('announces the drain so a visible banner can re-read the queue', async () => {
    const heard = jest.fn();
    window.addEventListener('outbox:changed', heard);
    render(<OutboxDrain />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(heard).toHaveBeenCalled();
    window.removeEventListener('outbox:changed', heard);
  });
});
