import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import { toast } from 'sonner';

import { useBookMarks } from '@/components/bible/marks/markStore';
import { useMarkStrokes } from '@/components/bible/marks/useMarkStrokes';
import { resetMarkToolForTests, useMarkTool } from '@/components/bible/marks/markTool';
import { MARK_SWATCH } from '@/components/bible/marks/MarkToolIcons';
import { MarkToolbar } from '@/components/bible/marks/MarkToolbar';
import { mapVerseText, wordIndexAt, wordsRange } from '@/components/bible/marks/verseWordDom';
import { useDataCollection, useDataDocument } from '@/data-engine/react.client';
import { recordDiagnostic } from '@/utils/appDiagnostics';
import { countVerseWords, verseOrder, type BookMarks } from '@/utils/bibleMarks';

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn(),
  useDataDocument: jest.fn(),
}));

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/utils/appDiagnostics', () => ({ ...jest.requireActual('@/utils/appDiagnostics'), recordDiagnostic: jest.fn() }));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { meaning?: string }) => (options?.meaning ? `${key}:${options.meaning}` : key) }),
}));

describe('the words of a drawn verse', () => {
  function verse(html: string) {
    const element = document.createElement('span');
    element.innerHTML = html;
    return element;
  }

  it('counts words as the stored verse does, a line break being a space', () => {
    const raw = '¶Блажен муж, <i>который</i>\nне ходит';
    const map = mapVerseText(verse('Блажен муж, <span class="italic">который</span><br>не ходит'));
    expect(map.words).toHaveLength(countVerseWords(raw));
    expect(map.words).toHaveLength(5);
  });

  it('finds the word at a character, and the word before a space', () => {
    const map = mapVerseText(verse('In the beginning'));
    expect(wordIndexAt(map, 0)).toBe(0);
    expect(wordIndexAt(map, 2)).toBe(0);
    expect(wordIndexAt(map, 4)).toBe(1);
    expect(wordIndexAt(map, 9)).toBe(2);
  });

  it('spans a mark over words that cross styled pieces', () => {
    const element = verse('God <span>created the</span> heaven');
    document.body.appendChild(element);
    const range = wordsRange(mapVerseText(element), 1, 3);
    expect(range?.toString()).toBe('created the heaven');
    element.remove();
  });
});

describe('marks kept through the data engine', () => {
  const commit = jest.fn();
  let documents: Array<{ resource: { collection: string; id: string }; value: Record<string, unknown> | null }> = [];
  let loading = false;
  let complete = true;
  let draft: Record<string, unknown> | null = null;
  let readOnly = false;
  let phase = 'saved';

  beforeEach(() => {
    commit.mockReset().mockResolvedValue(undefined);
    jest.mocked(toast.error).mockReset();
    documents = [];
    loading = false;
    complete = true;
    draft = null;
    readOnly = false;
    phase = 'saved';
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    jest.mocked(useDataCollection).mockImplementation((collection) => ({ state: collection ? { documents, complete } : null, loading }) as unknown as ReturnType<typeof useDataCollection>);
    jest.mocked(useDataDocument).mockImplementation((resource) => ({
      data: resource ? draft : null, loading: false, readOnly, state: resource && !readOnly ? {} : null, commit, status: { phase }, recoveryIdentity: {},
    }) as unknown as ReturnType<typeof useDataDocument>);
  });
  const paintFirstWord = (marks: BookMarks): BookMarks => ({ ...marks, '26:4': { m: [[0, 0, 'red']] } });
  const updaterOf = (call = 0) => commit.mock.calls[call][0] as (current: Record<string, unknown> | null) => Record<string, unknown>;
  const formOptions = () => jest.mocked(useDataDocument).mock.calls.at(-1)?.[1];

  it('shows the book\'s marks from its form\'s draft, the strokes not yet sent included', () => {
    draft = { userId: 'alice', verses: { v26_3: { p: '1-2-blue' } } };
    const { result } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    expect(jest.mocked(useDataDocument).mock.calls.at(-1)?.[0]).toEqual({ collection: 'bibleMarks', id: 'alice_rst_isaiah' });
    expect(result.current.marks).toEqual({ '26:3': { p: [[1, 2, 'blue']] } });
    expect(result.current.ready).toBe(true);
    expect(result.current.writable).toBe(true);
  });

  it('opens a book its whole list shows no document of for creation, and keeps that while the book is open', () => {
    const { rerender } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    expect(formOptions()).toEqual(expect.objectContaining({ create: true, slot: 'bible-marks' }));
    // The first stroke made the document: the list now shows it, and the form is not reopened.
    documents = [{ resource: { collection: 'bibleMarks', id: 'alice_rst_isaiah' }, value: { userId: 'alice', verses: {} } }];
    rerender();
    expect(formOptions()).toEqual(expect.objectContaining({ create: true }));
  });

  it('online, opens even a book its list shows no document of as an existing one: the form reads it itself', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    expect(formOptions()).toEqual(expect.objectContaining({ create: false, readOnlyCopy: true }));
  });

  it.each(['conflict', 'refused', 'deleted', 'localFailure', 'blocked'])('takes no stroke while the form is %s', (state) => {
    phase = state;
    const { result } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    expect(result.current.ready).toBe(true);
    expect(result.current.writable).toBe(false);
  });

  it.each(['saved', 'draft', 'queued', 'sending', 'unknown'])('takes strokes while the form is %s', (state) => {
    phase = state;
    const { result } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    expect(result.current.writable).toBe(true);
  });

  it('says nothing when the reader was left while a stroke was on its way', async () => {
    commit.mockRejectedValue(new Error('Editor is no longer active'));
    const { result } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    await act(async () => result.current.save(paintFirstWord));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('opens a book the list shows, or a list not read whole, as an existing document', () => {
    documents = [{ resource: { collection: 'bibleMarks', id: 'alice_rst_isaiah' }, value: { userId: 'alice', verses: {} } }];
    renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    expect(formOptions()).toEqual(expect.objectContaining({ create: false }));
    documents = [];
    complete = false;
    renderHook(() => useBookMarks('alice', 'rst', 'Genesis'));
    expect(formOptions()).toEqual(expect.objectContaining({ create: false }));
  });

  it('the first stroke makes the document under one fixed id; a later one is laid over the form\'s newest draft', () => {
    const { result } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    act(() => result.current.save(paintFirstWord));
    expect(updaterOf()(null)).toEqual(expect.objectContaining({ userId: 'alice', bible: 'rst', book: 'Isaiah', verses: { v26_4: { m: '0-0-red' } } }));
    const newest = updaterOf()({ userId: 'alice', verses: { v26_9: { m: '0-3-orange' } }, createdAt: 'then' });
    expect(newest).toEqual(expect.objectContaining({ createdAt: 'then', verses: { v26_9: { m: '0-3-orange' }, v26_4: { m: '0-0-red' } } }));
  });

  it('sends strokes made quickly at once, each to the same form, never waiting for the one before', () => {
    commit.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    act(() => result.current.save(paintFirstWord));
    act(() => result.current.save((marks) => ({ ...marks, '26:5': { m: [[1, 1, 'blue']] } })));
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('a refused stroke says so, and is no longer shown', async () => {
    commit.mockRejectedValue(Object.assign(new Error('A decision waits'), { code: 'decision-required' }));
    const lost = jest.fn();
    const { result } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    await act(async () => result.current.save(paintFirstWord, lost));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('keeps the same marks one object through every new copy of the form, a new one only when they change', () => {
    // A save hands a new copy at each of its steps — kept on the device, queued, sent, answered — and the
    // page drew the whole book's marks again at each (the iPad's Psalms, 2026-10-16).
    draft = { userId: 'alice', verses: { v26_3: { m: '0-0-red' }, v26_4: { p: '1-1-gray' } } };
    const { result, rerender } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    const first = result.current.marks;
    draft = { userId: 'alice', verses: { v26_4: { p: '1-1-gray' }, v26_3: { m: '0-0-red' } }, updatedAt: 'later' };
    rerender();
    expect(result.current.marks).toBe(first);
    draft = { userId: 'alice', verses: { v26_3: { m: '0-1-red' }, v26_4: { p: '1-1-gray' } } };
    rerender();
    expect(result.current.marks).not.toBe(first);
    expect(result.current.marks['26:3']).toEqual({ m: [[0, 1, 'red']] });
  });

  it('while the form is a copy for reading (storage silent), shows the marks and takes no stroke', () => {
    readOnly = true;
    draft = { userId: 'alice', verses: { v26_3: { m: '0-0-red' } } };
    const { result } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    expect(result.current.marks).toEqual({ '26:3': { m: [[0, 0, 'red']] } });
    expect(result.current.ready).toBe(true);
    expect(result.current.writable).toBe(false);
  });

  it('takes no stroke while the person\'s marks are not read yet', () => {
    loading = true;
    const { result } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    expect(result.current.ready).toBe(false);
    expect(jest.mocked(useDataDocument).mock.calls.at(-1)?.[0]).toBeNull();
  });

  it('gives this book\'s marks in the person\'s other Bibles, the same list while they do not change', () => {
    documents = [
      { resource: { collection: 'bibleMarks', id: 'alice_rst_isaiah' }, value: { userId: 'alice', bible: 'rst', book: 'Isaiah', verses: {} } },
      { resource: { collection: 'bibleMarks', id: 'alice_kjv_isaiah' }, value: { userId: 'alice', bible: 'kjv', book: 'Isaiah', verses: { v26_4: { m: '0-1-red' } } } },
      { resource: { collection: 'bibleMarks', id: 'alice_kjv_genesis' }, value: { userId: 'alice', bible: 'kjv', book: 'Genesis', verses: { v1_1: { m: '0-0-blue' } } } },
    ];
    const { result, rerender } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    expect(result.current.others).toEqual([{ bible: 'kjv', marks: { '26:4': { m: [[0, 1, 'red']] } } }]);
    const first = result.current.others;
    documents = documents.map((document) => ({ ...document, value: document.value && { ...document.value } }));
    rerender();
    expect(result.current.others).toBe(first);
  });

  it('keeps nothing without a signed-in owner', () => {
    const { result } = renderHook(() => useBookMarks(null, 'rst', 'Isaiah'));
    act(() => result.current.save(paintFirstWord));
    expect(commit).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(false);
  });
});

describe('the three tools', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetMarkToolForTests();
  });

  function Toolbar({ vertical = false }: { vertical?: boolean }) {
    const tool = useMarkTool();
    return (
      <>
        <MarkToolbar tool={tool} vertical={vertical} />
        <output data-testid="in-hand">{tool.inHand ?? 'none'}</output>
      </>
    );
  }

  // The owner, 2026-10-16: the open colours are how he sees the marker is taken. Colours that closed
  // after a pick left the marker looking put away, and the press meant to change the colour put it away.
  it('the marker opens its colours and keeps them out while in hand: a colour picked, another one, then put away', () => {
    render(<Toolbar />);
    const marker = () => screen.getByRole('button', { name: /bible\.marks\.marker/ });
    const colours = () => screen.queryByRole('group', { name: 'bible.marks.colors' });
    fireEvent.click(marker());
    expect(screen.getByTestId('in-hand')).toHaveTextContent('marker');
    expect(colours()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'bible.marks.meaning.blue' }));
    expect(colours()).toBeInTheDocument();
    expect(screen.getByTestId('in-hand')).toHaveTextContent('marker');
    expect(marker()).toHaveAccessibleName('bible.marks.marker:bible.marks.meaning.blue');
    fireEvent.click(screen.getByRole('button', { name: 'bible.marks.meaning.green' }));
    expect(marker()).toHaveAccessibleName('bible.marks.marker:bible.marks.meaning.green');
    fireEvent.click(marker());
    expect(screen.getByTestId('in-hand')).toHaveTextContent('none');
    expect(colours()).not.toBeInTheDocument();
  });

  it('Escape puts the tool away with its colours', () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole('button', { name: /bible\.marks\.marker/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('in-hand')).toHaveTextContent('none');
    expect(screen.queryByRole('group', { name: 'bible.marks.colors' })).not.toBeInTheDocument();
  });

  it('with two sets of tools on the page, a colour picked in one is the colour taken', () => {
    // A phone: the line's tools scrolled away and the column under the thumb share one choice.
    function TwoToolbars() {
      const tool = useMarkTool();
      return (
        <>
          <div data-testid="line"><MarkToolbar tool={tool} /></div>
          <div data-testid="column"><MarkToolbar tool={tool} vertical /></div>
        </>
      );
    }
    render(<TwoToolbars />);
    const column = within(screen.getByTestId('column'));
    fireEvent.click(column.getByRole('button', { name: /bible\.marks\.marker/ }));
    const blue = column.getByRole('button', { name: 'bible.marks.meaning.blue' });
    fireEvent.pointerDown(blue);
    fireEvent.click(blue);
    expect(column.getByRole('button', { name: /bible\.marks\.marker/ })).toHaveAccessibleName('bible.marks.marker:bible.marks.meaning.blue');
  });

  it('a press elsewhere — a stroke on the text — leaves the marker in hand with its colours out', () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole('button', { name: /bible\.marks\.marker/ }));
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole('group', { name: 'bible.marks.colors' })).toBeInTheDocument();
    expect(screen.getByTestId('in-hand')).toHaveTextContent('marker');
  });

  it('taking another tool closes the colours of the one put down', () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole('button', { name: /bible\.marks\.marker/ }));
    fireEvent.click(screen.getByRole('button', { name: 'bible.marks.eraser' }));
    expect(screen.queryByRole('group', { name: 'bible.marks.colors' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /bible\.marks\.pencil:/ }));
    expect(screen.getByRole('group', { name: 'bible.marks.pencilColors' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'bible.marks.colors' })).not.toBeInTheDocument();
  });

  // The owner's iPad, 2026-10-16: the links lit up under a Pencil held over the glass, the tools did not.
  it('a tool lights up under a mouse or a Pencil held over it, never under a finger', () => {
    render(<Toolbar />);
    const eraser = screen.getByRole('button', { name: 'bible.marks.eraser' });
    // jsdom has no PointerEvent: React builds pointer enter and leave from pointerover and pointerout.
    const point = (type: 'pointerover' | 'pointerout', pointerType: string) => {
      const event = new MouseEvent(type, { bubbles: true, relatedTarget: type === 'pointerover' ? document.body : document.body });
      Object.defineProperties(event, { pointerType: { value: pointerType }, pointerId: { value: 1 } });
      act(() => { eraser.dispatchEvent(event); });
    };
    point('pointerover', 'pen');
    expect(eraser).toHaveAttribute('data-hover');
    point('pointerout', 'pen');
    expect(eraser).not.toHaveAttribute('data-hover');
    point('pointerover', 'mouse');
    expect(eraser).toHaveAttribute('data-hover');
    point('pointerout', 'mouse');
    point('pointerover', 'touch');
    expect(eraser).not.toHaveAttribute('data-hover');
    expect(eraser.className).toContain('data-[hover]:scale-[1.08]');
    expect(eraser.className).not.toMatch(/(^|\s)hover:/);
    // Lit, its drawing tilts as a tool picked up (the owner's choice on the canvas, 2026-10-17).
    expect(eraser.querySelector('svg > g')?.getAttribute('class')).toContain('group-data-[hover]:-rotate-[16deg]');
  });

  // The owner, 2026-10-16: as Apple Notes' colours do under a Pencil, a colour of the palette grows.
  it('a colour of the palette lights up under a Pencil held over it, never under a finger', () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole('button', { name: /bible\.marks\.marker/ }));
    const blue = screen.getByRole('button', { name: 'bible.marks.meaning.blue' });
    const point = (type: 'pointerover' | 'pointerout', pointerType: string) => {
      const event = new MouseEvent(type, { bubbles: true, relatedTarget: document.body });
      Object.defineProperties(event, { pointerType: { value: pointerType }, pointerId: { value: 1 } });
      act(() => { blue.dispatchEvent(event); });
    };
    point('pointerover', 'pen');
    expect(blue).toHaveAttribute('data-hover');
    expect(blue.className).toContain('data-[hover]:scale-[1.06]');
    // A crisp ring of its own colour, not one shared tint (the owner's choice on the canvas, 2026-10-17).
    expect(blue.className).toContain('0_0_0_5px_var(--ring)');
    expect(blue.style.getPropertyValue('--ring')).toBe(MARK_SWATCH.blue);
    point('pointerout', 'pen');
    expect(blue).not.toHaveAttribute('data-hover');
    point('pointerover', 'touch');
    expect(blue).not.toHaveAttribute('data-hover');
  });

  // The owner, 2026-10-17: with the pencil taken its colours covered the marker — a second tap was needed
  // to reach it. The row makes room instead: the colours stand right before the tool in hand.
  it.each([false, true])('the colours stand in the row right before the tool in hand, so no tool is covered (column: %s)', (vertical) => {
    render(<Toolbar vertical={vertical} />);
    const marker = screen.getByRole('button', { name: /bible\.marks\.marker/ });
    const pencil = screen.getByRole('button', { name: /bible\.marks\.pencil:/ });
    fireEvent.click(pencil);
    const colours = screen.getByRole('group', { name: 'bible.marks.pencilColors' });
    expect(colours.className).not.toMatch(/(^|\s)absolute(\s|$)/);
    expect(colours.nextElementSibling).toBe(pencil);
    expect(marker.compareDocumentPosition(colours) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The marker is reached in one tap, its colours before it in turn.
    fireEvent.click(marker);
    expect(screen.getByTestId('in-hand')).toHaveTextContent('marker');
    expect(screen.getByRole('group', { name: 'bible.marks.colors' }).nextElementSibling).toBe(marker);
  });

  it('the pencil and the eraser are taken and put away by their own buttons', () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole('button', { name: /bible\.marks\.pencil:/ }));
    expect(screen.getByTestId('in-hand')).toHaveTextContent('pencil');
    fireEvent.click(screen.getByRole('button', { name: 'bible.marks.eraser' }));
    expect(screen.getByTestId('in-hand')).toHaveTextContent('eraser');
    fireEvent.click(screen.getByRole('button', { name: 'bible.marks.eraser' }));
    expect(screen.getByTestId('in-hand')).toHaveTextContent('none');
  });

  it('the pencil opens grey and the five colours; the line takes the colour picked', () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole('button', { name: /bible\.marks\.pencil:/ }));
    const colors = screen.getByRole('group', { name: 'bible.marks.pencilColors' });
    expect(within(colors).getAllByRole('button')).toHaveLength(6);
    expect(within(colors).getByRole('button', { name: 'bible.marks.plainPencil' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(colors).getByRole('button', { name: 'bible.marks.meaning.green' }));
    expect(screen.getByRole('button', { name: /bible\.marks\.pencil:/ })).toHaveAccessibleName('bible.marks.pencil:bible.marks.meaning.green');
    expect(screen.getByTestId('in-hand')).toHaveTextContent('pencil');
  });

  // The same storage as the cross-reference switch (the owner's iPad, 2026-10-17): a colour picked stays
  // the colour in hand even when browser storage reads back the old one.
  it('keeps a colour picked even when browser storage reads back the old one', () => {
    const { result, rerender } = renderHook(() => useMarkTool());
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    try {
      act(() => result.current.pickColor('blue'));
      rerender();
      expect(result.current.color).toBe('blue');
    } finally {
      getItem.mockRestore();
    }
  });

  it('a pen with nothing in hand paints with the last tool and takes nothing, so a finger still only scrolls', () => {
    const { result } = renderHook(() => useMarkTool());
    act(() => result.current.pickColor('green'));
    act(() => result.current.pressColored('marker'));
    expect(result.current.inHand).toBeNull();
    expect(result.current.penTool).toBeNull();
    let kind: ReturnType<typeof result.current.beginStroke> = null;
    act(() => {
      kind = result.current.beginStroke(true);
    });
    expect(kind).toEqual({ tool: 'marker', color: 'green' });
    // The owner's iPad: the Pencil used to take the tool, and the black ring came and went.
    expect(result.current.inHand).toBeNull();
    expect(result.current.penTool).toBe('marker');
    expect(result.current.beginStroke(false)).toBeNull();
    act(() => result.current.pressEraser());
    expect(result.current.penTool).toBeNull();
  });
});

describe('a stroke over the words', () => {
  // jsdom lays out nothing: no element stands under any point.
  beforeEach(() => { document.elementFromPoint = jest.fn(() => null); });

  function Ribbon({ begin }: { begin: () => null }) {
    const rootRef = useRef<HTMLElement | null>(null);
    const painter = { draw: jest.fn(), release: jest.fn(), drop: jest.fn(), shown: () => ({}) };
    useMarkStrokes({ rootRef, ready: true, order: verseOrder([['In the beginning']], countVerseWords), save: jest.fn(() => true), armed: false, begin, painter, enabled: true });
    return (
      <article ref={rootRef}>
        <div data-verse="1:1">
          <span data-verse-text="" data-testid="words">In the beginning</span>
          <button type="button">3 links</button>
        </div>
      </article>
    );
  }

  it('starts only on a verse\'s words: a Pencil on the links\' chip presses the chip and paints nothing', () => {
    const begin = jest.fn(() => null);
    render(<Ribbon begin={begin} />);
    // jsdom has no PointerEvent: a mouse event that says it is a pen.
    const penDown = (target: Element) => {
      const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
      Object.defineProperties(event, { pointerType: { value: 'pen' }, pointerId: { value: 1 } });
      target.dispatchEvent(event);
    };
    penDown(screen.getByRole('button', { name: '3 links' }));
    expect(recordDiagnostic).not.toHaveBeenCalled();
    penDown(screen.getByTestId('words'));
    // jsdom draws no text, so no word is under the pen: the stroke went as far as looking for one.
    expect(recordDiagnostic).toHaveBeenCalledWith('mark', { source: 'pen', result: 'missed' });
    expect(begin).not.toHaveBeenCalled();
  });
});
