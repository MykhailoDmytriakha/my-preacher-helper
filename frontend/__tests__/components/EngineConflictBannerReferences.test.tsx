import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';

import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { editorIdentity } from '@/data-engine/editorIdentity';
import { DataEngineProvider, useDocumentActions } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { ScriptureReference } from '@/models/models';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
let mockLanguage = 'en';
const mockTranslate = (key: string) => key;
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: mockTranslate, language: mockLanguage }) }));

const resource = { collection: 'studyNotes', id: 'note-reference-choice' };
const unchanged = { id: 'untouched-reference', bible: 'kjv', book: 'Luke', chapter: 1, fromVerse: 1 } satisfies ScriptureReference;
const original = { id: 'changed-reference', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 15 } satisfies ScriptureReference;
const value = { userId: 'owner', title: 'A saved note', content: 'Keep the accepted paragraph.', scriptureRefs: [unchanged, original], tags: [], type: 'note',
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
let actions: ReturnType<typeof useDocumentActions> | null = null;
let lastView: ReturnType<typeof render>;
function Actions() { const current = useDocumentActions(); useEffect(() => { actions = current; }); return null; }

async function preview(reference: Omit<ScriptureReference, 'id'> & Record<string, unknown>, screenOwned = false) {
  const harness = documentEngineHarness({ resource, value, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  lastView = render(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={25} /></DataEngineProvider>);
  await waitFor(() => expect(actions?.ready).toBe(true));
  harness.silentRemote({ scriptureRefs: [unchanged, { ...original, fromVerse: 18 }] });
  const mine = { id: original.id, ...reference };
  const editor = screenOwned ? await harness.engine.openEditor(resource, editorIdentity('test-tab', resource, 'default', 'note-page')) : null;
  await act(async () => {
    if (editor) { await editor.edit({ ...value, scriptureRefs: [unchanged, mine] }); await editor.save(); }
    else await actions!.commit(resource, current => ({ ...current!, scriptureRefs: [unchanged, mine] }));
    await settleEngine(); await settleEngine();
  });
  editor?.close({ flush: false });
  await screen.findByText(screenOwned ? 'dataSync.screenDraftBody' : 'freshness.conflictTitle');
  const shown = screen.getByText(/legacyRecovery\.field\.scriptureRefs:/).textContent ?? '';
  expect(shown).not.toContain('untouched-reference');
  expect(shown).not.toContain('Luke');
  expect(shown).not.toMatch(/\b1:1\b/);
  expect(harness.server.value?.scriptureRefs).toEqual([unchanged, { ...original, fromVerse: 18 }]);
  expect(harness.server.value?.content).toBe(value.content);
  return shown;
}

describe('readable complete references in a saved-version choice', () => {
  beforeEach(() => { process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'studyNotes'; mockLanguage = 'en'; actions = null; });
  afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

  it('shows a numeric-only verse change instead of only the unchanged book', async () => {
    const shown = await preview({ bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 });
    expect(shown).toContain('John 3:16');
    expect(shown).not.toMatch(/changed-reference|kjv|fromVerse/);
  });

  it.each([
    ['ru', { bible: 'kjv', book: 'Psalms', chapter: 51, fromVerse: 10 }, '\u041f\u0441\u0430\u043b\u0442\u0438\u0440\u044c 50:12'],
    ['en', { bible: 'rst', book: 'Psalms', chapter: 50, fromVerse: 12 }, 'Psalms 51:10'],
    ['uk', { bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 }, '\u0412\u0456\u0434 \u0406\u0432\u0430\u043d\u0430 3:16'],
    ['ru', { book: 'Psalms', chapter: 51, fromVerse: 12 }, '\u041f\u0441\u0430\u043b\u0442\u0438\u0440\u044c 50:12'],
    ['en', { bible: 'rst', book: 'Isaiah', chapter: 52, fromVerse: 13, endChapter: 53, toVerse: 12 }, 'Isaiah 52:13-53:12'],
    ['ru', { bible: 'kjv', book: 'Romans', chapter: 16, fromVerse: 24, toVerse: 27 }, '\u041a \u0420\u0438\u043c\u043b\u044f\u043d\u0430\u043c 14:24-26, 16:24'],
    ['en', { bible: 'kjv', book: 'Matthew', chapter: 5, toChapter: 7 }, 'Matthew 5-7'],
  ] as const)('reads the complete range in %s: %s', async (language, reference, expected) => {
    mockLanguage = language;
    expect(await preview(reference)).toContain(expected);
  });

  it('keeps the authored quotation verbatim beside the complete reference', async () => {
    const text = '  An authored quotation.\nThe next line stays.  ';
    const shown = await preview({ bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16, text });
    expect(shown).toContain('John 3:16');
    expect(shown).toContain(text);
  });

  it('keeps unknown nested evidence readable instead of discarding it during formatting', async () => {
    const shown = await preview({ bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16, evidence: { note: 'Keep this additional evidence', number: 42 } });
    expect(shown).toContain('Keep this additional evidence');
    expect(shown).toContain('42');
  });

  it('shows the complete reference when only its authored quotation changed', async () => {
    const shown = await preview({ bible: 'kjv', book: 'John', chapter: 3, fromVerse: 15, text: 'Newly written quotation' });
    expect(shown).toContain('John 3:15\nNewly written quotation');
  });

  it('keeps malformed coordinates visible without crashing the notice', async () => {
    const shown = await preview({ bible: 'kjv', book: 'John', chapter: 'three' as unknown as number, fromVerse: 16 });
    expect(shown).toContain('three');
    expect(shown).toContain('16');
  });

  it('refreshes the displayed reference when the interface language changes', async () => {
    expect(await preview({ bible: 'rst', book: 'Psalms', chapter: 50, fromVerse: 12 })).toContain('Psalms 51:10');
    mockLanguage = 'ru';
    lastView.rerender(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={25} /></DataEngineProvider>);
    await waitFor(() => expect(screen.getByText(/legacyRecovery\.field\.scriptureRefs:/)).toHaveTextContent('\u041f\u0441\u0430\u043b\u0442\u0438\u0440\u044c 50:12'));
    expect(screen.queryByText(/Psalms 51:10/)).not.toBeInTheDocument();
  });

  it('shows and copies complete references from a screen-owned draft notice', async () => {
    const text = 'My retained quotation';
    const writeText = jest.fn().mockResolvedValue(undefined);
    const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const previousSecure = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      const shown = await preview({ bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16, text }, true);
      expect(shown).toContain('John 3:16\nMy retained quotation');
      fireEvent.click(screen.getByText('freshness.copyTextAction'));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(shown));
    } finally {
      if (previous) Object.defineProperty(navigator, 'clipboard', previous);
      else Reflect.deleteProperty(navigator, 'clipboard');
      if (previousSecure) Object.defineProperty(window, 'isSecureContext', previousSecure);
      else Reflect.deleteProperty(window, 'isSecureContext');
    }
  });

  it('formats a whole-book reference without inventing a chapter', async () => {
    mockLanguage = 'uk';
    const shown = await preview({ bible: 'ubio', book: 'John' });
    expect(shown).toContain('\u0412\u0456\u0434 \u0406\u0432\u0430\u043d\u0430');
    expect(shown).not.toMatch(/undefined|NaN|changed-reference/);
  });
});
