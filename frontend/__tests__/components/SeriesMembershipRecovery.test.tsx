import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

import { SeriesMembershipDialog } from '@/components/series/SeriesMembershipDialog';
import { SeriesMembershipRecovery } from '@/components/series/SeriesMembershipRecovery';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';
import { settleEngine } from '../../test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/hooks/useGroupsRead', () => ({ useGroupsRead: () => ({ groups: [{ id: 'g', title: 'Meeting' }], loading: false, error: null }) }));
jest.mock('@/hooks/useDashboardSermons', () => ({ useDashboardSermons: () => ({ sermons: [], loading: false, error: null }) }));

it('offers an unsent action after its originating page closes and recovers it without sending', async () => {
  process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'series';
  const harness = membershipEngineHarness([{ resource: { collection: 'series', id: 's' }, metadata: null,
    value: { userId: 'owner', title: 'Series', items: [], sermonIds: [], seriesKind: 'sermon' } }]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  function Workspace() {
    const [pageOpen, setPageOpen] = useState(true);
    return <DataEngineProvider><SeriesMembershipRecovery />{pageOpen
      ? <SeriesMembershipDialog seriesId="s" mode="group" onClose={() => setPageOpen(false)} /> : <h1>Another page</h1>}
    </DataEngineProvider>;
  }
  const view = render(<Workspace />);
  try {
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Meeting' })); await act(async () => { await settleEngine(); });
    expect(screen.queryByRole('heading', { name: 'workspaces.series.membershipRecovery' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
    await screen.findByRole('heading', { name: 'Another page' });
    const heading = await screen.findByRole('heading', { name: 'workspaces.series.membershipRecovery' });
    const panel = within(heading.parentElement!);
    await waitFor(() => expect(panel.getByRole('combobox')).toBeEnabled());
    fireEvent.change(panel.getByRole('combobox'), { target: { value: panel.getByRole('option', { name: 'Series' }).getAttribute('value') } });
    fireEvent.click(panel.getByRole('button', { name: 'dataSync.recover' }));
    expect(await screen.findByRole('checkbox', { name: 'Meeting' })).toBeChecked();
    expect(harness.transport.send).not.toHaveBeenCalled();
  } finally { view.unmount(); delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; }
});
