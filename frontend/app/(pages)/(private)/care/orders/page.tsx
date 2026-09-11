'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft,
  ArrowUpDown,
  GripVertical,
  Baby,
  ChevronRight,
  DoorOpen,
  Droplet,
  Droplets,
  Flower2,
  HandHeart,
  HeartHandshake,
  House,
  Plus,
  ScrollText,
  Users,
  Wine,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Chip } from '@/components/ui/Chip';
import { useServiceOrders } from '@/hooks/useServiceOrders';
import { CARE_CARD_TONES } from '@/utils/themeColors';

import { ReorderArrows, ServiceOrderFailure } from './ReorderArrows';

import type { ServiceOrder, ServiceOrderCatalogKey } from '@/models/models';
import type { ComponentType, SVGProps } from 'react';
import '@locales/i18n';

/**
 * ORDERS OF SERVICE — a section of the pastor's plane (`/care`).
 *
 * A REFERENCE BOOK, NOT A JOURNAL. One document per rite; performing a service leaves no
 * record here. The owner asked for exactly that, and it is what keeps the section alive: a
 * tool of this class dies of the upkeep it demands, not of the features it lacks.
 *
 * The app ships the SEQUENCE and never the words. Every step arrives as a title with an empty
 * body for the pastor to fill; nothing here prescribes a prayer, a formula or a reading.
 */

const CATALOG_ICONS: Record<ServiceOrderCatalogKey, ComponentType<SVGProps<SVGSVGElement>>> = {
  funeral: Flower2,
  wedding: HeartHandshake,
  baptism: Droplets,
  communion: Wine,
  childBlessing: Baby,
  visit: DoorOpen,
  ordination: HandHeart,
  membership: Users,
  anointing: Droplet,
  houseBlessing: House,
};

/** An order the pastor wrote himself has no catalog icon; the scroll stands for the section. */
const iconFor = (order: ServiceOrder) =>
  (order.catalogKey && CATALOG_ICONS[order.catalogKey]) || ScrollText;

const tone = CARE_CARD_TONES.emerald;

export default function ServiceOrdersPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const {
    orders,
    loading,
    isOnline,
    canSeed,
    seeding,
    seedStandardSet,
    createCustomOrder,
    moveOrder,
    moving,
    error,
    refresh,
  } = useServiceOrders();

  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * ARRANGING IS A DIFFERENT JOB FROM OPENING, so it gets its own mode.
   *
   * Twenty arrows stood on this page at rest — two on every rite — for something a pastor
   * does about once. In the state he is actually in, a row has one job: open. The controls
   * for the other job come out when he says so and go away when he is done, the way a list
   * that can be rearranged has behaved on this kind of device for fifteen years.
   */
  const [reordering, setReordering] = useState(false);
  const isEmpty = orders.length === 0;

  /**
   * A PAGE WITH NOTHING ON IT IS A PAGE THAT LOOKS BROKEN.
   *
   * While the first read is in the air this screen used to render nothing at all — on a fast
   * machine that is a blink, and on a tablet with a poor connection it is a blank page under a
   * heading, with no list, no invitation to start, and nothing to press. The owner met exactly
   * that and asked where "завести типовые" had gone.
   *
   * So: rows in outline while it is being fetched, a plain sentence if it is taking unusually
   * long, and a way to ask again either way.
   */
  const [slowRead, setSlowRead] = useState(false);

  useEffect(() => {
    if (!loading) {
      setSlowRead(false);
      return;
    }
    const timer = setTimeout(() => setSlowRead(true), 10000);
    return () => clearTimeout(timer);
  }, [loading]);

  const askAgain = () => {
    setSlowRead(false);
    void refresh();
  };

  /**
   * The same dnd-kit setup the series screen uses — one mechanism for dragging in this app,
   * not a second one written here. Eight pixels before a drag starts, so a tap on a row is a
   * tap; the keyboard sensor is what lets this be done without a mouse at all.
   */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  /**
   * A REFUSED WRITE MUST SAY SO. The first live run of this page pressed the button and
   * nothing happened at all — the rules had not been deployed yet, Firestore answered
   * "insufficient permissions", and the only place it appeared was the browser console.
   * A person would have pressed it again, and again, and concluded the app was broken.
   */
  const announceFailure = (error: unknown) => {
    console.error('serviceOrders write failed', error);
    // Spreading the whole list needs a connection, and saying "could not save" about that
    // sends a person looking for a fault that is not there.
    if ((error as Error)?.message === 'OFFLINE_RENUMBER') {
      setFailure(t('serviceOrders.renumberOffline') as string);
      toast.error(t('serviceOrders.renumberOffline') as string);
      return;
    }
    // ON THE PAGE, not only in a toast. The toast was the whole answer once, and a live run
    // proved it silent here: an armed observer watched for nine seconds and no toast ever
    // appeared. A message that depends on something mounted elsewhere can be nowhere, and the
    // person is then left pressing a button that does nothing. This line is part of the page.
    setFailure(t('serviceOrders.writeFailed') as string);
    toast.error(t('serviceOrders.writeFailed') as string);
  };

  /**
   * Creates the order AND OPENS IT, in edit mode.
   *
   * It used to create a document called "Свой порядок" and leave the person standing on the
   * list, where a row had appeared with a name nobody chose — the owner's words were "вот это
   * вообще непонятно. Что это такое?". A button that makes something should put you inside
   * the thing it made, with the name waiting to be typed.
   */
  const addCustom = async () => {
    setCreating(true);
    setFailure(null);
    try {
      const created = await createCustomOrder(t('serviceOrders.newOrderTitle') as string);
      router.push(`/care/orders/${created.id}?new=1`);
    } catch (error) {
      announceFailure(error);
    } finally {
      setCreating(false);
    }
  };

  const move = async (id: string, toIndex: number) => {
    setFailure(null);
    try {
      await moveOrder(id, toIndex);
    } catch (error) {
      announceFailure(error);
    }
  };

  /** Dropped where the eye was pointing: dnd-kit's target index is the place in the list. */
  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const toIndex = orders.findIndex((order) => order.id === over.id);
    if (toIndex < 0) return;
    await move(String(active.id), toIndex);
  };

  const seed = async () => {
    setFailure(null);
    try {
      await seedStandardSet();
    } catch (error) {
      announceFailure(error);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl">
      {/*
        The same way back as the service page has, in the same colour and the same place: a
        person leaving a section should not have to work out which page he is on first.
      */}
      <Link
        href="/care"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 transition hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        {t('serviceOrders.backToPlane')}
      </Link>

      {/*
        The title and the actions share ONE line, always: the description below them is the
        widest thing on the page, and while it sat beside the buttons it pushed them onto a
        line of their own, left-aligned under the text, where nothing expects to find them.
      */}
      <header className="mt-4">
        <div className="flex items-center justify-between gap-4">
          {/*
            The section's own icon and colour beside the name, the way the prayer journal
            wears its flame: a person landing here should know which room he is in before he
            reads a word.
          */}
          <h1 className="flex min-w-0 items-center gap-3 text-2xl font-extrabold tracking-tight text-emerald-700 sm:text-3xl dark:text-emerald-300">
            <ScrollText className="h-7 w-7 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span className="min-w-0 truncate">{t('serviceOrders.title')}</span>
          </h1>

        {/*
          THE TOP ACTION STANDS DOWN WHILE THE PAGE IS EMPTY.
          An empty page has one job — start — and two buttons of equal weight are none. Here
          the standard set is the answer, and "your own order" waits below it as a quiet line;
          once there is a list to add to, this button comes back where a list expects it.
        */}
        {!isEmpty && (
          <div className="flex shrink-0 items-center gap-2">
            {reordering ? (
              <button
                type="button"
                onClick={() => setReordering(false)}
                className="inline-flex items-center rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                {t('serviceOrders.reorderDone')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setReordering(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:border-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <ArrowUpDown className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  {t('serviceOrders.reorder')}
                </button>
                {/* The one action of this page, and it looks like it — filled, like the
                    journal's "add a prayer". */}
                <button
                  type="button"
                  onClick={addCustom}
                  /*
                   * Creating needs a connection: Firestore only names a new document once the
                   * server has it, so offline this press would hang instead of opening the
                   * service it promised. Everything already created stays editable offline.
                   */
                  disabled={creating || !isOnline}
                  title={!isOnline ? (t('serviceOrders.createOffline') as string) : undefined}
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  {t('serviceOrders.custom')}
                </button>
              </>
            )}
          </div>
        )}
        </div>

        {/* While arranging, the line under the title says what the mode is FOR — read before
            the list, not after it. */}
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          {reordering ? t('serviceOrders.reorderHint') : t('serviceOrders.subtitle')}
        </p>
      </header>

      {isEmpty && loading ? (
        <BeingRead slow={slowRead} onRetry={askAgain} />
      ) : isEmpty && error ? (
        <CouldNotBeRead onRetry={askAgain} />
      ) : isEmpty && !loading ? (
        <FirstOpening
          onSeed={seed}
          onCustom={addCustom}
          seeding={seeding}
          creating={creating}
          isOnline={isOnline}
          failure={failure}
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={orders.map((order) => order.id)}
          strategy={verticalListSortingStrategy}
        >
        <ul className={`flex flex-col gap-2.5 ${reordering ? 'mt-4' : 'mt-7'}`}>
          {orders.map((order, index) => (
            <li key={order.id}>
              <OrderRow
                order={order}
                index={index}
                total={orders.length}
                reordering={reordering}
                moving={moving}
                onMove={move}
              />
            </li>
          ))}
        </ul>
        </SortableContext>
        </DndContext>
      )}

      {canSeed && !isEmpty && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-dashed border-gray-300 p-4 dark:border-gray-700">
          <p className="min-w-0 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {t('serviceOrders.seedHint')}
          </p>
          <button
            type="button"
            onClick={seed}
            disabled={seeding || !isOnline}
            title={!isOnline ? (t('serviceOrders.seedOffline') as string) : undefined}
            className="inline-flex shrink-0 items-center rounded-full border border-emerald-700 px-4 py-2 text-sm font-bold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
          >
            {seeding ? t('serviceOrders.seeding') : t('serviceOrders.seed')}
          </button>
        </div>
      )}

      {!isEmpty && failure && <ServiceOrderFailure message={failure} testId="service-orders-failure" />}

      {!isEmpty && (
        // A footnote, not an announcement: it is true, but it is not what the page is for.
        <p className="mt-6 text-xs leading-relaxed text-gray-400 dark:text-gray-500">
          {t('serviceOrders.boundary')}
        </p>
      )}
    </div>
  );
}



/**
 * FIRST OPENING — an invitation, not a leftover.
 *
 * Three things and nothing else: what will be here, the one thing to press, and — in a quiet
 * line, in grey — why it is safe to press it. The boundary about theology used to sit in an
 * amber box below; amber reads as a warning, and the page opened by saying "something is wrong"
 * instead of "start here".
 */
function FirstOpening({
  onSeed,
  onCustom,
  seeding,
  creating,
  isOnline,
  failure,
}: {
  onSeed: () => void;
  onCustom: () => void;
  seeding: boolean;
  creating: boolean;
  isOnline: boolean;
  failure: string | null;
}) {
  const { t } = useTranslation();
  return (
<section className="mt-16 flex flex-col items-center px-6 text-center">
      <ScrollText
        className="h-12 w-12 text-emerald-700/25 dark:text-emerald-300/25"
        strokeWidth={1.25}
        aria-hidden="true"
      />
      <h2 className="mt-5 text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100">
        {t('serviceOrders.emptyTitle')}
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-gray-500 dark:text-gray-400">
        {t('serviceOrders.emptyHint')}
      </p>

      <button
        type="button"
        onClick={onSeed}
        disabled={seeding || !isOnline}
        title={!isOnline ? (t('serviceOrders.seedOffline') as string) : undefined}
        className="mt-7 inline-flex items-center rounded-full bg-emerald-700 px-6 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        {seeding ? t('serviceOrders.seeding') : t('serviceOrders.seed')}
      </button>

      <button
        type="button"
        onClick={onCustom}
        disabled={creating || !isOnline}
        title={!isOnline ? (t('serviceOrders.createOffline') as string) : undefined}
        className="mt-3.5 text-sm font-semibold text-emerald-700 underline-offset-4 transition hover:underline disabled:opacity-60 dark:text-emerald-300"
      >
        {t('serviceOrders.custom')}
      </button>

      {failure && <ServiceOrderFailure message={failure} testId="service-orders-failure" />}

      <p className="mt-10 max-w-md text-xs leading-relaxed text-gray-400 dark:text-gray-500">
        {t('serviceOrders.boundary')}
      </p>
    </section>
  );
}

/**
 * BEING FETCHED IS NOT NOTHING. The shape of the list while it is on its way, so the page says
 * "wait" instead of looking broken — and, if it is taking unusually long, says that too and
 * offers the one thing worth pressing.
 */
function BeingRead({ slow, onRetry }: { slow: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="mt-7 flex flex-col gap-2.5" aria-busy="true" data-testid="service-orders-loading">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="h-16 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />
      ))}
      {slow && (
        <div className="mt-6 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('serviceOrders.slowRead')}</p>
          <button
            type="button"
            onClick={onRetry}
            className="text-sm font-semibold text-emerald-700 underline-offset-4 transition hover:underline dark:text-emerald-300"
          >
            {t('serviceOrders.retry')}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * A LIST THAT COULD NOT BE READ IS NOT AN EMPTY LIST. Inviting him to start a standard set he
 * may already have is how a rite gets seeded twice, and "у тебя пока пусто" about a failed read
 * is simply untrue.
 */
function CouldNotBeRead({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="mt-16 flex flex-col items-center px-6 text-center" data-testid="service-orders-unread">
      <p className="max-w-md text-sm leading-relaxed text-gray-600 dark:text-gray-300">
        {t('serviceOrders.listUnread')}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex items-center rounded-full bg-emerald-700 px-6 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        {t('serviceOrders.retry')}
      </button>
    </section>
  );
}

function OrderRow({
  order,
  index,
  total,
  reordering,
  moving,
  onMove,
}: {
  order: ServiceOrder;
  index: number;
  total: number;
  reordering: boolean;
  /**
   * ONE MOVE AT A TIME. Two of them sent a second apart can reach Firestore in the other order,
   * and then the list on screen and the list in the database disagree about an arrangement the
   * pastor made himself — which is a different thing from two devices disagreeing, and not one
   * he has any way to notice.
   */
  moving: boolean;
  onMove: (id: string, toIndex: number) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const Icon = iconFor(order);
  // Registered always, active only while arranging: the hook must be called unconditionally,
  // and `disabled` is what decides whether a row can actually be picked up.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: order.id,
    disabled: !reordering || moving,
  });

  const stepCount = t('serviceOrders.steps', { count: order.steps.length });
  const nameAndSummary = (
    <>
      <span className="block truncate text-sm font-bold tracking-tight text-gray-900 dark:text-gray-100">
        {order.title}
      </span>
      <span className="block truncate text-[11px] leading-snug text-gray-500 dark:text-gray-400">
        {order.summary || stepCount}
      </span>
    </>
  );

  return (
    <div
      ref={setNodeRef}
      /*
       * THE LIFTED CARD HAS TO BE ON TOP, and `z-10` alone does not put it there: z-index is
       * ignored on a statically positioned element, so the row below kept painting over the
       * one in the hand. The card is positioned while it travels, and only then.
       */
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : undefined,
        position: isDragging ? 'relative' : undefined,
      }}
      className={`flex items-center gap-3 rounded-2xl border bg-white p-4 transition-colors dark:bg-gray-900 ${
        reordering
          ? 'border-emerald-200 dark:border-emerald-900/60'
          : 'border-gray-200 hover:border-emerald-300 dark:border-gray-800 dark:hover:border-emerald-800'
      } ${isDragging ? 'shadow-xl ring-2 ring-emerald-300 dark:ring-emerald-700' : ''}`}
      data-testid={`service-order-${order.catalogKey ?? order.id}`}
    >
      {reordering && (
        // The handle IS the grip: the row is picked up where the hand is already pointing,
        // and the cursor says so before anything moves.
        <button
          type="button"
          // Ten handles with one name tell a screen reader nothing about what it will move.
          aria-label={`${t('serviceOrders.dragHandle')}: ${order.title}`}
          className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center text-gray-300 active:cursor-grabbing dark:text-gray-600"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </button>
      )}
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone.wash}`}
        aria-hidden="true"
      >
        <Icon className={`h-5 w-5 ${tone.icon}`} strokeWidth={1.5} />
      </span>

      {/* While arranging, a row is not a doorway: tapping it must move nothing and open nothing. */}
      {/*
        The same name and line under it either way — only what WRAPS them changes, because a row
        that is being dragged must not also be a link. Written out twice, the two copies were one
        edit away from disagreeing about what a rite looks like.
      */}
      {reordering ? (
        <span className="min-w-0 flex-1">{nameAndSummary}</span>
      ) : (
        <Link href={`/care/orders/${order.id}`} className="min-w-0 flex-1">
          {nameAndSummary}
        </Link>
      )}

      {/* The app's own chip, not a hand-rolled pill: /prayers, /groups and /studies all wear
          this one, and a fourth private copy is how a family of controls starts to drift. */}
      <span className="hidden shrink-0 sm:inline">
        <Chip tone="emerald" size="sm" weight="bold">
          {stepCount}
        </Chip>
      </span>

      {/*
        Up and down rather than dragging: it works with a keyboard, with a screen reader and
        with one thumb on a phone, and every one of those is a person this section is for.
      */}
      {reordering && (
        <ReorderArrows
          canMoveUp={index > 0 && !moving}
          canMoveDown={index < total - 1 && !moving}
          onMoveUp={() => onMove(order.id, index - 1)}
          onMoveDown={() => onMove(order.id, index + 1)}
          upLabel={`${t('serviceOrders.moveUp')}: ${order.title}`}
          downLabel={`${t('serviceOrders.moveDown')}: ${order.title}`}
        />
      )}

      {!reordering && (
        <Link
          href={`/care/orders/${order.id}`}
          aria-label={`${t('serviceOrders.open')}: ${order.title}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-300 transition hover:bg-gray-100 hover:text-gray-600 dark:text-gray-600 dark:hover:bg-gray-800"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
