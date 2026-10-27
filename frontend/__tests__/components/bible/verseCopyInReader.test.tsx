import { ReaderShell } from '../../../test-utils/reader-shell';
import { act, fireEvent, render as renderUI, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BibleBookReader } from '@/components/bible/BibleBookReader';
import { resetCrossReferencePrefsForTests } from '@/components/bible/crossReferencePrefs';
import { resetPlaceTrailForTests } from '@/components/bible/placeTrailStore';
import { LONG_PRESS_MS } from '@/hooks/useLongPress';
import { verseWords, type BookText } from '@/utils/bibleText';
import { forgetLoadedCrossRefs } from '@/utils/crossReferences';
import { quotesFor, verseCopyText } from '@/utils/verseCopy';

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataDocument: () => ({ data: null, loading: true, commit: jest.fn(), status: null, recoveryIdentity: {} }),
}));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));

const render = (ui: React.ReactNode) => renderUI(ui, { wrapper: ReaderShell });

/*
 * Taking verses out of the reader (case 2026-10-12-block-diagram, 4.7; the owner's board «Копировать стих»), on the
 * real Synodal Ruth and its links: a verse held opens its menu, a computer's right button too; «Выбрать несколько»
 * chooses verses for the bar; the links window copies its verse; a selection copied by the system is clean.
 */
const publicFile = (path: string) => JSON.parse(readFileSync(join(__dirname, '../../../public', path), 'utf8'));
const ruth: BookText = publicFile('bible-text/rst/v1/ruth.json');
const words = (chapter: number, verse: number) => verseWords(ruth.chapters[chapter - 1][verse - 1]);
const BIBLE = 'bible.translations.rst.name';
const squeeze = (text: string) => text.replace(/\s+/g, ' ').trim();
const NAMES = { book: 'Руф', bible: BIBLE, quotes: quotesFor('ru') };
/** The quote of a verse as `utils/verseCopy.ts` makes it (its own test holds the form). */
const quote = (...verses: number[]) => verseCopyText(verses.map((verse) => ({ chapter: 1, verse, words: words(1, verse) })), 'quote', NAMES);

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body, clone() { return this; }, headers: new Headers({ 'content-type': 'application/json' }) });
let writeText: jest.Mock;

beforeEach(() => {
  window.matchMedia = jest.fn((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
  window.history.replaceState(null, '');
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetCrossReferencePrefsForTests();
  resetPlaceTrailForTests();
  forgetLoadedCrossRefs();
  global.fetch = jest.fn(async (url: string) => answer(publicFile(url.slice(1)))) as unknown as typeof fetch;
  Element.prototype.scrollIntoView = jest.fn();
  window.scrollTo = jest.fn() as unknown as typeof window.scrollTo;
  writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
});

const renderRuth = async () => {
  render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 1, verse: 16 }} onOpenBook={jest.fn()} />);
  await screen.findByTestId('cross-refs-1:16');
};
const verseText = (key: string) => document.querySelector(`[data-verse="${key}"] [data-verse-text]`) as HTMLElement;
const row = (key: string) => document.querySelector(`[data-verse="${key}"]`) as HTMLElement;

function pointer(target: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', pointerType: 'touch' | 'mouse' = 'touch', clientY = 40) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 40, clientY, button: 0 });
  Object.defineProperties(event, { pointerType: { value: pointerType }, pointerId: { value: 1 } });
  fireEvent(target, event);
}
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
/** A finger held on a verse until its time has run, then lifted; then the moment in which a click is not a choice passes. */
async function hold(target: Element) {
  pointer(target, 'pointerdown');
  await wait(LONG_PRESS_MS + 30);
  pointer(target, 'pointerup');
  await wait(460);
}

describe('taking verses out of the reader', () => {
  it('a verse held opens its menu; Copy puts the verse, its place and its Bible in the clipboard', async () => {
    await renderRuth();
    await hold(verseText('1:16'));
    const menu = screen.getByRole('menu', { name: 'bible.copy.menu' });
    // Lifted while its menu is open; the phone has no share window here, so no «Отправить».
    expect(row('1:16')).toHaveAttribute('data-verse-held');
    expect(within(menu).queryByRole('menuitem', { name: 'bible.copy.share' })).toBeNull();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'bible.copy.copy' }));
    expect(writeText).toHaveBeenCalledWith(quote(16));
    expect(writeText.mock.calls[0][0]).toContain(`— Руф 1:16 (${BIBLE})`);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(row('1:16')).not.toHaveAttribute('data-verse-held');
  });

  it('a touch that moves is a scroll, and a press on a verse’s chip is the chip’s: no menu', async () => {
    await renderRuth();
    pointer(verseText('1:16'), 'pointerdown');
    pointer(verseText('1:16'), 'pointermove', 'touch', 90);
    await wait(LONG_PRESS_MS + 30);
    pointer(verseText('1:16'), 'pointerup');
    expect(screen.queryByRole('menu')).toBeNull();
    await hold(screen.getByTestId('cross-refs-1:16'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // Codex review, 2026-10-27: only the click a hold ends with is not a choice.
  it('the click that ends a hold chooses nothing; the next one does', async () => {
    await renderRuth();
    pointer(verseText('1:16'), 'pointerdown');
    await wait(LONG_PRESS_MS + 30);
    pointer(verseText('1:16'), 'pointerup');
    const copyItem = screen.getByRole('menuitem', { name: 'bible.copy.copy' });
    fireEvent.click(copyItem, { detail: 1 });
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(copyItem, { detail: 1 });
    expect(writeText).toHaveBeenCalledWith(quote(16));
  });

  // Codex review r2: the lift's click may go to the verse (its press's target); a press begun in the menu is a choice.
  it('a press begun in the menu right after a hold is a choice', async () => {
    await renderRuth();
    pointer(verseText('1:16'), 'pointerdown');
    await wait(LONG_PRESS_MS + 30);
    pointer(verseText('1:16'), 'pointerup');
    const copyItem = screen.getByRole('menuitem', { name: 'bible.copy.copy' });
    pointer(copyItem, 'pointerdown', 'mouse');
    fireEvent.click(copyItem, { detail: 1 });
    expect(writeText).toHaveBeenCalledWith(quote(16));
  });

  it('after the right button the menu answers at once — a click, or Enter on its first item', async () => {
    await renderRuth();
    fireEvent.contextMenu(verseText('1:17'), { clientX: 200, clientY: 300 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'bible.copy.copy' }), { detail: 1 });
    expect(writeText).toHaveBeenCalledWith(quote(17));
    fireEvent.contextMenu(verseText('1:18'), { clientX: 200, clientY: 300 });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'bible.copy.copy' })).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    expect(writeText).toHaveBeenLastCalledWith(quote(18));
  });

  it('a computer’s right button opens the same menu; over selected text the browser keeps its own', async () => {
    await renderRuth();
    pointer(verseText('1:17'), 'pointerdown', 'mouse');
    pointer(verseText('1:17'), 'pointerup', 'mouse');
    expect(fireEvent.contextMenu(verseText('1:17'), { clientX: 200, clientY: 300 })).toBe(false);
    expect(screen.getByRole('menu', { name: 'bible.copy.menu' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();

    const range = document.createRange();
    range.selectNodeContents(verseText('1:17'));
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    expect(fireEvent.contextMenu(verseText('1:17'), { clientX: 200, clientY: 300 })).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    window.getSelection()!.removeAllRanges();
  });

  it('«Выбрать несколько»: presses choose verses, Shift chooses a passage, the bar copies them numbered', async () => {
    await renderRuth();
    await hold(verseText('1:16'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'bible.copy.several' }));
    await userEvent.click(verseText('1:17'));
    // A press on a verse's number chooses it too, and does not open its links.
    await userEvent.click(screen.getByTestId('cross-refs-1:19'));
    expect(screen.queryByRole('dialog')).toBeNull();
    const bar = screen.getByRole('region', { name: 'Руф 1:16–17, 19' });
    expect(['1:16', '1:17', '1:19'].map((key) => row(key).hasAttribute('data-verse-chosen'))).toEqual([true, true, true]);
    await userEvent.click(screen.getByTestId('cross-refs-1:19'));
    fireEvent.click(verseText('1:20'), { shiftKey: true });
    expect(within(bar).getByText('Руф 1:16–20')).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: 'bible.copy.copy' }));
    expect(writeText).toHaveBeenCalledWith([`Руф 1:16–20 (${BIBLE})`, ...[16, 17, 18, 19, 20].map((verse) => `${verse} ${words(1, verse)}`)].join('\n'));
    expect(screen.queryByRole('region', { name: /Руф/ })).toBeNull();
    expect(document.querySelector('[data-verse-chosen]')).toBeNull();
  });

  // Codex review, 2026-10-27: choosing several, a press is the hold's to judge, on the words and on the controls alike.
  it('choosing several, a press given up chooses nothing, and a hold on a chip chooses the passage', async () => {
    await renderRuth();
    await hold(verseText('1:16'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'bible.copy.several' }));
    pointer(verseText('1:18'), 'pointerdown', 'mouse');
    pointer(verseText('1:18'), 'pointermove', 'mouse', 80);
    pointer(verseText('1:18'), 'pointerup', 'mouse');
    fireEvent.click(verseText('1:18'), { detail: 1 });
    expect(row('1:18')).not.toHaveAttribute('data-verse-chosen');
    await hold(screen.getByTestId('cross-refs-1:20'));
    expect(screen.getByRole('region', { name: 'Руф 1:16–20' })).toBeInTheDocument();
  });

  // Codex review r2: a copy that answers late lets go only the choice it was made from; a key on a chip chooses.
  it('a late clipboard leaves a newer choice alone, and Enter on a chip chooses its verse', async () => {
    let answer: () => void = () => undefined;
    writeText.mockImplementationOnce(() => new Promise<void>((resolve) => { answer = resolve; }));
    await renderRuth();
    await hold(verseText('1:16'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'bible.copy.several' }));
    await userEvent.click(screen.getByRole('button', { name: 'bible.copy.copy' }));
    screen.getByTestId('cross-refs-1:19').focus();
    fireEvent.keyDown(screen.getByTestId('cross-refs-1:19'), { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(row('1:19')).toHaveAttribute('data-verse-chosen');
    await act(async () => { answer(); });
    expect(screen.getByRole('region', { name: 'Руф 1:16, 19' })).toBeInTheDocument();
  });

  it('the bar copies as a quote when asked, and Escape lets the choice go', async () => {
    await renderRuth();
    await hold(verseText('1:16'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'bible.copy.several' }));
    await userEvent.click(verseText('1:17'));
    await userEvent.click(screen.getByRole('button', { name: 'bible.copy.asQuote' }));
    await userEvent.click(screen.getByRole('button', { name: 'bible.copy.copy' }));
    expect(writeText).toHaveBeenCalledWith(quote(16, 17));

    await hold(verseText('1:16'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'bible.copy.several' }));
    expect(row('1:16')).toHaveAttribute('data-verse-chosen');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: /Руф/ })).toBeNull();
    expect(row('1:16')).not.toHaveAttribute('data-verse-chosen');
  });

  it('Send hands the verse to the device’s share window', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    await renderRuth();
    await hold(verseText('1:16'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'bible.copy.share' }));
    expect(share).toHaveBeenCalledWith({ text: quote(16) });
  });

  it('the links window copies its verse, and its sign turns into a tick', async () => {
    await renderRuth();
    await userEvent.click(screen.getByTestId('cross-refs-1:16'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'bible.copy.copyVerse' }));
    expect(writeText).toHaveBeenCalledWith(quote(16));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'bible.copy.copiedVerse' })).toBeInTheDocument());
  });

  // Codex review, 2026-10-27: a field keeps its own selection apart from the page's (Firefox).
  it('a copy from a field being typed in is the field’s, even with verses selected on the page', async () => {
    await renderRuth();
    const range = document.createRange();
    range.selectNodeContents(verseText('1:16'));
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    field.focus();
    const setData = jest.fn();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData } });
    field.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(setData).not.toHaveBeenCalled();
    field.remove();
    window.getSelection()!.removeAllRanges();
  });

  it('a selection copied by the system carries the words alone, with the place and the Bible', async () => {
    await renderRuth();
    const from = document.createTreeWalker(verseText('1:16'), NodeFilter.SHOW_TEXT).nextNode() as Text;
    const to = document.createTreeWalker(verseText('1:17'), NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(from, 4);
    range.setEnd(to, 12);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const setData = jest.fn();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData } });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(setData).toHaveBeenCalledWith('text/plain', [
      `Руф 1:16–17 (${BIBLE})`,
      `16 …${squeeze(verseText('1:16').textContent!.slice(4))}`,
      `17 ${squeeze(to.data.slice(0, 12))}…`,
    ].join('\n'));
    window.getSelection()!.removeAllRanges();
  });
});
