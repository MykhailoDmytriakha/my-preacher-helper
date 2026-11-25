import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { DataSession } from '@/data-engine/session';
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
  it('lists both recovered settings and lets the user apply a different version of each', async () => {
    const resource = { collection: 'users', id: 'u1' };
    const metadata = { protocol: 1 as const, generation: 'settings-generation', revision: 8, deleted: false };
    const opening = { reading: { crossReferences: { show: true, mode: 'main', inWindow: true } } };
    const draft = { reading: { crossReferences: { show: false, mode: 'all', inWindow: true } } };
    const saved = { reading: { crossReferences: { show: true, mode: 'main', inWindow: false } } };
    const checkpoint = DataSession.restore({
      confirmed: { resource, value: opening, metadata },
      draft, dirty: true, editGeneration: 1, conflicts: [], pending: {},
      remoteCandidate: { resource, value: saved, metadata: { ...metadata, revision: 9 } },
      unreadableScalarProof: ['reading.crossReferences.show', 'reading.crossReferences.mode'],
    }).checkpoint();
    const apply = jest.fn();
    const document = {
      state: { checkpoint, durable: true, error: null, result: null },
      status: { phase: 'conflict', canKeepLocal: true, canAcceptRemote: true },
      applyAccountPreferenceReview: apply,
    };
    renderStatus(document as unknown as Partial<SettingsDocument>);
    const visible = screen.getByRole('group', { name: 'settings.bible.crossRefs.marks' });
    const mode = screen.getByRole('group', { name: 'settings.bible.crossRefs.count' });
    const submit = screen.getByRole('button', { name: 'dataSync.applyReviewedVersions' });
    expect(submit).toBeDisabled();
    fireEvent.click(within(visible).getByRole('radio', { name: /dataSync.storedVersion/ }));
    expect(submit).toBeDisabled();
    fireEvent.click(within(mode).getByRole('radio', { name: /dataSync.yourVersion/ }));
    expect(apply).not.toHaveBeenCalled();
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply).toHaveBeenCalledWith(checkpoint, { 'reading.crossReferences.show': 'remote', 'reading.crossReferences.mode': 'local' });
  });

});
