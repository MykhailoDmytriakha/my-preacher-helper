import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { toast } from 'sonner';

import { useBookMarks } from '@/components/bible/marks/markStore';
import { useMarkTool } from '@/components/bible/marks/markTool';
import { MarkToolbar } from '@/components/bible/marks/MarkToolbar';
import { mapVerseText, wordIndexAt, wordsRange } from '@/components/bible/marks/verseWordDom';
import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { countVerseWords, type BookMarks } from '@/utils/bibleMarks';

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn(),
  useDocumentActions: jest.fn(),
}));

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));

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
  const create = jest.fn();
  const commit = jest.fn();
  let documents: Array<{ resource: { collection: string; id: string }; value: Record<string, unknown> | null }> = [];
  let loading = false;

  beforeEach(() => {
    create.mockReset().mockResolvedValue(undefined);
    commit.mockReset().mockResolvedValue(undefined);
    jest.mocked(toast.error).mockReset();
    documents = [];
    loading = false;
    jest.mocked(useDataCollection).mockImplementation((collection) => ({ state: collection ? { documents } : null, loading }) as unknown as ReturnType<typeof useDataCollection>);
    jest.mocked(useDocumentActions).mockReturnValue({ ready: true, create, commit } as unknown as ReturnType<typeof useDocumentActions>);
  });

  const paintFirstWord = (marks: BookMarks): BookMarks => ({ ...marks, '26:4': { m: [[0, 0, 'red']] } });
  const keptChange = () => commit.mock.calls[0][1] as (current: Record<string, unknown> | null) => Record<string, unknown>;

  it('reads the marks from the book\'s own document', () => {
    documents = [{ resource: { collection: 'bibleMarks', id: 'alice_rst_isaiah' }, value: { userId: 'alice', verses: { v26_3: { p: ['1-2-blue'] } } } }];
    const { result } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    expect(result.current.marks).toEqual({ '26:3': { p: [[1, 2, 'blue']] } });
    expect(result.current.ready).toBe(true);
  });

  it('the first stroke in a book makes its document under one fixed id where the engine finds none', () => {
    const { result } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    act(() => result.current.save(paintFirstWord));
    expect(commit).toHaveBeenCalledWith({ collection: 'bibleMarks', id: 'alice_rst_isaiah' }, expect.any(Function));
    expect(keptChange()(null)).toEqual(
      expect.objectContaining({ userId: 'alice', bible: 'rst', book: 'Isaiah', verses: { v26_4: { m: '0-0-red' } } }),
    );
    expect(result.current.marks).toEqual({ '26:4': { m: [[0, 0, 'red']] } });
  });

  it('a book made on another device, not yet in this list, is changed, never created over', () => {
    // The list here shows no document, but the engine\'s own read of it finds the other device\'s.
    const { result } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    act(() => result.current.save(paintFirstWord));
    expect(create).not.toHaveBeenCalled();
    const newest = keptChange()({ userId: 'alice', bible: 'rst', book: 'Isaiah', verses: { v26_9: { m: '0-3-orange' } }, createdAt: 'then' });
    expect(newest).toEqual(expect.objectContaining({ createdAt: 'then', verses: { v26_9: { m: '0-3-orange' }, v26_4: { m: '0-0-red' } } }));
  });

  it('a later stroke is laid over the newest copy, keeping what another device added', () => {
    documents = [{ resource: { collection: 'bibleMarks', id: 'alice_rst_isaiah' }, value: { userId: 'alice', verses: {} } }];
    const { result } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    act(() => result.current.save(paintFirstWord));
    const newest = keptChange()({ userId: 'alice', verses: { v26_9: { m: '0-3-orange' } } });
    expect(newest.verses).toEqual({ v26_9: { m: '0-3-orange' }, v26_4: { m: '0-0-red' } });
  });

  it('offline, in a book this device has no copy of, the stroke makes the document', async () => {
    commit.mockRejectedValue(Object.assign(new Error('The document is not available in the local cache'), { code: 'needs-connection' }));
    const { result } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    await act(async () => result.current.save(paintFirstWord));
    expect(create).toHaveBeenCalledWith(
      { collection: 'bibleMarks', id: 'alice_rst_isaiah' },
      expect.objectContaining({ userId: 'alice', verses: { v26_4: { m: '0-0-red' } } }),
    );
    expect(result.current.marks).toEqual({ '26:4': { m: [[0, 0, 'red']] } });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a refused stroke returns the page to the stored marks and says so', async () => {
    commit.mockRejectedValue(Object.assign(new Error('Device storage does not answer'), { code: 'storage-silent' }));
    documents = [{ resource: { collection: 'bibleMarks', id: 'alice_rst_isaiah' }, value: { userId: 'alice', verses: {} } }];
    const { result } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    await act(async () => result.current.save(paintFirstWord));
    expect(result.current.marks).toEqual({});
    expect(toast.error).toHaveBeenCalledWith('dataSync.readOnly.storage');
  });

  it('takes no stroke while the person\'s marks are not read yet', () => {
    loading = true;
    const { result } = renderHook(() => useBookMarks('alice', 'rst', 'Isaiah'));
    expect(result.current.ready).toBe(false);
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
    // The list comes anew with every stroke; the other Bibles' marks are the same.
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
  beforeEach(() => window.localStorage.clear());

  function Toolbar() {
    const tool = useMarkTool();
    return (
      <>
        <MarkToolbar tool={tool} />
        <output data-testid="in-hand">{tool.inHand ?? 'none'}</output>
      </>
    );
  }

  it('the marker opens its colours; a colour closes them and stays in hand; pressed again it is put away', () => {
    render(<Toolbar />);
    const marker = screen.getByRole('button', { name: /bible\.marks\.marker/ });
    fireEvent.click(marker);
    expect(screen.getByTestId('in-hand')).toHaveTextContent('marker');
    expect(screen.getByRole('group', { name: 'bible.marks.colors' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'bible.marks.meaning.blue' }));
    expect(screen.queryByRole('group', { name: 'bible.marks.colors' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /bible\.marks\.marker/ })).toHaveAccessibleName('bible.marks.marker:bible.marks.meaning.blue');
    fireEvent.click(screen.getByRole('button', { name: /bible\.marks\.marker/ }));
    expect(screen.getByTestId('in-hand')).toHaveTextContent('none');
  });

  it('pressing the marker while its colours are out only closes them', () => {
    render(<Toolbar />);
    const marker = screen.getByRole('button', { name: /bible\.marks\.marker/ });
    fireEvent.click(marker);
    fireEvent.click(marker);
    expect(screen.queryByRole('group', { name: 'bible.marks.colors' })).not.toBeInTheDocument();
    expect(screen.getByTestId('in-hand')).toHaveTextContent('marker');
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

  it('a press outside every set of tools closes the colours', () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole('button', { name: /bible\.marks\.marker/ }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: 'bible.marks.colors' })).not.toBeInTheDocument();
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

  it('a pen with nothing in hand paints with the last tool and the remembered colour', () => {
    const { result } = renderHook(() => useMarkTool());
    act(() => result.current.pickColor('green'));
    act(() => result.current.pressColored('marker'));
    expect(result.current.inHand).toBeNull();
    let kind: ReturnType<typeof result.current.beginStroke> = null;
    act(() => {
      kind = result.current.beginStroke(true);
    });
    expect(kind).toEqual({ tool: 'marker', color: 'green' });
    expect(result.current.inHand).toBe('marker');
    act(() => result.current.pressColored('marker'));
    expect(result.current.inHand).toBeNull();
    expect(result.current.beginStroke(false)).toBeNull();
  });
});
