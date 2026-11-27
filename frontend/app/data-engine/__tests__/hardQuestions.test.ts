import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import { usesActionClock, readsDocumentActionClock } from '../actionClock';
import { ACTION_SLOT } from '../editorIdentity';
import { isEngineOwned } from '../engineOwnedCollections';
import { getResourcePolicy } from '../protocol';
import { validateResourceDocument } from '../resourceSchemas';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

/**
 * Hard questions (`/care/questions`): a theme document holding its groups and bases, and one
 * document per question — both written only through the engine (`hooks/useHardQuestions.ts`).
 */
const theme = (overrides: Record<string, unknown> = {}) => ({
  userId: 'owner', title: 'Одежда', rank: 1000,
  groups: [{ id: 'g1', title: 'Длина' }],
  bases: [{ id: 'b1', title: 'Мерило — стыдливость', label: 'стыдливость', text: 'Слова.', scriptureRefs: ['1 Тим 2:9'] }],
  createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z',
  ...overrides,
});
const question = (overrides: Record<string, unknown> = {}) => ({
  userId: 'owner', title: 'Можно ли носить брюки?', themeId: 't1', groupId: 'g1', rank: 1000,
  alternates: ['Грех ли брюки?'], short: 'Сами по себе — нет.', detail: 'Разбор.', differ: 'Общины решают по-разному.',
  scriptureRefs: ['Втор 22:5'], basisIds: ['b1'],
  createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z',
  ...overrides,
});

describe('hard questions on the engine', () => {
  it('owns both collections in code, each written and removed by its own person', () => {
    for (const collection of ['hardQuestionThemes', 'hardQuestions']) {
      expect(isEngineOwned(collection)).toBe(true);
      const policy = getResourcePolicy(collection);
      expect(policy.ownerField).toBe('userId');
      expect(policy.allowDelete).toBe(true);
      expect(usesActionClock(collection)).toBe(true);
      expect(readsDocumentActionClock(collection)).toBe(true);
    }
    expect(getResourcePolicy('hardQuestionThemes').writableFields).toEqual(expect.arrayContaining(['title', 'intro', 'rank', 'groups', 'bases']));
    expect(getResourcePolicy('hardQuestions').writableFields).toEqual(expect.arrayContaining(
      ['title', 'themeId', 'groupId', 'rank', 'alternates', 'short', 'detail', 'differ', 'scriptureRefs', 'basisIds']));
  });

  it('keeps a full theme and a theme with nothing but its title and place', () => {
    expect(() => validateResourceDocument('hardQuestionThemes', theme(), { kind: 'create' })).not.toThrow();
    const { groups: _groups, bases: _bases, ...bare } = theme();
    expect(() => validateResourceDocument('hardQuestionThemes', bare, { kind: 'create' })).not.toThrow();
  });

  it('refuses a theme without a title or a place, with a repeated group or basis, or with a field it does not know', () => {
    expect(() => validateResourceDocument('hardQuestionThemes', theme({ title: '' }), { kind: 'create' })).toThrow();
    expect(() => validateResourceDocument('hardQuestionThemes', theme({ rank: 'first' }), { kind: 'create' })).toThrow();
    expect(() => validateResourceDocument('hardQuestionThemes', theme({ groups: [{ id: 'g1', title: 'A' }, { id: 'g1', title: 'B' }] }), { kind: 'create' })).toThrow();
    expect(() => validateResourceDocument('hardQuestionThemes', theme({ bases: [{ title: 'no id' }] }), { kind: 'create' })).toThrow();
    expect(() => validateResourceDocument('hardQuestionThemes', theme({ color: 'red' }), { kind: 'create' })).toThrow('Unknown field in new document');
  });

  it.each([undefined, [], ['John 99:1']])('requires a new basis to have a readable place (%j)', (scriptureRefs) => {
    expect(() => validateResourceDocument('hardQuestionThemes',
      theme({ bases: [{ id: 'b1', title: 'Basis', ...(scriptureRefs && { scriptureRefs }) }] }), { kind: 'create' }))
      .toThrow('Scripture');
  });

  it('does not require adding references to a legacy basis that was only reordered', () => {
    const old = { id: 'legacy', title: 'Legacy basis' };
    const current = { id: 'newer', title: 'Newer basis', scriptureRefs: ['Ів 3:16'] };
    const opening = theme({ bases: [old, current] });
    const next = { kind: 'update', previous: opening, changedFields: ['bases'] } as const;
    expect(() => validateResourceDocument('hardQuestionThemes', theme({ bases: [current, old] }), next)).not.toThrow();
    expect(() => validateResourceDocument('hardQuestionThemes',
      theme({ bases: [current, { ...old, text: 'New words' }] }), next)).toThrow('Scripture');
    expect(() => validateResourceDocument('hardQuestionThemes',
      theme({ bases: [current, { ...old, scriptureRefs: ['Ин 3:16'] }] }), next)).not.toThrow();
  });

  it('keeps a question answered in full and a question written down to be answered later, with no theme', () => {
    expect(() => validateResourceDocument('hardQuestions', question(), { kind: 'create' })).not.toThrow();
    const waiting = { userId: 'owner', title: 'Можно ли ЭКО?', rank: 1000, createdAt: 'n', updatedAt: 'n' };
    expect(() => validateResourceDocument('hardQuestions', waiting, { kind: 'create' })).not.toThrow();
  });

  it('refuses a question without words or a place, or with a field it does not know (nothing about who asked)', () => {
    expect(() => validateResourceDocument('hardQuestions', question({ title: '' }), { kind: 'create' })).toThrow();
    const { rank: _rank, ...unplaced } = question();
    expect(() => validateResourceDocument('hardQuestions', unplaced, { kind: 'create' })).toThrow();
    expect(() => validateResourceDocument('hardQuestions', question({ askedBy: 'Надежда' }), { kind: 'create' })).toThrow('Unknown field in new document');
  });

  it.each([
    ['hardQuestions', 'short', question()],
    ['hardQuestionThemes', 'intro', theme({ intro: 'Opening introduction' })],
  ] as const)('captures the manual Save time for %s %s', async (collection, field, value) => {
    const resource = { collection, id: 'opened-hard-question' };
    const h = documentEngineHarness({ resource, value, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } });
    const browser = h.createBrowser();
    browser.engine.setOwner('owner');
    browser.engine.setOnline(true);
    const time = { earliestMs: 1_800_000_000_020, latestMs: 1_800_000_000_025 };
    try {
      const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
      const form = editor.form('authored-words', [[field]]);
      await form.begin();
      await form.update(current => ({ ...current, [field]: 'The new words' }));
      await form.save(undefined, { documentMetadata: { time } });
      await browser.engine.retry();
      await settleEngine();
      expect(h.transport.send).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'update', resource, hardQuestionFieldActions: { [field]: { observedRevision: 1, time } },
      }));
      expect(h.server.value?.[field]).toBe('The new words');
    } finally {
      browser.dispose();
      await settleEngine();
    }
  });

  it('creates a question offline, keeps it across a restart and delivers it when the network returns', async () => {
    const resource = { collection: 'hardQuestions', id: 'offline-question' };
    const h = documentEngineHarness({ resource, value: null, metadata: null });
    let browser = h.createBrowser();
    browser.engine.setOnline(false);
    browser.engine.setOwner('owner');
    try {
      const creator = await browser.engine.createEditor(resource, browser.editorId(resource, ACTION_SLOT));
      await creator.commit(() => question());
      await creator.close({ flush: false });
      expect(h.transport.send).not.toHaveBeenCalled();
      browser.dispose();
      await settleEngine();

      browser = h.createBrowser();
      browser.engine.setOwner('owner');
      browser.engine.setOnline(true);
      await browser.engine.retry();
      await settleEngine();
      expect(h.server.value).toMatchObject({ title: 'Можно ли носить брюки?', basisIds: ['b1'] });
    } finally {
      browser.dispose();
      await settleEngine();
    }
  });
});
