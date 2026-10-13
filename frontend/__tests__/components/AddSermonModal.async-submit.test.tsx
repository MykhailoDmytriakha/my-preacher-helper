import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import AddSermonModal from '@/components/AddSermonModal';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';

import { settleEngine } from '../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';
import '@testing-library/jest-dom';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/church/ChurchField', () => ({ __esModule: true, default: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons,series';
});
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

describe('AddSermonModal async submit flow (data engine)', () => {
  it('does not create the sermon twice when Save is pressed again, and closes once it is queued', async () => {
    const harness = membershipEngineHarness([]);
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    const onClose = jest.fn();
    function ControlledModal() {
      const [open, setOpen] = React.useState(true);
      return <AddSermonModal isOpen={open} showTriggerButton={false} onClose={() => { onClose(); setOpen(false); }} />;
    }
    const view = render(<DataEngineProvider><ControlledModal /></DataEngineProvider>);

    const title = await screen.findByLabelText('addSermon.titleLabel');
    await waitFor(() => expect(title).toBeEnabled());
    fireEvent.change(title, { target: { value: 'Async Sermon Title' } });
    fireEvent.change(screen.getByLabelText('addSermon.verseLabel'), { target: { value: 'John 3:16' } });
    await act(async () => { await settleEngine(); });

    const save = screen.getByRole('button', { name: 'addSermon.save' });
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await act(async () => { await harness.engine.retry(); await settleEngine(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    const commits = await harness.commits.list('owner');
    expect(commits).toHaveLength(1);
    expect(harness.read(commits[0].baseline.resource).value).toMatchObject({ title: 'Async Sermon Title', verse: 'John 3:16' });
    expect(jest.mocked(harness.transport.send).mock.calls.filter(([command]) => command.kind === 'create')).toHaveLength(1);
    view.unmount();
  });
});
