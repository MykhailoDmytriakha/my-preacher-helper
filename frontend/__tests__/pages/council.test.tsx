import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import CouncilListPage from '@/(pages)/(private)/care/council/page';
import { seedCouncils } from '@/utils/council';
import '@testing-library/jest-dom';

import en from '../../locales/en/translation.json';
import ru from '../../locales/ru/translation.json';
import uk from '../../locales/uk/translation.json';

import type { Council } from '@/models/models';

/**
 * The global `react-i18next` mock returns the KEY, so assertions read as keys. The locale
 * coverage test at the bottom proves the words exist in all three files.
 */

const mockPush = jest.fn();
const mockCreate = jest.fn();

const state: { councils: Council[]; loading: boolean; error: unknown } = { councils: [], loading: false, error: null };
const mockRefresh = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({}),
}));

jest.mock('@/hooks/useCouncils', () => ({
  useCouncils: () => ({
    ...state,
    refresh: mockRefresh,
    createCouncil: mockCreate,
    updateCouncil: jest.fn(),
    deleteCouncil: jest.fn(),
  }),
}));

const engineState: { councils: Council[]; loading: boolean; error: string | null } = { councils: [], loading: false, error: null };
const mockEngineRefresh = jest.fn();
let engineCollections = '';

jest.mock('@/data-engine/react.client', () => ({
  isCollectionOnEngine: (collection: string) => engineCollections.split(',').includes(collection),
}));
jest.mock('@/hooks/useCouncilsDataCollection', () => ({
  useCouncilsDataCollection: () => ({ ...engineState, complete: true, freshness: 'server', serverAnswered: true,
    knownIds: new Set(engineState.councils.map(council => council.id)), refresh: mockEngineRefresh }),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('Brothers\' council list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    state.councils = [];
    state.loading = false;
    state.error = null;
    engineState.councils = [];
    engineState.loading = false;
    engineState.error = null;
    engineCollections = '';
  });

  // The page counts days from the real clock, and the seeded council is dated 2026-09-18:
  // without a frozen "today" this suite turned red on that very day and stays red after it.
  afterEach(() => {
    jest.useRealTimers();
  });

  // The switch is per collection, so the same screen has to answer from whichever reader the
  // deployment migrated — and must not quietly keep rendering the other one's list.
  it('renders the engine list only where councils are the migrated collection', () => {
    const seeded = seedCouncils('u1', new Date('2026-09-11T00:00:00Z'));
    state.councils = seeded;
    engineState.councils = [{ ...seeded[0], id: 'from-engine', title: 'Engine council' }];

    const legacy = render(<CouncilListPage />);
    expect(screen.queryByText('Engine council')).not.toBeInTheDocument();
    expect(mockEngineRefresh).not.toHaveBeenCalled();
    legacy.unmount();

    engineCollections = 'councils';
    render(<CouncilListPage />);
    expect(screen.getByText('Engine council')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Engine council/ })).toHaveAttribute('href', '/care/council/from-engine');
  });

  it('reports an engine read failure the same way as the legacy one', () => {
    engineCollections = 'councils';
    engineState.error = 'engine offline';
    render(<CouncilListPage />);
    expect(screen.getByText('council.readFailed')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('council-retry'));
    expect(mockEngineRefresh).toHaveBeenCalledTimes(1);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('says a failed read out loud instead of calling it an empty list', () => {
    state.error = new Error('permission-denied');
    render(<CouncilListPage />);
    expect(screen.getByText('council.readFailed')).toBeInTheDocument();
    expect(screen.queryByText('council.emptyTitle')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('council-retry'));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('shows the councils being prepared apart from the held ones, each opening its own page', () => {
    // Noon, not midnight UTC: `daysUntil` reads the LOCAL calendar date, and midnight UTC is
    // still the previous day west of Greenwich — the build machine and a laptop must agree.
    const today = new Date('2026-09-11T12:00:00Z');
    jest.useFakeTimers().setSystemTime(today);
    state.councils = seedCouncils('u1', today);
    render(<CouncilListPage />);

    const rows = screen.getAllByTestId(/council-row-/);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Совет 18 сентября');
    expect(rows[0]).toHaveAttribute('href', `/care/council/${state.councils[0].id}`);
    // Past councils read like a history: the most recent one first.
    expect(rows[1]).toHaveTextContent('Совет 14 августа');
    expect(rows[2]).toHaveTextContent('Совет 3 июля');
    // A held council says so and counts what was discussed; a prepared one does not pretend to.
    expect(rows[1]).toHaveTextContent('council.discussedCount');
    expect(rows[0]).not.toHaveTextContent('council.discussedCount');
    // The sections themselves are on the card — what he is carrying, not how many things.
    expect(rows[0]).toHaveTextContent('Крещение: Андрей и Оксана');
    expect(rows[0]).toHaveTextContent('council.inDays');
    // …and for a held council, what was decided under each, with the undiscussed one saying so.
    expect(rows[1]).toHaveTextContent('Подрядчик Иванов');
    expect(rows[2]).toHaveTextContent('council.topic.notDiscussed');
    expect(screen.getByText('council.preparing')).toBeInTheDocument();
    expect(screen.getByText('council.past')).toBeInTheDocument();
  });

  it('invites the first council instead of showing an empty list', () => {
    render(<CouncilListPage />);
    expect(screen.getByText('council.emptyTitle')).toBeInTheDocument();
    expect(screen.queryByTestId('council-new')).not.toBeInTheDocument();
  });

  it('creates a council from the form and opens it', () => {
    state.councils = seedCouncils('u1');
    mockCreate.mockReturnValue({ id: 'new-1' });
    render(<CouncilListPage />);

    fireEvent.click(screen.getByTestId('council-new'));
    const title = screen.getByTestId('council-new-title');
    fireEvent.change(title, { target: { value: 'Совет 2 октября' } });
    fireEvent.submit(title.closest('form') as HTMLFormElement);

    expect(mockCreate).toHaveBeenCalledWith({ title: 'Совет 2 октября', date: undefined });
    expect(mockPush).toHaveBeenCalledWith('/care/council/new-1');
  });
});

describe('council locale coverage', () => {
  const collectKeys = (value: unknown, prefix = ''): string[] => {
    if (!value || typeof value !== 'object') return [prefix];
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      collectKeys(child, prefix ? `${prefix}.${key}` : key)
    );
  };

  it('has every council key in all three locales', () => {
    // Plural forms differ by language (ru/uk: one/few/many, en: one/other); the word is the key.
    const plural = (keys: string[]) => [...new Set(keys.map((key) => key.replace(/_(one|few|many|other)$/, '_plural')))];
    const ruKeys = plural(collectKeys((ru as { council: unknown }).council)).sort();
    const enKeys = plural(collectKeys((en as { council: unknown }).council)).sort();
    const ukKeys = plural(collectKeys((uk as { council: unknown }).council)).sort();
    expect(ruKeys.length).toBeGreaterThan(50);
    expect(enKeys).toEqual(ruKeys);
    expect(ukKeys).toEqual(ruKeys);
  });
});
