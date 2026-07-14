import { render, screen, waitFor } from '@testing-library/react';
import fetchMock from 'jest-fetch-mock';
import React from 'react';

import SettingsPage from '@/(pages)/(private)/settings/page';
import { auth } from '@/services/firebaseAuth.service';

jest.mock('@/services/firebaseAuth.service', () => ({
  auth: {
    onAuthStateChanged: jest.fn(),
  },
}));

jest.mock('@/components/navigation/LanguageInitializer', () => () => <div />);
jest.mock('@/components/settings/AudioGenerationToggle', () => () => <div />);
jest.mock('@/components/settings/DebugModeToggle', () => () => <div />);
jest.mock('@/components/settings/GroupsFeatureToggle', () => () => <div />);
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
  const mockOnAuthStateChanged = jest.mocked(auth.onAuthStateChanged);
  const mockGetIdToken = jest.fn().mockResolvedValue('firebase-id-token');
  const adminUser = { uid: 'admin-uid', getIdToken: mockGetIdToken };

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.resetMocks();
    mockOnAuthStateChanged.mockImplementation((callback) => {
      if (typeof callback === 'function') callback(adminUser as never);
      return jest.fn();
    });
  });

  it('shows the admin link only when the server confirms administrator access', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ admin: true }));

    render(<SettingsPage />);

    const links = await screen.findAllByRole('link', { name: 'settings.admin.goToAdmin' });
    expect(links).toHaveLength(2);
    links.forEach((link) => expect(link).toHaveAttribute('href', '/admin'));
  });

  it('does not show the admin link when the server denies access', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

    render(<SettingsPage />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryAllByRole('link', { name: 'settings.admin.goToAdmin' })).toHaveLength(0);
  });
});
