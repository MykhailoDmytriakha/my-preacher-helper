import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';

import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { recoverManualChoiceCopy } from '@/data-engine/manualChoice';
import { applyCommand } from '@/data-engine/protocol';
import { DataEngineProvider, useDocumentActions } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, language: 'en' }) }));
jest.mock('@/hooks/useSermonNoteLinks', () => ({ useStudyNoteDirectory: () => ({
  notes: [{ id: 'debated', title: 'Sermon preparation note', type: 'note', scriptureRefs: [] }], isMissing: () => false,
}) }));

let actions: ReturnType<typeof useDocumentActions> | undefined;
function Actions() {
  const current = useDocumentActions();
  useEffect(() => { actions = current; }, [current]);
  return null;
}

describe('a saved-version choice about sermon source notes', () => {
  beforeEach(() => { process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons,studyNotes'; actions = undefined; });
  afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

  it.each([
    { side: 'mine', separate: false, repeated: false, legacyRoot: false }, { side: 'stored', separate: false, repeated: false, legacyRoot: false },
    { side: 'mine', separate: true, repeated: false, legacyRoot: false }, { side: 'stored', separate: true, repeated: false, legacyRoot: false },
    { side: 'stored', separate: true, repeated: true, legacyRoot: false },
    { side: 'mine', separate: true, repeated: false, legacyRoot: true },
    { side: 'stored', separate: true, repeated: false, legacyRoot: true },
  ])('chooses $side and preserves later work (separate: $separate, repeated: $repeated, legacy: $legacyRoot)', async ({ side, separate, repeated, legacyRoot }) => {
    const resource = { collection: 'sermons', id: 'sermon-choice' };
    const value = { userId: 'owner', title: 'Sermon', verse: 'John 3:16', thoughts: [], sourceNoteIds: ['debated'] };
    const field = (value: boolean) => ({ exists: true as const, value });
    const harness = documentEngineHarness({ resource, value, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } }, {
      apply: (command, current) => {
        if (command.kind === 'update' && !command.sourceNoteLinkAction?.reviewed
          && (command.sourceNoteLinkAction?.changes.some(change => change.noteId === 'debated')
            || (legacyRoot && !command.sourceNoteLinkAction))) {
          return { kind: 'conflict', operationId: command.operationId, snapshot: current, conflicts: [{
            path: ['sourceNoteIds', 'string:debated'], base: field(true), mine: field(false), theirs: field(true),
          }] };
        }
        return applyCommand(command, current);
      },
    });
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    render(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={25} /></DataEngineProvider>);
    await waitFor(() => expect(actions?.ready).toBe(true));
    if (separate) act(() => harness.engine.setOnline(false));
    const opening = await actions!.openSourceNoteLinks(resource);
    harness.silentRemote({ sourceNoteIds: ['debated'] });
    await act(async () => {
      if (legacyRoot) await actions!.commit(resource, current => ({ ...current!, sourceNoteIds: [] }));
      else await actions!.saveSourceNoteLinks(resource, opening, separate ? [] : ['independent'], separate ? ['debated'] : ['debated', 'independent']);
      await settleEngine();
    });
    if (separate) {
      const continuation = await actions!.openSourceNoteLinks(resource);
      expect(continuation.selected).toMatchObject({ exists: true, value: [] });
      const note = repeated ? 'debated' : 'independent';
      await act(async () => { await actions!.saveSourceNoteLinks(resource, continuation, [note], [note]); await settleEngine(); });
      expect(harness.transport.send).not.toHaveBeenCalled();
      act(() => harness.engine.setOnline(true));
      await act(async () => { await harness.engine.retry(); await settleEngine(); });
    }

    const panel = await screen.findByRole('region', { name: 'dataSync.versionComparison' });
    expect(within(panel).getByLabelText('dataSync.yourVersion')).toHaveTextContent('Sermon preparation note · sermon.sourceNotes.unlinked');
    expect(within(panel).getByLabelText('dataSync.storedVersion')).toHaveTextContent('Sermon preparation note · sermon.sourceNotes.linked');
    expect(panel).not.toHaveTextContent('independent');

    fireEvent.click(screen.getByRole('button', { name: side === 'mine' ? 'dataSync.useLocalVersion' : 'dataSync.useStoredVersion' }));
    if (side === 'stored') fireEvent.click(await screen.findByRole('button', { name: 'dataSync.confirmStoredField.confirm' }));
    await waitFor(() => expect(panel).not.toBeInTheDocument());
    if (repeated) {
      const copies = await harness.engine.listRecoveryChoices(resource, true);
      expect(copies).toHaveLength(1);
      const recovered = recoverManualChoiceCopy(copies[0].record).checkpoint;
      expect(recovered.sourceNoteLinkRetry).toMatchObject({ action: { time: null, observedRevision: 1,
        changes: [{ noteId: 'debated', linked: true, predecessorOperationId: expect.any(String) }] } });
      expect(recovered.dirty).toBe(true);
      expect(harness.server.value?.sourceNoteIds).toEqual(['debated']);
      return;
    }
    await waitFor(() => expect(harness.server.value?.sourceNoteIds).toEqual(side === 'mine' ? ['independent'] : ['debated', 'independent']));
    expect(harness.transport.send).toHaveBeenCalledWith(expect.objectContaining({
      sourceNoteLinkAction: expect.objectContaining({ reviewed: true, observedRevision: 2,
        changes: expect.arrayContaining([expect.objectContaining({ noteId: 'independent', linked: true,
          prior: { before: false, observedRevision: 1, time: null } })]) }),
    }));
  });
});
