import { renderHook, waitFor } from '@testing-library/react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { useGroupPageEditor } from '@/hooks/useGroupPageEditor';
import { documentEngineHarness } from '@test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'groups', id: 'pending-group' };
const group = {
  userId: 'owner', title: 'Pending group', status: 'draft', createdAt: 'created', updatedAt: 'updated',
  meetingDates: [], templates: [], flow: [],
};

afterEach(() => { jest.mocked(createBrowserDataEngine).mockReset(); });

it('opens the meeting manual form for a public local creating group while confirmed is null', async () => {
  const harness = documentEngineHarness({ resource, value: null, metadata: null });
  const browser = harness.createBrowser();
  browser.engine.setOnline(false);
  browser.engine.setOwner('owner');
  const creator = await browser.engine.createEditor(resource, 'create-group-modal');
  await creator.commit(() => group);
  expect(creator.getState().checkpoint.confirmed).toMatchObject({ value: null, metadata: null });
  expect(creator.getPresence()).toMatchObject({ kind: 'creating', source: 'local' });
  await creator.close({ flush: false });

  jest.mocked(createBrowserDataEngine).mockReturnValue(browser);
  const view = renderHook(() => useGroupPageEditor(resource.id), {
    wrapper: ({ children }) => <DataEngineProvider>{children}</DataEngineProvider>,
  });

  try {
    await waitFor(() => expect(view.result.current.presence).toMatchObject({ kind: 'creating', source: 'local' }));
    await waitFor(() => expect(view.result.current.meetingFieldsEnabled).toBe(true));
    expect(view.result.current.meetingDate).toBe('');
  } finally {
    view.unmount();
  }
});

it.each([
  ['server absence', { value: null, metadata: null }],
  ['server tombstone', { value: null, metadata: { protocol: 1, generation: 'deleted', revision: 2, deleted: true } }],
] as const)('does not open the meeting form for %s', async (_label, snapshot) => {
  const harness = documentEngineHarness({ resource, ...snapshot });
  const browser = harness.createBrowser();
  browser.engine.setOwner('owner');
  jest.mocked(createBrowserDataEngine).mockReturnValue(browser);

  const view = renderHook(() => useGroupPageEditor(resource.id), {
    wrapper: ({ children }) => <DataEngineProvider>{children}</DataEngineProvider>,
  });

  try {
    await waitFor(() => expect(view.result.current.presence!.kind).toBe('absent'));
    expect(view.result.current.group).toBeNull();
    expect(view.result.current.meetingFieldsEnabled).toBe(false);
  } finally {
    view.unmount();
  }
});
