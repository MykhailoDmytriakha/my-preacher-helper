import { mergeDocumentFields } from '../protocol';
import { documentEngineHarness, settleEngine } from '../../../test-utils/documentEngineHarness';

import type { DocumentData, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

/*
 * BUG-20261107-marks-same-verse-offline-conflict — the owner's iPad, 2026-11-07 (2 Cor 4:6): sixteen marker strokes made
 * offline in a verse that already had marks came back as a conflict, with no edit of that verse on another device. A verse
 * layer was merged as one string, so strokes on different words of one verse collided. Words now merge one by one; only a
 * word changed differently on both sides is the person's question.
 */
const resource = { collection: 'bibleMarks', id: 'owner_rst_isaiah' };
const fields = { userId: 'owner', bible: 'rst', book: 'Isaiah', createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z' };
const book = (verses: DocumentData): DocumentData => ({ ...fields, verses });
const stored = (verses: DocumentData): ResourceSnapshot => ({ resource, value: book(verses), metadata: { protocol: 1, generation: 'existing-book', revision: 1, deleted: false } });
const versesOf = (value: unknown) => (value as DocumentData | null)?.verses;

describe('a verse\'s marks merged word by word', () => {
  it('lays strokes made offline in a book this device never had beside the marks already in that verse', async () => {
    const harness = documentEngineHarness(stored({ v4_6: { m: '0-2-yellow' } }), { cached: false });
    const engine = harness.createBrowser().engine;
    engine.setOnline(false); engine.setOwner('owner');
    const editor = await engine.createEditor(resource, 'offline-book');
    try {
      await editor.commit(() => book({ v4_6: { m: '10-14-yellow' } }));
      engine.setOnline(true); await engine.retry(); await settleEngine();
      expect(editor.getState().result?.kind).toBe('acknowledged');
      expect(versesOf(harness.server.value)).toEqual({ v4_6: { m: '0-2-yellow,10-14-yellow' } });
      expect(editor.getState().checkpoint.conflicts).toEqual([]);
    } finally { engine.dispose(); }
  });

  it('lays offline strokes beside other words of the same verse changed on another device meanwhile', async () => {
    const harness = documentEngineHarness(stored({ v4_6: { m: '0-2-yellow' } }));
    const browser = harness.createBrowser();
    const engine = browser.engine;
    engine.setOnline(false); engine.setOwner('owner');
    const editor = await engine.openEditor(resource, browser.editorId(resource));
    try {
      await editor.commit((value) => ({ ...value!, verses: { v4_6: { m: '0-2-yellow,10-14-yellow' } } }));
      harness.silentRemote({ verses: { v4_6: { m: '0-2-yellow,20-22-green' } } });
      engine.setOnline(true); await engine.retry(); await settleEngine();
      expect(editor.getState().result?.kind).toBe('acknowledged');
      expect(versesOf(harness.server.value)).toEqual({ v4_6: { m: '0-2-yellow,10-14-yellow,20-22-green' } });
    } finally { engine.dispose(); }
  });

  it('still asks when the same word was changed differently on both sides', async () => {
    const harness = documentEngineHarness(stored({ v4_6: { m: '0-2-yellow' } }));
    const browser = harness.createBrowser();
    const engine = browser.engine;
    engine.setOnline(false); engine.setOwner('owner');
    const editor = await engine.openEditor(resource, browser.editorId(resource));
    try {
      await editor.commit((value) => ({ ...value!, verses: { v4_6: { m: '0-2-red' } } }));
      harness.silentRemote({ verses: { v4_6: { m: '0-2-green' } } });
      engine.setOnline(true); await engine.retry(); await settleEngine();
      expect(editor.getState().result?.kind).toBe('conflict');
      expect(versesOf(harness.server.value)).toEqual({ v4_6: { m: '0-2-green' } });
    } finally { engine.dispose(); }
  });

  describe('the merge itself', () => {
    const merge = (base: DocumentData, mine: DocumentData, theirs: DocumentData) => mergeDocumentFields(book(base), book(mine), book(theirs));

    it.each([
      ['different words, one layer', { v4_6: { m: '0-2-yellow' } }, { v4_6: { m: '0-2-yellow,5-6-red' } }, { v4_6: { m: '0-2-yellow,9-9-blue' } }, { v4_6: { m: '0-2-yellow,5-6-red,9-9-blue' } }],
      ['a word erased here, others added there', { v4_6: { m: '0-4-yellow' } }, { v4_6: { m: '0-1-yellow,3-4-yellow' } }, { v4_6: { m: '0-4-yellow,8-8-red' } }, { v4_6: { m: '0-1-yellow,3-4-yellow,8-8-red' } }],
      ['the whole verse erased here, other words added there', { v4_6: { m: '0-2-yellow' } }, {}, { v4_6: { m: '0-2-yellow,7-7-red' } }, { v4_6: { m: '7-7-red' } }],
      ['the pencil the same way', { v4_6: { p: '0-1-gray' } }, { v4_6: { p: '0-1-gray,4-5-blue' } }, { v4_6: { p: '0-3-gray' } }, { v4_6: { p: '0-3-gray,4-5-blue' } }],
      ['the same words changed the same way', { v4_6: { m: '0-2-yellow' } }, { v4_6: { m: '0-5-yellow' } }, { v4_6: { m: '0-2-yellow,3-5-yellow' } }, { v4_6: { m: '0-5-yellow' } }],
      ['a layer erased there while part of it is erased here', { v4_6: { m: '0-2-yellow' } }, { v4_6: { m: '1-1-yellow' } }, { v4_6: { p: '3-3-gray' } }, { v4_6: { p: '3-3-gray' } }],
    ])('merges %s', (_name, base, mine, theirs, merged) => {
      const result = merge(base, mine, theirs);
      expect(result.conflicts).toEqual([]);
      expect(versesOf(result.value.exists ? result.value.value : null)).toEqual(merged);
    });

    it.each([
      ['a word recoloured on both sides', { v4_6: { m: '0-2-yellow' } }, { v4_6: { m: '0-2-red' } }, { v4_6: { m: '0-2-green' } }],
      ['a word erased here and recoloured there', { v4_6: { m: '0-2-yellow' } }, { v4_6: { m: '0-1-yellow' } }, { v4_6: { m: '0-1-yellow,2-2-red' } }],
      ['a layer that does not read back', { v4_6: { m: '0-2-yellow' } }, { v4_6: { m: '0-2-yellow,5-6-red' } }, { v4_6: { m: '0-2-yellow,x' } }],
      ['a verse erased whole there and a word of it recoloured here', { v4_6: { m: '0-2-yellow' } }, { v4_6: { m: '0-1-yellow,2-2-red' } }, {}],
    ])('asks about %s', (_name, base, mine, theirs) => {
      expect(merge(base, mine, theirs).conflicts).toHaveLength(1);
    });

    // Codex review: a damaged stored run is never walked word by word — a billion words merge at once, an inexact number is a
    // question, a run that ends before it starts too.
    it('merges a damaged long run at once and asks about numbers it cannot hold exactly', () => {
      const started = Date.now();
      const long = merge({ v4_6: { m: '0-0-red' } }, { v4_6: { m: '0-0-red,5-1000000000-blue' } }, { v4_6: { m: '0-0-red,2-2-green' } });
      expect(Date.now() - started).toBeLessThan(500);
      expect(long.conflicts).toEqual([]);
      expect(versesOf(long.value.exists ? long.value.value : null)).toEqual({ v4_6: { m: '0-0-red,2-2-green,5-1000000000-blue' } });
      expect(merge({ v4_6: { m: '0-0-red' } }, { v4_6: { m: '0-0-red,9007199254740992-9007199254740992-red' } }, { v4_6: { m: '0-0-red,2-2-green' } }).conflicts).toHaveLength(1);
      expect(merge({ v4_6: { m: '0-0-red' } }, { v4_6: { m: '0-0-red,7-5-red' } }, { v4_6: { m: '0-0-red,2-2-green' } }).conflicts).toHaveLength(1);
    });
  });
});
