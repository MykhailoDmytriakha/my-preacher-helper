import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import GroupsPage from '@/(pages)/(private)/groups/page';

/**
 * WIRING, not pieces. The other refusal suites render one modal and hand it a
 * submission they built themselves — so they stay green even when the page never
 * connects the hook to the editor. That is not hypothetical: adversarial review found
 * two surfaces where exactly that seam was broken in production while their tests
 * passed (a dashboard prayer create navigating to `/prayers/[object Object]`, and a
 * create-in-series whose refusal never reached its own catch).
 *
 * This suite mocks only the SERVICE — the network edge — and drives the real page, the
 * real hook and the real modal, so a broken seam anywhere between them fails here.
 */
const mockCreateGroup = jest.fn();
const mockGetAllGroups = jest.fn();

jest.mock('@services/groups.service', () => ({
  createGroup: (...args: unknown[]) => mockCreateGroup(...args),
  getAllGroups: (...args: unknown[]) => mockGetAllGroups(...args),
  updateGroup: jest.fn(),
  deleteGroup: jest.fn(),
}));

jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (node: React.ReactNode) => node,
}));

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'user-1' } }) }));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'user-1' }) }));
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
jest.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({ settings: { firstDayOfWeek: 'sunday' } }),
}));
jest.mock('@/hooks/useSeries', () => ({ useSeries: () => ({ series: [], loading: false }) }));
jest.mock('@/services/userSettings.service', () => ({
  hasGroupsAccess: () => Promise.resolve(true),
  // The page pulls in the i18n bootstrap, which reads the language from this module.
  getCookieLanguage: () => 'en',
}));
jest.mock('react-day-picker/dist/style.css', () => ({}));

const mockToastError = jest.fn();
jest.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args), success: jest.fn() },
  Toaster: () => null,
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/groups',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      ({
        'workspaces.groups.actions.newGroup': 'New group',
        'workspaces.groups.actions.create': 'Create group',
        'workspaces.groups.form.titlePlaceholder': 'Family group - Week 1',
        'workspaces.groups.form.descriptionPlaceholder': 'Optional context for this group meeting',
        'workspaces.groups.errors.createFailed':
          'Save refused. Nothing was saved; your text is still here.',
      })[key] ?? options?.defaultValue ?? key,
  }),
}));

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GroupsPage />
    </QueryClientProvider>
  );
};

describe('group creation is wired end to end: page → hook → modal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllGroups.mockResolvedValue([]);
  });

  it('returns the typed group text to the person when the service refuses the write', async () => {
    mockCreateGroup.mockRejectedValue(
      Object.assign(new Error('Missing or insufficient permissions.'), {
        code: 'permission-denied',
        name: 'FirebaseError',
      })
    );

    renderPage();

    // The page renders the action twice (header + empty state); either opens the editor.
    fireEvent.click((await screen.findAllByRole('button', { name: /New group/i }))[0]);

    const title = await screen.findByPlaceholderText('Family group - Week 1');
    const description = screen.getByPlaceholderText('Optional context for this group meeting');
    fireEvent.change(title, { target: { value: 'Wiring-check group title' } });
    fireEvent.change(description, { target: { value: 'Wiring-check group description' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));

    // The service really was called through the hook — no stubbed submission in between.
    await waitFor(() => expect(mockCreateGroup).toHaveBeenCalledTimes(1));

    /**
     * The PROMISE is checked, not one particular route to it. A group create is owned by
     * the durable queue, so a refusal can arrive early (the editor is still open and
     * holds the text) or late (the editor closed and the recovery message carries it).
     * Both satisfy the contract; losing the text satisfies neither.
     */
    /**
     * WHAT IS GUARANTEED, stated exactly.
     *
     * A group create is owned by the durable queue, and acceptance yields only one tick
     * (see "The limits of the `queued` promise" in docs/recoverable-writes.md). React
     * Query's asynchronous `onMutate` does not finish inside that tick, so even an
     * IMMEDIATE refusal lands on the late path: the editor has closed and the recovery
     * message carries the text. That is a documented limit, not an accident — and the
     * promise still holds, which is what this asserts: the person's words come back and
     * nothing claims to have been saved.
     */
    await waitFor(() =>
      expect(
        mockToastError.mock.calls.some(([, options]) =>
          String((options as { description?: string } | undefined)?.description ?? '').includes(
            'Wiring-check group title'
          )
        )
      ).toBe(true)
    );

    // And a refused create is never announced as saved. Checked against the SUCCESS
    // channel rather than the word "created" — the empty-state hint on this page
    // contains that word too, which made the assertion pass for the wrong reason.
    const { toast } = jest.requireMock('sonner') as { toast: { success: jest.Mock } };
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('closes the editor once the service accepts the write', async () => {
    mockCreateGroup.mockResolvedValue({ id: 'group-1' });

    renderPage();

    fireEvent.click((await screen.findAllByRole('button', { name: /New group/i }))[0]);
    fireEvent.change(await screen.findByPlaceholderText('Family group - Week 1'), {
      target: { value: 'Accepted group' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));

    await waitFor(() => expect(mockCreateGroup).toHaveBeenCalledTimes(1));
    // The editor closes only on acceptance — and stays closed, with no success message
    // to contradict a queue that may still be replaying.
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Family group - Week 1')).not.toBeInTheDocument()
    );
  });
});
