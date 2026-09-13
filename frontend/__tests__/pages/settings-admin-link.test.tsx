import { render, screen, waitFor } from '@testing-library/react';
import fetchMock from 'jest-fetch-mock';
import React from 'react';

import SettingsShell from '@/(pages)/(private)/settings/layout';

const mockGetIdToken = jest.fn().mockResolvedValue('firebase-id-token');
const adminUser = { uid: 'admin-uid', getIdToken: mockGetIdToken };
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: adminUser, loading: false }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@/hooks/useDocumentFreshness', () => ({
  useDocumentFreshness: () => ({ state: 'fresh', remote: null, remotelyDeleted: false, markSynced: jest.fn() }),
}));

jest.mock('@/components/navigation/LanguageInitializer', () => () => <div />);
jest.mock('@/components/settings/AudioGenerationToggle', () => () => <div />);
jest.mock('@/components/settings/DebugModeToggle', () => () => <div />);
jest.mock('@/components/settings/ModelSelector', () => () => <div />);
jest.mock('@/components/settings/PlanTemplatesSection', () => () => <div />);
jest.mock('@/components/settings/PrepModeToggle', () => () => <div />);
jest.mock('@/components/settings/SettingsLayout', () => ({ children }: { children: React.ReactNode }) => <div>{children}</div>);
jest.mock('@/components/settings/ShowVersionToggle', () => () => <div />);
jest.mock('@/components/settings/StructurePreviewToggle', () => () => <div />);
jest.mock('@/components/settings/TagsSection', () => () => <div />);
jest.mock('@/components/settings/UserSettingsSection', () => () => <div />);
jest.mock('@/components/settings/UsageWidget', () => () => <div />);
jest.mock('@/components/settings/ReferralCard', () => () => <div />);

jest.mock('next/link', () => ({ children, href }: { children: React.ReactNode; href: string }) => (
  <a href={href}>{children}</a>
));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('Settings admin link', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
    mockGetIdToken.mockResolvedValue('firebase-id-token');
  });

  it('shows the admin link only when the server confirms administrator access', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ admin: true }));

    render(<SettingsShell><div /></SettingsShell>);

    const links = await screen.findAllByRole('link', { name: 'settings.admin.goToAdmin' });
    expect(links).toHaveLength(2);
    links.forEach((link) => expect(link).toHaveAttribute('href', '/admin'));
  });

  it('does not show the admin link when the server denies access', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

    render(<SettingsShell><div /></SettingsShell>);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryAllByRole('link', { name: 'settings.admin.goToAdmin' })).toHaveLength(0);
  });
});
