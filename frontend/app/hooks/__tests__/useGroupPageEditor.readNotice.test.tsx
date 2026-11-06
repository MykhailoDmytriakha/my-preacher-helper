import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { RecordUnavailable } from '@/components/RecordUnavailable';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { useGroupPageEditor } from '@/hooks/useGroupPageEditor';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function MissingGroup() {
  const editor = useGroupPageEditor('missing-group');
  return <RecordUnavailable presence={editor.presence} checking={editor.loading} readNotice={editor.readNotice}
    onBack={jest.fn()} onRetry={editor.refresh}>{editor.feedback}</RecordUnavailable>;
}

it('claims both independently failed readers of the same uncached group, including the meeting form', async () => {
  const online = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
  const harness = documentEngineHarness({ resource: { collection: 'groups', id: 'missing-group' }, value: null, metadata: null });
  const browser = harness.createBrowser(); browser.engine.setOnline(false); browser.engine.setOwner('owner');
  // Reproduce the public cache-miss rejection seen by both real document hooks in the native run.
  const opening = jest.spyOn(browser.engine, 'openEditor').mockRejectedValue(new Error('The document is not available in the local cache'));
  jest.mocked(createBrowserDataEngine).mockReturnValue(browser);
  const view = render(<DataEngineProvider><MissingGroup /></DataEngineProvider>);
  try {
    await screen.findByText('recordAvailability.notHereYet');
    await act(async () => { await settleEngine(); });
    await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0));
    expect(screen.getAllByRole('button', { name: 'dataSync.retry' })).toHaveLength(1);
    expect(opening.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(harness.transport.send).not.toHaveBeenCalled();
  } finally {
    view.unmount(); await act(settleEngine); opening.mockRestore();
    if (online) Object.defineProperty(window.navigator, 'onLine', online); else Reflect.deleteProperty(window.navigator, 'onLine');
    jest.mocked(createBrowserDataEngine).mockReset();
  }
});
