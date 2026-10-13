import { act, fireEvent, render, screen } from '@testing-library/react';
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
// The engine create runs in EngineCouncilCreator; here it reports the council created at once.
const mockCreate = jest.fn();

// The date field reads the week-start setting (DatePickerField).
jest.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: { firstDayOfWeek: 'monday' } }) }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({}),
}));

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/(pages)/(private)/care/council/EngineCouncilMigration', () => ({ EngineCouncilMigration: () => null }));
jest.mock('@/(pages)/(private)/care/council/EngineCouncilCreator', () => ({
  EngineCouncilCreator: ({ council, onCreated }: { council: { id: string; title: string; date?: string }; onCreated: (id: string) => void }) => {
    const ReactModule = jest.requireActual<typeof import('react')>('react');
    ReactModule.useEffect(() => { mockCreate({ title: council.title, date: council.date }); onCreated(council.id); }, []);
    return null;
  },
}));

const engineState: { councils: Council[]; loading: boolean; error: string | null } = { councils: [], loading: false, error: null };
const mockEngineRefresh = jest.fn();
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
    engineState.councils = [];
    engineState.loading = false;
    engineState.error = null;
  });

  // The page counts days from the real clock, and the seeded council is dated 2026-09-18:
  // without a frozen "today" this suite turned red on that very day and stays red after it.
  afterEach(() => {
    jest.useRealTimers();
  });

  // The switch is per collection, so the same screen has to answer from whichever reader the
  // deployment migrated — and must not quietly keep rendering the other one's list.
  it('renders the councils the engine collection holds', () => {
    const seeded = seedCouncils('u1', new Date('2026-09-11T00:00:00Z'));
    engineState.councils = [{ ...seeded[0], id: 'from-engine', title: 'Engine council' }];

    render(<CouncilListPage />);
    expect(screen.getByText('Engine council')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Engine council/ })).toHaveAttribute('href', '/care/council/from-engine');
  });

  it('reports an engine read failure and retries the engine read', () => {
    engineState.error = 'engine offline';
    render(<CouncilListPage />);
    expect(screen.getByText('council.readFailed')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('council-retry'));
    expect(mockEngineRefresh).toHaveBeenCalledTimes(1);
  });

  // The page counts days from the real clock, and the seeded council is dated 2026-09-18:
  // without a frozen "today" this suite turned red on that very day and stays red after it.
  afterEach(() => {
    jest.useRealTimers();
  });

  it('says a failed read out loud instead of calling it an empty list', () => {
    engineState.error = 'permission-denied';
    render(<CouncilListPage />);
    expect(screen.getByText('council.readFailed')).toBeInTheDocument();
    expect(screen.queryByText('council.emptyTitle')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('council-retry'));
    expect(mockEngineRefresh).toHaveBeenCalled();
  });

  it('shows the councils being prepared apart from the held ones, each opening its own page', () => {
    // Noon, not midnight UTC: `daysUntil` reads the LOCAL calendar date, and midnight UTC is
    // still the previous day west of Greenwich — the build machine and a laptop must agree.
    const today = new Date('2026-09-11T12:00:00Z');
    jest.useFakeTimers().setSystemTime(today);
    engineState.councils = seedCouncils('u1', today);
    render(<CouncilListPage />);

    const rows = screen.getAllByTestId(/council-row-/);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Совет 18 сентября');
    expect(rows[0]).toHaveAttribute('href', `/care/council/${engineState.councils[0].id}`);
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
    engineState.councils = seedCouncils('u1');
    render(<CouncilListPage />);

    fireEvent.click(screen.getByTestId('council-new'));
    const title = screen.getByTestId('council-new-title');
    fireEvent.change(title, { target: { value: 'Совет 2 октября' } });
    fireEvent.submit(title.closest('form') as HTMLFormElement);

    expect(mockCreate).toHaveBeenCalledWith({ title: 'Совет 2 октября', date: undefined });
    expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/^\/care\/council\/.+/));
  });

  // BUG-20260927-council-date-ignores-week-start: the browser's own date field starts the week as
  // the browser likes; the app's picker starts it on the day chosen in the settings.
  it("picks the new council's date with the app's date picker, not the browser's", () => {
    engineState.councils = seedCouncils('u1');
    const { container } = render(<CouncilListPage />);
    fireEvent.click(screen.getByTestId('council-new'));

    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(screen.getByLabelText(/council\.newCouncilDate|Дата|Date/i)).toHaveAttribute('type', 'text');
  });

  // The browser's date field never let a half-typed or non-existent day through; the text field
  // must keep that for the new council.
  it('does not create a council on a half-typed or non-existent day', () => {
    engineState.councils = seedCouncils('u1');
    render(<CouncilListPage />);
    fireEvent.click(screen.getByTestId('council-new'));
    const title = screen.getByTestId('council-new-title');
    const form = title.closest('form') as HTMLFormElement;
    const date = screen.getByLabelText(/council\.newCouncilDate|Дата|Date/i);
    fireEvent.change(title, { target: { value: 'Совет' } });

    // Inside act, so a create the page wrongly started would run before the check below.
    fireEvent.change(date, { target: { value: '2026-1' } });
    act(() => { form.requestSubmit(); });
    fireEvent.change(date, { target: { value: '2026-02-31' } });
    act(() => { form.requestSubmit(); });
    expect(mockCreate).not.toHaveBeenCalled();

    fireEvent.change(date, { target: { value: '2026-10-05' } });
    // The create runs through the engine creator, mounted by the submit's state update.
    act(() => { form.requestSubmit(); });
    expect(mockCreate).toHaveBeenCalledWith({ title: 'Совет', date: '2026-10-05' });
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
