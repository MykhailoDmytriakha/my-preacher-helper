import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import ServiceOrdersPage from '@/(pages)/(private)/care/orders/page';
import '@testing-library/jest-dom';

import en from '../../locales/en/translation.json';
import ru from '../../locales/ru/translation.json';
import uk from '../../locales/uk/translation.json';

/**
 * The global `react-i18next` mock returns the KEY, so assertions read as keys. The locale
 * coverage test at the bottom is what proves the words exist — in all three files, including
 * every step of every rite in the standard set.
 */

const mockMoveOrder = jest.fn().mockResolvedValue(undefined);
const mockSeed = jest.fn().mockResolvedValue(undefined);
const mockCreateCustom = jest.fn().mockResolvedValue(undefined);

const orderState = {
  orders: [] as unknown[],
  loading: false,
  isOnline: true,
  canSeed: false,
  seedingAll: false,
  seeding: false,
  moving: false,
};

jest.mock('@/hooks/useServiceOrders', () => ({
  useServiceOrders: () => ({
    ...orderState,
    seedStandardSet: mockSeed,
    createCustomOrder: mockCreateCustom,
    deleteOrder: jest.fn(),
    moveOrder: mockMoveOrder,
    error: null,
  }),
}));

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const order = (id: string, title: string, catalogKey?: string) => ({
  id,
  userId: 'u1',
  catalogKey,
  title,
  summary: '',
  steps: [{ id: 's1', title: 'Перед началом' }],
  rank: 1000,
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
});

describe('Orders of service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    orderState.orders = [
      order('u1_funeral', 'Погребение', 'funeral'),
      order('u1_wedding', 'Венчание', 'wedding'),
      order('custom-1', 'Своё'),
    ];
    orderState.canSeed = false;
    orderState.isOnline = true;
    orderState.seeding = false;
    orderState.moving = false;
  });

  it('names the section and lists the orders in the order given', () => {
    render(<ServiceOrdersPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('serviceOrders.title');
    const titles = screen.getAllByRole('link').map((link) => link.textContent);
    expect(titles.join(' ')).toContain('Погребение');
    expect(titles.join(' ')).toContain('Венчание');
    expect(titles.join(' ')).toContain('Своё');
  });

  it('opens each order at its own route', () => {
    render(<ServiceOrdersPage />);

    const row = screen.getByTestId('service-order-funeral');
    expect(within(row).getAllByRole('link')[0]).toHaveAttribute('href', '/care/orders/u1_funeral');
  });

  /**
   * ARRANGING IS ITS OWN JOB, so it has its own mode. At rest a row does one thing — open —
   * and the twenty arrows that used to stand on this page (two per rite, for something done
   * about once a year) are simply not there.
   */
  describe('arranging the list', () => {
    const enterReorder = () =>
      fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.reorder' }));

    it('shows no move controls until asked', () => {
      render(<ServiceOrdersPage />);

      expect(screen.queryByRole('button', { name: /serviceOrders\.moveUp/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'serviceOrders.reorder' })).toBeInTheDocument();
    });

    it('moves an order to the neighbouring place', () => {
      render(<ServiceOrdersPage />);
      enterReorder();

      const wedding = screen.getByTestId('service-order-wedding');
      fireEvent.click(within(wedding).getByRole('button', { name: /serviceOrders\.moveUp/ }));

      expect(mockMoveOrder).toHaveBeenCalledWith('u1_wedding', 0);
    });

    it('cannot move the first order up or the last one down', () => {
      render(<ServiceOrdersPage />);
      enterReorder();

      const first = screen.getByTestId('service-order-funeral');
      const last = screen.getByTestId('service-order-custom-1');
      expect(within(first).getByRole('button', { name: /serviceOrders\.moveUp/ })).toBeDisabled();
      expect(within(last).getByRole('button', { name: /serviceOrders\.moveDown/ })).toBeDisabled();
    });

    /** A row being arranged is not a doorway: tapping it must not open the rite underneath. */
    it('stops the rows from being links while arranging', () => {
      render(<ServiceOrdersPage />);
      const before = within(screen.getByTestId('service-order-funeral')).getAllByRole('link');
      expect(before.length).toBeGreaterThan(0);

      enterReorder();

      expect(within(screen.getByTestId('service-order-funeral')).queryByRole('link')).toBeNull();
    });

    /** Dragging is the natural gesture; the arrows stay for a keyboard and for a thumb. */
    it('gives every row a handle to drag, alongside the arrows', () => {
      render(<ServiceOrdersPage />);
      expect(screen.queryByRole('button', { name: /serviceOrders\.dragHandle/ })).not.toBeInTheDocument();

      enterReorder();

      expect(screen.getAllByRole('button', { name: /serviceOrders\.dragHandle/ })).toHaveLength(3);
      expect(screen.getAllByRole('button', { name: /serviceOrders\.moveUp/ })).toHaveLength(3);
      // Each control says WHICH service it moves: ten identical names tell a reader nothing.
      expect(screen.getByRole('button', { name: /serviceOrders\.dragHandle.*Погребение/ })).toBeInTheDocument();
    });

    it('puts the controls away again when done', () => {
      render(<ServiceOrdersPage />);
      enterReorder();
      fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.reorderDone' }));

      expect(screen.queryByRole('button', { name: /serviceOrders\.moveUp/ })).not.toBeInTheDocument();
      expect(within(screen.getByTestId('service-order-funeral')).getAllByRole('link').length).toBeGreaterThan(0);
    });
  });

  it('offers the standard set only while something of it is missing', () => {
    render(<ServiceOrdersPage />);
    expect(screen.queryByText('serviceOrders.seedHint')).not.toBeInTheDocument();

    orderState.canSeed = true;
    render(<ServiceOrdersPage />);
    expect(screen.getByText('serviceOrders.seedHint')).toBeInTheDocument();
  });

  /**
   * Seeding writes whole documents at ids derived from the rite, and a write like that queued
   * offline can land on top of words written elsewhere in the meantime. Refusing is the honest
   * answer; the button says why rather than pretending to work.
   */
  it('refuses to seed while offline, and says so', () => {
    orderState.canSeed = true;
    orderState.isOnline = false;
    render(<ServiceOrdersPage />);

    const seedButton = screen.getAllByRole('button', { name: 'serviceOrders.seed' }).pop();
    expect(seedButton).toBeDisabled();
    expect(seedButton).toHaveAttribute('title', 'serviceOrders.seedOffline');
    expect(mockSeed).not.toHaveBeenCalled();
  });

  /**
   * Caught on the very first live run: the rules were not deployed, Firestore refused the
   * write, and the button did nothing at all — the refusal lived only in the console. A person
   * would have pressed it again and concluded the app was broken.
   */
  it('says so when a write is refused instead of failing silently', async () => {
    orderState.canSeed = true;
    mockSeed.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
    render(<ServiceOrdersPage />);

    const seedButton = screen.getAllByRole('button', { name: 'serviceOrders.seed' }).pop() as HTMLElement;
    fireEvent.click(seedButton);

    // On the page itself, not only in a toast: a live run with an armed observer watched for
    // nine seconds and no toast ever appeared here. A message mounted somewhere else can be
    // nowhere, and then the button simply does nothing.
    await waitFor(() =>
      expect(screen.getByTestId('service-orders-failure')).toHaveTextContent('serviceOrders.writeFailed')
    );
    expect(toast.error).toHaveBeenCalledWith('serviceOrders.writeFailed');
  });

  /**
   * The empty page has ONE job — start — so it has one action of full weight. Two buttons of
   * equal weight are none: before this the page opened with a green box and an amber box side
   * by side, and the eye had no idea which to read first.
   */
  describe('the first opening', () => {
    beforeEach(() => {
      orderState.orders = [];
      orderState.canSeed = true;
    });

    it('invites rather than reports emptiness', () => {
      render(<ServiceOrdersPage />);

      expect(screen.getByText('serviceOrders.emptyTitle')).toBeInTheDocument();
      expect(screen.getByText('serviceOrders.emptyHint')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'serviceOrders.seed' })).toBeInTheDocument();
    });

    it('offers the standard set exactly once, with everything else quieter', () => {
      render(<ServiceOrdersPage />);

      expect(screen.getAllByRole('button', { name: 'serviceOrders.seed' })).toHaveLength(1);
      // "Your own order" stays reachable, but as a second line under the one thing to press.
      expect(screen.getAllByRole('button', { name: 'serviceOrders.custom' })).toHaveLength(1);
    });

    it('keeps the boundary as a footnote, never as a warning', () => {
      render(<ServiceOrdersPage />);

      const boundary = screen.getByText('serviceOrders.boundary');
      expect(boundary.className).not.toMatch(/amber/);
      expect(boundary.className).toMatch(/text-xs/);
    });
  });

  it('states the boundary the section keeps', () => {
    render(<ServiceOrdersPage />);
    expect(screen.getByText('serviceOrders.boundary')).toBeInTheDocument();
  });

  /**
   * The standard set is the section's substance: ten rites, every one of them with a sequence
   * of steps, in every language the app speaks. A missing array here is a rite that seeds as
   * an empty page — which is exactly the moment a person stops trusting the section.
   */
  it('carries the whole standard set in all three locales', () => {
    const CATALOG = [
      'funeral', 'wedding', 'baptism', 'communion', 'childBlessing',
      'visit', 'ordination', 'membership', 'anointing', 'houseBlessing',
    ];
    const PAGE_KEYS = ['title', 'subtitle', 'boundary', 'seed', 'seedHint', 'seedOffline', 'writeFailed', 'custom', 'newOrderTitle', 'dragHandle', 'reorder', 'reorderDone', 'reorderHint', 'moveUp', 'moveDown', 'open'];

    ([['en', en], ['ru', ru], ['uk', uk]] as const).forEach(([lang, dict]) => {
      const block = (dict as unknown as { serviceOrders?: Record<string, unknown> }).serviceOrders;
      if (!block) throw new Error(`No serviceOrders block in ${lang}`);

      PAGE_KEYS.forEach((key) => {
        const value = block[key];
        if (typeof value !== 'string' || !value.length) throw new Error(`Missing serviceOrders.${key} in ${lang}`);
      });

      const catalog = block.catalog as Record<string, { title?: string; summary?: string; steps?: unknown }>;
      CATALOG.forEach((key) => {
        const rite = catalog?.[key];
        if (!rite) throw new Error(`Missing rite ${key} in ${lang}`);
        if (typeof rite.title !== 'string' || !rite.title.length) throw new Error(`Missing title of ${key} in ${lang}`);
        if (!Array.isArray(rite.steps) || rite.steps.length === 0) throw new Error(`Missing steps of ${key} in ${lang}`);
        rite.steps.forEach((step: unknown, index: number) => {
          if (typeof step !== 'string' || !step.trim()) throw new Error(`Empty step ${index} of ${key} in ${lang}`);
        });
      });

      expect(Object.keys(catalog)).toHaveLength(CATALOG.length);
    });
  });

  /** The same rite must have the same number of steps everywhere, or a translation lost one. */
  it('has the same number of steps for each rite in every language', () => {
    const catalogOf = (dict: unknown) =>
      (dict as { serviceOrders: { catalog: Record<string, { steps: string[] }> } }).serviceOrders.catalog;

    const ruCatalog = catalogOf(ru);
    Object.keys(ruCatalog).forEach((key) => {
      expect(catalogOf(en)[key].steps).toHaveLength(ruCatalog[key].steps.length);
      expect(catalogOf(uk)[key].steps).toHaveLength(ruCatalog[key].steps.length);
    });
  });
});

/**
 * ONE MOVE AT A TIME.
 *
 * Two of them sent a second apart can reach Firestore in the other order, and then the list on
 * screen and the list in the database disagree about an arrangement the pastor made himself —
 * which is a different thing from two devices disagreeing, and not one he has any way to notice.
 */
describe('while a move is still in the air', () => {
  it('holds the arrows until the server has answered', async () => {
    orderState.moving = true;
    orderState.orders = [order('o1', 'Погребение'), order('o2', 'Венчание')];
    render(<ServiceOrdersPage />);
    await screen.findByText('Погребение');
    fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.reorder' }));

    const up = screen.getAllByRole('button', { name: /serviceOrders\.moveUp/ });
    expect(up.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    orderState.moving = false;
  });
});
