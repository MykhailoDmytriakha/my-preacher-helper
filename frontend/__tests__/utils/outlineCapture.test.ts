import { createEngineStructureWriter } from '@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter';
import { OutlineCapture } from '@/utils/outlineCapture';

import type { DocumentData } from '@/data-engine/types';
import type { SermonOutline } from '@/models/models';

const outline = (first: string, second: string): SermonOutline => ({
  introduction: [], main: [{ id: 'one', text: first }, { id: 'two', text: second }], conclusion: [],
});
const texts = (value: SermonOutline) => value.main.map(point => point.text);

function fixture(stored = outline('First', 'Second')) {
  let current = { userId: 'owner', thoughts: [], outline: stored } as unknown as DocumentData;
  let afterApply: () => Promise<void> = async () => undefined;
  const writer = createEngineStructureWriter({ update: async apply => {
    current = apply(current)!;
    await afterApply();
  } }, 'owner');
  return {
    writer,
    stored: () => current.outline as unknown as SermonOutline,
    persist: (next: () => Promise<void>) => { afterApply = next; },
  };
}

function editor(state: ReturnType<typeof fixture>, opened: SermonOutline) {
  const capture = new OutlineCapture(state.writer, 'sermon');
  const view = { base: opened, shown: opened, failures: [] as unknown[] };
  return { capture, view, input: (next: SermonOutline) => {
    view.shown = next;
    capture.schedule({ outline: next, base: view.base, begin: () => ({
      stored: stored => { view.base = stored; view.shown = stored; },
      failed: error => { view.failures.push(error); },
    }) });
  } };
}

describe('immediate outline capture through the current engine draft', () => {
  it('owns a continuation before disk answers and never publishes its older captured value over it', async () => {
    const opened = outline('First', 'Second');
    const state = fixture(outline('First', 'Second from phone'));
    const releases: Array<() => void> = [];
    state.persist(() => new Promise<void>(resolve => { releases.push(resolve); }));
    const screen = editor(state, opened);
    screen.input(outline('First edit', 'Second'));
    screen.input(outline('Latest edit', 'Second'));
    expect(texts(state.stored())).toEqual(['Latest edit', 'Second from phone']);
    releases[0]();
    await Promise.resolve(); await Promise.resolve();
    expect(texts(screen.view.shown)).toEqual(['Latest edit', 'Second']);
    releases[1]();
    await screen.capture.flush();
    expect(texts(screen.view.shown)).toEqual(['Latest edit', 'Second from phone']);
    expect(screen.view.failures).toEqual([]);
  });

  it('can revert a staged value after local persistence failed without keeping the intermediate words', async () => {
    const opened = outline('First', 'Second');
    const state = fixture(outline('First', 'Second from phone'));
    state.persist(async () => { throw new Error('Disk full'); });
    const screen = editor(state, opened);
    screen.input(outline('Intermediate', 'Second'));
    await screen.capture.flush();
    expect(screen.view.failures).toHaveLength(1);
    expect(texts(state.stored())).toEqual(['Intermediate', 'Second from phone']);
    state.persist(async () => undefined);
    screen.input(opened);
    await screen.capture.flush();
    expect(texts(state.stored())).toEqual(['First', 'Second from phone']);
    expect(texts(screen.view.shown)).toEqual(['First', 'Second from phone']);
  });

  it('does not advance input ancestry after a refused merge and silently drop its refused point on the next edit', async () => {
    const state = fixture(outline('First from phone', 'Second'));
    const screen = editor(state, outline('First', 'Second'));
    screen.input(outline('First from laptop', 'Second'));
    await screen.capture.flush();
    screen.input(outline('First from laptop', 'Second from laptop'));
    await screen.capture.flush();
    expect(screen.view.failures).toHaveLength(2);
    expect(texts(state.stored())).toEqual(['First from phone', 'Second']);
    expect(texts(screen.view.shown)).toEqual(['First from laptop', 'Second from laptop']);
  });

  it('keeps input ancestry private to each editor even when both opened the exact same outline object', async () => {
    const opened = outline('First', 'Second');
    const state = fixture(opened);
    const first = editor(state, opened), second = editor(state, opened);
    first.input(outline('First from editor one', 'Second'));
    await first.capture.flush();
    second.input(outline('First', 'Second from editor two'));
    await second.capture.flush();
    expect(texts(state.stored())).toEqual(['First from editor one', 'Second from editor two']);
    expect(second.view.failures).toEqual([]);
  });

  it('uses the adopted canonical base for a deliberate later rewrite of a previously unseen point', async () => {
    const opened = outline('First', 'Second');
    const state = fixture(outline('First', 'Second from phone'));
    const screen = editor(state, opened);
    screen.input(outline('First edited', 'Second'));
    await screen.capture.flush();
    expect(texts(screen.view.shown)).toEqual(['First edited', 'Second from phone']);
    screen.input(outline('First edited', 'Second'));
    await screen.capture.flush();
    expect(texts(state.stored())).toEqual(['First edited', 'Second']);
    expect(screen.view.failures).toEqual([]);
  });

  it('does not replace newer successful words with a late failure from an older local persistence', async () => {
    let reject!: (error: Error) => void;
    let first = true;
    const state = fixture();
    state.persist(async () => {
      if (first) { first = false; await new Promise<void>((_resolve, fail) => { reject = fail; }); }
    });
    const screen = editor(state, outline('First', 'Second'));
    screen.input(outline('Older', 'Second'));
    screen.input(outline('Newer', 'Second'));
    await Promise.resolve(); await Promise.resolve();
    reject(new Error('Late disk failure'));
    await screen.capture.flush();
    expect(texts(state.stored())).toEqual(['Newer', 'Second']);
    expect(texts(screen.view.shown)).toEqual(['Newer', 'Second']);
    expect(screen.view.failures).toEqual([]);
  });
});


describe('outline capture presentation ownership', () => {
  it.each([
    ['the same parent is observed again', false, false, true],
    ['a newer parent has been adopted', true, false, false],
    ['the parent changes and returns to its original identity', true, true, false],
  ] as const)('keeps the captured result distinct when %s', async (_label, advance, returnToOriginal, sameView) => {
    const opened = outline('First', 'Second');
    const intended = outline('Edited first', 'Second');
    const state = fixture(opened);
    const actualWriter = jest.spyOn(state.writer, 'updateSermonOutline');
    let release!: () => void;
    state.persist(() => new Promise<void>(resolve => { release = resolve; }));
    const capture = new OutlineCapture(state.writer, 'sermon');
    const stored = jest.fn();
    const failed = jest.fn();
    capture.observeView(opened);
    capture.schedule({ outline: intended, base: opened, begin: () => ({ stored, failed }) });
    const captured = state.stored();
    const newerParent = outline('Edited first', 'Later second');
    capture.observeView(advance ? newerParent : opened);
    if (returnToOriginal) capture.observeView(opened);
    release();
    await capture.flush();
    expect(stored).toHaveBeenCalledTimes(1);
    expect(stored).toHaveBeenCalledWith(captured, sameView);
    expect(stored.mock.calls[0][0]).toBe(await actualWriter.mock.results[0].value);
    expect(texts(captured)).toEqual(['Edited first', 'Second']);
    expect(failed).not.toHaveBeenCalled();
  });
});
