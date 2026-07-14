import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fetchMock from 'jest-fetch-mock';
import React from 'react';

import AdminPage from '@/(pages)/(private)/admin/page';
import { auth } from '@/services/firebaseAuth.service';

const mockTranslate = (key: string) => key;

jest.mock('@/services/firebaseAuth.service', () => ({
  auth: { currentUser: null, onAuthStateChanged: jest.fn() },
}));

jest.mock('@/components/navigation/LanguageInitializer', () => () => <div data-testid="language-initializer" />);
jest.mock('next/link', () => ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>);
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate, i18n: { language: 'en' } }),
}));

describe('Admin Page', () => {
  const mockOnAuthStateChanged = jest.mocked(auth.onAuthStateChanged);
  const mockGetIdToken = jest.fn().mockResolvedValue('firebase-id-token');
  const adminUser = { uid: 'admin-uid', getIdToken: mockGetIdToken };
  const users = [
    {
      uid: 'user-alpha', email: 'alpha@example.com', emailVerified: true, disabled: false,
      lastSignInTime: '2026-07-12T10:00:00.000Z', lastSeenAt: '2026-07-13T09:00:00.000Z', creationTime: '2026-01-12T10:00:00.000Z',
      paidTier: 'tier1', effectiveTier: 'tier3', promotion: { tier: 'tier3', expiresAt: '2099-01-01T00:00:59.999Z' },
      usage: { aiUsed: 7, transcriptionSecondsUsed: 120, periodStart: '2026-07-01T00:00:00.000Z' }, role: 'admin', referredBy: 'inviter-uid', referralCount: 3,
    },
    {
      uid: 'user-beta', email: 'beta@example.com', emailVerified: false, disabled: false,
      lastSignInTime: '2026-06-12T10:00:00.000Z', lastSeenAt: null, creationTime: '2026-02-12T10:00:00.000Z', paidTier: 'free', effectiveTier: 'free', promotion: null,
      usage: { aiUsed: 0, transcriptionSecondsUsed: 0, periodStart: '2026-07-01T00:00:00.000Z' }, role: null, referredBy: null, referralCount: 0,
    },
  ];

  const modelDefaults = {
    stored: {},
    effective: {
      transcription: { providerId: 'openai', modelId: 'gpt-4o-transcribe' },
      text: { providerId: 'gemini', modelId: 'gemini-3.1-flash-lite-preview' },
      tts: { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' },
    },
  };

  const mockAuthorizedList = (nextPageToken?: string) => fetchMock.mockResponses(
    [JSON.stringify({ admin: true }), { status: 200 }],
    [JSON.stringify({ users, ...(nextPageToken ? { nextPageToken } : {}) }), { status: 200 }],
    [JSON.stringify(modelDefaults), { status: 200 }]
  );

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.resetMocks();
    (auth as { currentUser: unknown }).currentUser = adminUser;
    mockOnAuthStateChanged.mockImplementation((callback) => {
      if (typeof callback === 'function') callback(adminUser as never);
      return jest.fn();
    });
  });

  it('shows the unauthorized screen and never renders the access editor for a non-admin', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    render(<AdminPage />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'admin.notAuthorizedTitle' })).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('admin.targetUid')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/me', { headers: { Authorization: 'Bearer firebase-id-token' } });
  });

  it('renders the KPI strip and user rows after server authorization', async () => {
    mockAuthorizedList();
    render(<AdminPage />);

    expect(await screen.findByText('alpha@example.com')).toBeInTheDocument();
    expect(screen.getByText('beta@example.com')).toBeInTheDocument();
    expect(screen.getByText('admin.users.kpi.total')).toBeInTheDocument();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveClass('table-fixed', 'min-w-[64rem]');
    expect(Array.from(screen.getByRole('table').querySelectorAll('col')).map((column) => column.className)).toEqual([
      'w-[28%]', 'w-[17%]', 'w-[17%]', 'w-[10%]', 'w-[12%]', 'w-[16%]',
    ]);
    expect(screen.getByRole('table').closest('main')).toHaveClass('max-w-screen-2xl');
    expect(screen.getByRole('columnheader', { name: 'admin.users.columns.lastSeen' })).toBeInTheDocument();
    const betaRow = screen.getByText('beta@example.com').closest('tr') as HTMLTableRowElement;
    const betaCells = within(betaRow).getAllByRole('cell');
    expect(betaCells[2]).toHaveTextContent(betaCells[1].textContent ?? '');
    expect(screen.getByRole('button', { name: 'admin.modelDefaults.nav.users' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'admin.modelDefaults.nav.modelDefaults' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'admin.modelDefaults.title' })).not.toBeInTheDocument();
    const fills = screen.getAllByTestId('usage-bar-fill');
    expect(fills).toHaveLength(2);
    expect(fills[1]).toHaveStyle({ width: '100%' });
    expect(fills[1]).toHaveClass('bg-blue-600', 'dark:bg-blue-400');
  });

  it('opens a drawer and prefills the edit form after clicking a row', async () => {
    mockAuthorizedList();
    render(<AdminPage />);

    fireEvent.click(await screen.findByText('alpha@example.com'));

    const drawer = await screen.findByRole('dialog', { name: 'admin.users.drawerLabel' });
    expect(within(drawer).getByLabelText('admin.targetUid')).toHaveValue('user-alpha');
    expect(within(drawer).getByLabelText('admin.paidTier')).toHaveValue('tier1');
    expect(within(drawer).getByLabelText('admin.role')).toHaveValue('admin');
    expect(within(drawer).getByLabelText('admin.aiUsage')).toHaveValue(7);
    expect(within(drawer).getByLabelText('admin.transcriptionSeconds')).toHaveValue(120);
    expect(within(drawer).getByText('inviter-uid')).toBeInTheDocument();
    expect(within(drawer).getByText('admin.users.fields.lastSeen')).toBeInTheDocument();
    const invitedCount = within(drawer).getByText('admin.users.fields.invitedCount').parentElement;
    expect(invitedCount).toHaveTextContent('3');
  });

  it('closes the drawer with Escape', async () => {
    mockAuthorizedList();
    render(<AdminPage />);

    fireEvent.click(await screen.findByText('alpha@example.com'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('filters the user table by search and selected filter chips', async () => {
    mockAuthorizedList();
    render(<AdminPage />);

    const search = await screen.findByLabelText('admin.users.searchLabel');
    fireEvent.change(search, { target: { value: 'user-beta' } });
    expect(screen.queryByText('alpha@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('beta@example.com')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'admin.users.filters.paid' }));
    expect(screen.getByText('alpha@example.com')).toBeInTheDocument();
    expect(screen.queryByText('beta@example.com')).not.toBeInTheDocument();
  });

  it('appends the next Firebase Auth page when Load more is selected', async () => {
    mockAuthorizedList('opaque-token');
    fetchMock.mockResponseOnce(JSON.stringify({ users: [{ ...users[1], uid: 'user-gamma', email: 'gamma@example.com' }] }));
    render(<AdminPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'admin.users.loadMore' }));
    expect(await screen.findByText('gamma@example.com')).toBeInTheDocument();
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/admin/users?pageToken=opaque-token');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4);
  });

  it('shows a translated error for a malformed user-list response', async () => {
    fetchMock.mockResponses(
      [JSON.stringify({ admin: true }), { status: 200 }],
      [JSON.stringify({ users: 'not-an-array' }), { status: 200 }],
      [JSON.stringify(modelDefaults), { status: 200 }]
    );
    render(<AdminPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('admin.users.loadFailed');
    expect(screen.queryByRole('table')).toBeInTheDocument();
  });

  it('shows the empty state when a search yields no rows', async () => {
    mockAuthorizedList();
    render(<AdminPage />);
    fireEvent.change(await screen.findByLabelText('admin.users.searchLabel'), { target: { value: 'missing-user' } });
    expect(await screen.findByText('admin.users.emptyFiltered')).toBeInTheDocument();
  });

  it('fails closed when model defaults cannot be loaded', async () => {
    fetchMock.mockResponses(
      [JSON.stringify({ admin: true }), { status: 200 }],
      [JSON.stringify({ users }), { status: 200 }],
      [JSON.stringify({ error: 'unavailable' }), { status: 500 }]
    );
    render(<AdminPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'admin.modelDefaults.nav.modelDefaults' }));
    expect(await screen.findByText('admin.modelDefaults.loadFailed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'admin.modelDefaults.save' })).toBeDisabled();
    expect(screen.getByLabelText('admin.modelDefaults.functions.text: admin.modelDefaults.provider')).toBeDisabled();
  });

  it('renders aligned provider-to-model sections with prices inside model options', async () => {
    mockAuthorizedList();
    render(<AdminPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'admin.modelDefaults.nav.modelDefaults' }));

    const functionHeadings = screen.getAllByRole('heading', { level: 3 });
    expect(functionHeadings.map((heading) => heading.textContent)).toEqual([
      'admin.modelDefaults.functions.text',
      'admin.modelDefaults.functions.transcription',
      'admin.modelDefaults.functions.tts',
    ]);

    const textProvider = screen.getByLabelText('admin.modelDefaults.functions.text: admin.modelDefaults.provider');
    const textModel = screen.getByLabelText('admin.modelDefaults.functions.text: admin.modelDefaults.model');
    const modelFieldGrids = screen.getAllByTestId(/^admin-model-fields-/);
    expect(modelFieldGrids).toHaveLength(3);
    modelFieldGrids.forEach((grid) => {
      expect(grid).toHaveClass('md:grid-cols-[minmax(10rem,0.7fr)_minmax(0,1.3fr)]');
    });
    expect(textProvider).toHaveValue('gemini');
    expect(textModel).toHaveValue('gemini-3.1-flash-lite-preview');
    expect(within(textModel).getByRole('option', { selected: true })).toHaveTextContent(
      'gemini-3.1-flash-lite-preview — $0.25 in / $1.50 out / 1M tok'
    );
    expect(screen.queryByText('admin.modelDefaults.price')).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^admin-model-price-/)).not.toBeInTheDocument();

    fireEvent.change(textProvider, { target: { value: 'openrouter' } });
    expect(textModel).toHaveValue('qwen/qwen3.7-plus');
    expect(within(textModel).getAllByRole('option').map((option) => ({
      label: option.textContent,
      value: option.getAttribute('value'),
    }))).toEqual([
      { label: 'qwen/qwen3.7-plus — $0.32 in / $1.28 out / 1M tok', value: 'qwen/qwen3.7-plus' },
      { label: 'deepseek/deepseek-v4-pro — $0.435 in / $0.87 out / 1M tok', value: 'deepseek/deepseek-v4-pro' },
      { label: 'deepseek/deepseek-v4-flash — $0.09 in / $0.18 out / 1M tok', value: 'deepseek/deepseek-v4-flash' },
    ]);
    fireEvent.change(textModel, { target: { value: 'deepseek/deepseek-v4-pro' } });
    expect(within(textModel).getByRole('option', { selected: true })).toHaveTextContent(
      'deepseek/deepseek-v4-pro — $0.435 in / $0.87 out / 1M tok'
    );

    const transcriptionProvider = screen.getByLabelText('admin.modelDefaults.functions.transcription: admin.modelDefaults.provider');
    expect(within(transcriptionProvider).getAllByRole('option')).toHaveLength(1);
    const transcriptionModel = screen.getByLabelText('admin.modelDefaults.functions.transcription: admin.modelDefaults.model');
    const ttsModel = screen.getByLabelText('admin.modelDefaults.functions.tts: admin.modelDefaults.model');
    expect(within(transcriptionModel).getByRole('option', { selected: true })).toHaveTextContent('$0.006 / min');
    expect(within(ttsModel).getByRole('option', { selected: true })).toHaveTextContent('~$36 est. / 1M chars');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'admin.modelDefaults.nav.users' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByTestId(/^admin-model-fields-/)).not.toBeInTheDocument();
  });

  it('posts a saved edit, refreshes the selected row, and shows the toast', async () => {
    mockAuthorizedList();
    fetchMock.mockResponseOnce(JSON.stringify({
      paidTier: 'tier1', promotion: { tier: 'tier2', expiresAt: '2099-01-01T00:00:00.000Z' },
      usage: { aiUsed: 0, transcriptionSecondsUsed: 0, periodStart: '2026-07-01T00:00:00.000Z' },
    }));
    render(<AdminPage />);

    fireEvent.click(await screen.findByText('beta@example.com'));
    fireEvent.change(screen.getByLabelText('admin.paidTier'), { target: { value: 'tier1' } });
    fireEvent.click(screen.getByRole('button', { name: 'admin.users.save' }));

    expect(await screen.findByText('admin.users.toastSaved')).toBeInTheDocument();
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/admin/users/user-beta/entitlement');
    const betaRow = within(screen.getByRole('table')).getByText('beta@example.com').closest('tr');
    expect(within(betaRow as HTMLTableRowElement).getByText('admin.users.tiers.tier2')).toBeInTheDocument();
  });

  it('does not rewrite a prefilled promotion when only another entitlement field changes', async () => {
    mockAuthorizedList();
    fetchMock.mockResponseOnce(JSON.stringify({ paidTier: 'tier2', promotion: users[0].promotion, usage: users[0].usage }));
    render(<AdminPage />);

    fireEvent.click(await screen.findByText('alpha@example.com'));
    fireEvent.change(screen.getByLabelText('admin.paidTier'), { target: { value: 'tier2' } });
    fireEvent.click(screen.getByRole('button', { name: 'admin.users.save' }));

    await screen.findByText('admin.users.toastSaved');
    const body = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body));
    expect(body.paidTier).toBe('tier2');
    expect(body).not.toHaveProperty('promotion');
  });

  it('clears selected privileges when the drawer UID is changed manually', async () => {
    mockAuthorizedList();
    render(<AdminPage />);

    fireEvent.click(await screen.findByText('alpha@example.com'));
    fireEvent.change(screen.getByLabelText('admin.targetUid'), { target: { value: 'manual-user' } });

    expect(screen.queryByText('inviter-uid')).not.toBeInTheDocument();
    expect(screen.getByLabelText('admin.paidTier')).toHaveValue('');
    expect(screen.getByLabelText('admin.role')).toHaveValue('');
    expect(screen.getByLabelText('admin.aiUsage')).toHaveValue(null);
    expect(screen.getByLabelText('admin.transcriptionSeconds')).toHaveValue(null);
    expect(screen.getByRole('button', { name: 'admin.users.promo.unchanged' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('saves all three catalog-backed model defaults and shows success feedback', async () => {
    mockAuthorizedList();
    const savedDefaults = {
      ...modelDefaults,
      stored: {
        text: { providerId: 'openrouter', modelId: 'deepseek/deepseek-v4-pro' },
        transcription: { providerId: 'openai', modelId: 'gpt-4o-mini-transcribe' },
        tts: { providerId: 'openai', modelId: 'gpt-4o-mini-tts' },
      },
      effective: {
        text: { providerId: 'openrouter', modelId: 'deepseek/deepseek-v4-pro' },
        transcription: { providerId: 'openai', modelId: 'gpt-4o-mini-transcribe' },
        tts: { providerId: 'openai', modelId: 'gpt-4o-mini-tts' },
      },
    };
    fetchMock.mockResponseOnce(JSON.stringify(savedDefaults));
    render(<AdminPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'admin.modelDefaults.nav.modelDefaults' }));
    const textProvider = screen.getByLabelText('admin.modelDefaults.functions.text: admin.modelDefaults.provider');
    await waitFor(() => expect(textProvider).toBeEnabled());
    fireEvent.change(textProvider, { target: { value: 'openrouter' } });
    fireEvent.change(screen.getByLabelText('admin.modelDefaults.functions.text: admin.modelDefaults.model'), { target: { value: 'deepseek/deepseek-v4-pro' } });
    fireEvent.change(screen.getByLabelText('admin.modelDefaults.functions.transcription: admin.modelDefaults.model'), { target: { value: 'gpt-4o-mini-transcribe' } });
    fireEvent.change(screen.getByLabelText('admin.modelDefaults.functions.tts: admin.modelDefaults.provider'), { target: { value: 'openai' } });
    fireEvent.click(screen.getByRole('button', { name: 'admin.modelDefaults.save' }));

    expect(await screen.findByText('admin.modelDefaults.success')).toBeInTheDocument();
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/admin/ai-defaults');
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual(savedDefaults.effective);
  });
});
