import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BibleSearch } from '@/components/bible/search/BibleSearch';
import { resetSearchHistoryForTests } from '@/components/bible/searchHistoryStore';
import { resetSearchIndexesForTests } from '@/utils/bibleSearch/searchIndexStore';
import { resetWordFormLexiconsForTests } from '@/utils/bibleSearch/wordFormLexicon';
import { keptBookText } from '@/utils/bibleText';

import { readWordFormFixture } from '../../../test-utils/bibleWordForms';

jest.mock('@/utils/bibleText', () => ({ ...jest.requireActual('@/utils/bibleText'),
  keptBookText: jest.fn(async (id: string) => id === 'John'
    ? { id, chapters: [['дело Господа', 'для человеков']] } : null),
  fetchBookText: jest.fn(async () => { throw new Error('No other books installed'); }),
}));
const t = (key: string) => key;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'ru' } }) }));
const fetchMock = fetch as jest.MockedFunction<typeof fetch>;

beforeEach(() => {
  resetSearchIndexesForTests(); resetWordFormLexiconsForTests(); resetSearchHistoryForTests();
  fetchMock.mockReset(); window.localStorage.clear();
  window.matchMedia = jest.fn((query: string) => ({ matches: false, media: query, onchange: null,
    addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
});

function openLine() {
  render(<BibleSearch bible="rst" locale="ru" wide autoFocus surface="page" onOpen={jest.fn()}><p>the books</p></BibleSearch>);
  return screen.getByRole('combobox');
}

it('keeps empty autofocus, a short book prefix and a complete pasted place independent of dictionaries', async () => {
  const line = openLine();
  await waitFor(() => expect(keptBookText).toHaveBeenCalled());
  expect(line).toHaveFocus();
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.change(line, { target: { value: 'И' } });
  await waitFor(() => expect(line).toHaveValue('И'));
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.change(line, { target: { value: 'Ин 3:16' } });
  await waitFor(() => expect(line).toHaveValue('Ин 3:16'));
  expect(fetchMock).not.toHaveBeenCalled();
});

it('shows preparation and a recoverable refusal without claiming zero matches, then searches after Retry', async () => {
  let release!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const line = openLine();
  try {
    await userEvent.type(line, 'дело');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText('bible.search.preparingSearch')).toBeInTheDocument();
    expect(screen.queryByText('bible.search.unavailableTitle')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    await act(async () => { release(new Response('Unavailable', { status: 503 })); });
    expect(await screen.findByText('bible.search.preparationFailed')).toBeInTheDocument();
    expect(screen.queryByText('bible.search.unavailableTitle')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(readWordFormFixture('ru')), { headers: { 'content-type': 'application/json' } }));
    await userEvent.click(screen.getByRole('button', { name: 'bible.search.retryPreparation' }));
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.queryByText('bible.search.preparationFailed')).not.toBeInTheDocument();
    expect(screen.getByRole('option')).toHaveTextContent('дело Господа');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    if (release) await act(async () => { release(new Response('Unavailable', { status: 503 })); });
  }
});
