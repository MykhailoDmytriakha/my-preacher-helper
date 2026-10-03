import { render, screen } from '@testing-library/react';

import { UserSettingsEngineContext } from '@/hooks/userSettingsEngineContext';
import { UserSettingsSyncStatus } from '@/providers/UserSettingsProvider';

import type { useDataDocument } from '@/data-engine/react.client';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', changeLanguage: jest.fn() } }),
}));

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useRecoveryDiscovery: () => ({ choices: [], loading: false, error: null, recover: jest.fn() }),
}));

type SettingsDocument = ReturnType<typeof useDataDocument>;

const READ_ONLY_REASON = 'Read only for now: the storage on this device is not answering.';

const renderStatus = (overrides: Partial<SettingsDocument>) => {
  const document = {
    loading: false, status: null, error: null, readOnly: false, readOnlyReason: null,
    recoveryIdentity: 'users:u1', confirmed: null, listRecoverable: jest.fn(async () => []),
    recover: jest.fn(), retry: jest.fn(), keepLocal: jest.fn(), acceptRemote: jest.fn(),
    ...overrides,
  } as unknown as SettingsDocument;
  return render(
    <UserSettingsEngineContext.Provider value={{ owner: 'u1', document }}>
      <UserSettingsSyncStatus />
    </UserSettingsEngineContext.Provider>
  );
};

describe('UserSettingsSyncStatus above every page', () => {
  it('stays silent while the settings are only a copy for reading: the device storage notice says why', () => {
    const { container } = renderStatus({ readOnly: true, readOnlyReason: READ_ONLY_REASON });
    expect(screen.queryByText(READ_ONLY_REASON)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'dataSync.retry' })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('still names the settings and offers a retry when a real failure happens', () => {
    renderStatus({ error: 'The settings could not be delivered.' });
    expect(screen.getByRole('region', { name: 'settings.title' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The settings could not be delivered.');
    expect(screen.getByRole('button', { name: 'dataSync.retry' })).toBeInTheDocument();
  });
});
