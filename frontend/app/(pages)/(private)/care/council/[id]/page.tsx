'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft,
  ArrowRightToLine,
  ArrowUpDown,
  Check,
  GripVertical,
  Landmark,
  Megaphone,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ReorderArrows } from '@/(pages)/(private)/care/orders/ReorderArrows';
import { CouncilOutcomePanel, useOutcomeLine, useTopicStateLine } from '@/components/council/CouncilOutcomePanel';
import MarkdownDisplay from '@/components/MarkdownDisplay';
import { Chip } from '@/components/ui/Chip';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { useCouncil } from '@/hooks/useCouncils';
import {
  applyOutcome,
  hasProgress,
  holdCouncil,
  isInfoTopic,
  newOption,
  newQuestion,
  newTopic,
  outcomeText,
  preparingCouncils,
  reopenCouncil,
  reorderTopics,
  topicState,
} from '@/utils/council';
import { formatDate, formatDateOnly } from '@/utils/dateFormatter';
import { CARE_CARD_TONES } from '@/utils/themeColors';

import type { Council, CouncilTopic } from '@/models/models';
import type { FormEvent } from 'react';
import '@locales/i18n';

/**
 * ONE COUNCIL — prepared here, held in `./conduct`, and read here afterwards.
 *
 * While the council is being PREPARED every section is editable in place: what the matter is,
 * what the brothers may ask and what the pastor would answer, which decisions are on the
 * table. Once it is HELD the same page shows what was decided, and every later edit of an
 * outcome is kept as "was → became" with its date — the owner asked to see exactly that.
 */

const tone = CARE_CARD_TONES.indigo;

const buttonPrimary =
  'inline-flex items-center gap-2 rounded-full bg-indigo-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-800 disabled:opacity-50 dark:bg-indigo-600 dark:hover:bg-indigo-500';
const buttonQuiet =
  'inline-flex items-center gap-2 rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 transition hover:border-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800';
const buttonText =
  'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200';
const inputClass =
  'w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500';
const labelClass = 'block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400';
/** The quiet line under a label that says what the field is FOR — the owner asked for it in the editor. */
const hintClass = 'mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400';
/** One card token for the page: a border a phone can see and a shadow that lifts it off white. */
const cardClass = 'rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900';

type TopicUpdater = (topic: CouncilTopic) => CouncilTopic;

export default function CouncilDetailPage() {
  const { id } = useParams();
  const councilId = typeof id === 'string' ? id : '';
  const { t } = useTranslation();
  const router = useRouter();
  const { council, councils, loading, error, refresh, updateCouncil, deleteCouncil, carryTopicToNext } = useCouncil(councilId);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  /** Where the "add section" form is open — at the top, or at the bottom of a long council. */
  const [addingTopic, setAddingTopic] = useState<'top' | 'bottom' | null>(null);
  const [newTopicTitle, setNewTopicTitle] = useState('');
  /**
   * ARRANGING IS A DIFFERENT JOB FROM READING, so it has its own mode — the same rule the
   * orders of service follow: handles and arrows come out when asked and go away when done.
   */
  const [reordering, setReordering] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  // The same dnd-kit setup as the orders of service: eight pixels before a drag starts, so a
  // tap stays a tap; the keyboard sensor lets it be done without a pointer at all.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  if (!council) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <BackToList />
        {loading ? (
          <div className="mt-8 h-24 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />
        ) : error && councils.length === 0 ? (
          <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/60 dark:bg-amber-950/30" role="alert">
            <p className="text-sm text-amber-900 dark:text-amber-200">{t('council.readFailed')}</p>
            <button type="button" onClick={() => void refresh()} className={`mt-3 ${buttonQuiet}`}>
              {t('council.retry')}
            </button>
          </section>
        ) : (
          <p className="mt-8 text-sm text-gray-600 dark:text-gray-400">{t('council.detail.notFound')}</p>
        )}
      </div>
    );
  }

  const held = council.status === 'held';
  const councilsById = Object.fromEntries(councils.map((item) => [item.id, item])) as Record<string, Council | undefined>;
  const patch = (updater: (current: Council) => Council) => updateCouncil(council.id, updater);
  const patchTopic = (topicId: string, updater: TopicUpdater) =>
    patch((current) => ({
      ...current,
      topics: current.topics.map((topic) => (topic.id === topicId ? updater(topic) : topic)),
    }));

  const addTopic = (event: FormEvent) => {
    event.preventDefault();
    const title = newTopicTitle.trim();
    if (!title) return;
    const topic = newTopic(title);
    patch((current) => ({ ...current, topics: [...current.topics, topic] }));
    setNewTopicTitle('');
    setAddingTopic(null);
    setEditingTopicId(topic.id);
  };

  const removeTopic = (topicId: string) => {
    patch((current) => ({ ...current, topics: current.topics.filter((topic) => topic.id !== topicId) }));
    if (editingTopicId === topicId) setEditingTopicId(null);
  };

  const canConduct = !held && council.topics.some((topic) => topic.title.trim());

  /**
   * What was not talked through goes to the next council in one press: the section is copied
   * — matter, questions, options, no outcome — into the council being prepared, or into a new
   * one when none is. The person is told where it landed and can go there.
   */
  const carryTargets = preparingCouncils(councils);
  const carryToNext = (topic: CouncilTopic, targetId?: string | 'new') => {
    const target = carryTopicToNext(council.id, topic, t('council.nextCouncilTitle'), targetId);
    if (!target) return;
    toast.success(t('council.topic.movedToNext', { title: target.title }), {
      action: { label: target.title, onClick: () => router.push(`/care/council/${target.id}`) },
    });
  };

  const progressStarted = hasProgress(council);

  /** One press closes the council; the toast carries the way back instead of a second question. */
  const finishCouncil = () => {
    updateCouncil(council.id, (current) => holdCouncil(current, new Date().toISOString()));
    toast.success(t('council.detail.finished'), {
      // Eight seconds, not four: an undo a person cannot reach in time is not an undo.
      duration: 8000,
      action: {
        label: t('council.detail.undo'),
        onClick: () => updateCouncil(council.id, (current) => reopenCouncil(current, new Date().toISOString())),
      },
    });
  };

  const moveTopic = (topicId: string, toIndex: number) => {
    const fromIndex = council.topics.findIndex((topic) => topic.id === topicId);
    patch((current) => reorderTopics(current, fromIndex, toIndex));
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;
    const toIndex = council.topics.findIndex((topic) => topic.id === over.id);
    if (toIndex >= 0) moveTopic(String(active.id), toIndex);
  };

  const activeTopic = council.topics.find((topic) => topic.id === activeId);

  const addTopicForm = (
    <form onSubmit={addTopic} className="mt-3 flex gap-2">
      <input
        autoFocus
        value={newTopicTitle}
        onChange={(event) => setNewTopicTitle(event.target.value)}
        placeholder={t('council.detail.newTopicPlaceholder')}
        className={inputClass}
        data-testid="council-new-topic"
      />
      <button type="submit" className={buttonPrimary} disabled={!newTopicTitle.trim()}>
        {t('council.create')}
      </button>
      <button type="button" onClick={() => setAddingTopic(null)} className={buttonQuiet}>
        {t('council.cancel')}
      </button>
    </form>
  );

  return (
    <div className="mx-auto w-full max-w-4xl">
      <BackToList />

      <header className="mt-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            {held ? (
              <h1 className={`text-2xl font-extrabold tracking-tight sm:text-3xl ${tone.title}`}>{council.title}</h1>
            ) : (
              <input
                aria-label={t('council.detail.titleLabel')}
                value={council.title}
                onChange={(event) => patch((current) => ({ ...current, title: event.target.value }))}
                className={`w-full rounded-lg border border-transparent bg-transparent px-1 text-2xl font-extrabold tracking-tight hover:border-gray-200 focus:border-indigo-400 focus:outline-none sm:text-3xl dark:hover:border-gray-700 ${tone.title}`}
                data-testid="council-title"
              />
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 px-1 text-sm text-gray-600 dark:text-gray-400">
              <Chip size="sm" tone={held ? 'neutral' : 'indigo'}>
                {t(`council.status.${council.status}`)}
              </Chip>
              {held ? (
                <span>{t('council.heldOn', { date: council.heldAt ? formatDate(council.heldAt) : '' })}</span>
              ) : (
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                  {t('council.detail.dateLabel')}
                  <input
                    type="date"
                    value={council.date ?? ''}
                    onChange={(event) =>
                      patch((current) => {
                        const next = { ...current };
                        if (event.target.value) next.date = event.target.value;
                        else delete next.date;
                        return next;
                      })
                    }
                    className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm font-normal text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  />
                </label>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {reordering ? (
              <button type="button" onClick={() => setReordering(false)} className={buttonPrimary} data-testid="council-reorder-done">
                <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                {t('council.detail.reorderDone')}
              </button>
            ) : (
              <>
                {!held && council.topics.length > 1 && (
                  <button type="button" onClick={() => setReordering(true)} className={buttonQuiet} data-testid="council-reorder">
                    <ArrowUpDown className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    {t('council.detail.reorder')}
                  </button>
                )}
                {/*
                  THE TOP ACTION STANDS DOWN WHILE THE COUNCIL IS EMPTY. An empty council has one
                  job — get its first section — and a greyed "hold the council" beside a quiet
                  "add section" is two buttons of no weight. It comes back once there is something
                  to hold; and once marks exist it says "continue", because leaving the meeting
                  screen loses nothing.
                */}
                {!held && council.topics.length > 0 && (
                  <button
                    type="button"
                    disabled={!canConduct}
                    title={!canConduct ? (t('council.detail.conductNeedsTopics') as string) : undefined}
                    onClick={() => router.push(`/care/council/${council.id}/conduct`)}
                    className={buttonPrimary}
                    data-testid="council-conduct"
                  >
                    <Play className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    {progressStarted ? t('council.detail.continueConduct') : t('council.detail.conduct')}
                  </button>
                )}
                {!held && progressStarted && (
                  <button type="button" onClick={finishCouncil} className={buttonQuiet} data-testid="council-finish-here">
                    <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    {t('council.detail.finish')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className={buttonQuiet}
                  aria-label={t('council.detail.delete')}
                  title={t('council.detail.delete')}
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </div>
        {!held && (
          <p className="mt-3 max-w-2xl px-1 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            {reordering ? t('council.detail.reorderHint') : t('council.detail.conductHint')}
          </p>
        )}
      </header>

      <section className="mt-8">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {held ? t('council.detail.outcomes') : t('council.detail.sections')}
          </h2>
          {!held && !addingTopic && (
            <button
              type="button"
              onClick={() => setAddingTopic('top')}
              // Filled while it is the only thing to do; quiet once the list exists and
              // "hold the council" has taken the top weight.
              className={council.topics.length === 0 ? buttonPrimary : buttonQuiet}
              data-testid="council-add-topic"
            >
              <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              {t('council.detail.addTopic')}
            </button>
          )}
        </div>

        {addingTopic === 'top' && addTopicForm}

        {reordering ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={(event) => setActiveId(String(event.active.id))}
            onDragCancel={() => setActiveId(null)}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={council.topics.map((topic) => topic.id)} strategy={verticalListSortingStrategy}>
              <ol className="mt-3 space-y-2">
                {council.topics.map((topic, index) => (
                  <SortableTopicRow key={topic.id} topic={topic} index={index} total={council.topics.length} onMove={moveTopic} />
                ))}
              </ol>
            </SortableContext>
            <DragOverlay dropAnimation={{ sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } }) }}>
              {activeTopic ? (
                <div aria-hidden="true">
                  <TopicRowView topic={activeTopic} index={council.topics.indexOf(activeTopic)} total={council.topics.length} onMove={moveTopic} overlay />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
        <ol className="mt-3 space-y-3">
          {council.topics.map((topic, index) => (
            <li key={topic.id}>
              <TopicCard
                index={index + 1}
                topic={topic}
                held={held}
                editing={editingTopicId === topic.id}
                onEdit={() => setEditingTopicId(topic.id)}
                onDone={() => setEditingTopicId(null)}
                onChange={(updater) => patchTopic(topic.id, updater)}
                onRemove={() => removeTopic(topic.id)}
                onCarryToNext={(targetId) => carryToNext(topic, targetId)}
                carryTargets={carryTargets}
                carriedTo={topic.carriedToCouncilId ? councilsById[topic.carriedToCouncilId] : undefined}
              />
            </li>
          ))}
        </ol>
        )}

        {council.topics.length === 0 && !addingTopic && (
          <p className="mt-3 px-1 text-sm text-gray-500 dark:text-gray-400">{t('council.detail.conductNeedsTopics')}</p>
        )}

        {/*
          THE SAME BUTTON AT THE BOTTOM. A long council is written from the top down; the
          person is at the end of it when the next section comes to mind, and the new section
          belongs right there, under the last one — not behind a scroll to the top and back.
        */}
        {!held && !reordering && council.topics.length > 0 && addingTopic !== 'bottom' && (
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={() => setAddingTopic('bottom')} className={buttonQuiet} data-testid="council-add-topic-bottom">
              <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              {t('council.detail.addTopic')}
            </button>
          </div>
        )}
        {addingTopic === 'bottom' && addTopicForm}
      </section>


      <ConfirmModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteCouncil(council.id);
          setConfirmDelete(false);
          router.push('/care/council');
        }}
        title={t('council.detail.delete')}
        description={t('council.detail.deleteConfirm')}
        confirmText={t('council.detail.delete')}
        cancelText={t('council.cancel')}
        isDestructive
      />
    </div>
  );
}

function BackToList() {
  const { t } = useTranslation();
  return (
    <Link
      href="/care/council"
      className={`inline-flex items-center gap-1.5 text-sm font-semibold transition ${tone.title} hover:opacity-80`}
    >
      <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      {t('council.detail.backToList')}
    </Link>
  );
}

function TopicCard({
  index,
  topic,
  held,
  editing,
  onEdit,
  onDone,
  onChange,
  onRemove,
  onCarryToNext,
  carryTargets,
  carriedTo,
}: {
  index: number;
  topic: CouncilTopic;
  held: boolean;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onChange: (updater: TopicUpdater) => void;
  onRemove: () => void;
  onCarryToNext: (targetId?: string | 'new') => void;
  /** Councils being prepared — when there is more than one, the person picks where the section goes. */
  carryTargets: Council[];
  /** The council this section was carried to, when it was. */
  carriedTo?: Council;
}) {
  const { t } = useTranslation();
  const outcomeLine = useOutcomeLine();
  const stateLine = useTopicStateLine();
  const [editingOutcome, setEditingOutcome] = useState(false);
  const [enteringOutcome, setEnteringOutcome] = useState(false);
  const [choosingTarget, setChoosingTarget] = useState(false);
  const [draftOption, setDraftOption] = useState<string>('');
  const [draftDecision, setDraftDecision] = useState('');
  const [draftResolution, setDraftResolution] = useState<CouncilTopic['resolution'] | undefined>(undefined);

  const startOutcomeEdit = () => {
    setDraftOption(topic.acceptedOptionId ?? '');
    setDraftDecision(topic.decision ?? '');
    setDraftResolution(topic.resolution);
    setEditingOutcome(true);
  };

  const saveOutcome = () => {
    onChange((current) =>
      applyOutcome(
        current,
        draftResolution
          ? { resolution: draftResolution }
          : { acceptedOptionId: draftOption || '', decision: draftDecision, resolution: null },
        { at: new Date().toISOString(), trackChanges: true }
      )
    );
    setEditingOutcome(false);
  };

  const outcome = outcomeText(topic);
  const state = topicState(topic);
  const info = isInfoTopic(topic);
  const handled = state !== 'open';
  const canCarry = state === 'open' || state === 'postponed';
  const isBare = !topic.summary && topic.questions.length === 0 && (info || topic.options.length === 0);

  return (
    <article className={cardClass} data-testid={`council-topic-${topic.id}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 w-6 shrink-0 text-sm font-extrabold ${tone.count}`}>{index}</span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <TopicEditor topic={topic} onChange={onChange} onRemove={onRemove} onDone={onDone} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{topic.title}</h3>
                {info && (
                  <Chip size="sm" tone="neutral" icon={<Megaphone className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />}>
                    {t('council.topic.infoChip')}
                  </Chip>
                )}
                {topic.forAssembly && (
                  <Chip size="sm" tone="indigo" weight="bold" icon={<Landmark className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />}>
                    {t('council.topic.forAssemblyChip')}
                  </Chip>
                )}
              </div>
              {topic.summary && (
                // Not compact: an explanation may carry headings and nested lists, and they
                // should read at full size here — this is the page where it is studied.
                <div className="mt-1.5 text-sm leading-relaxed text-gray-800 dark:text-gray-300">
                  <MarkdownDisplay content={topic.summary} />
                </div>
              )}
              {!held && isBare && (
                <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">{t('council.topic.empty')}</p>
              )}

              {topic.questions.length > 0 && (
                <div className="mt-3">
                  <p className={labelClass}>{t('council.topic.questions')}</p>
                  <ul className="mt-1.5 space-y-1.5">
                    {topic.questions.map((question) => (
                      <li key={question.id} className="text-sm">
                        <p className="font-semibold text-gray-800 dark:text-gray-200">{question.question}</p>
                        {/* The answer steps in from the question: two tones of grey alone read as one block. */}
                        {question.answer && (
                          <p className="mt-0.5 ml-3 border-l-2 border-indigo-200 pl-3 text-gray-700 dark:border-indigo-900 dark:text-gray-400">
                            {question.answer}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!info && topic.options.length > 0 && (
                <div className="mt-3">
                  <p className={labelClass}>{t('council.topic.options')}</p>
                  <ul className="mt-1.5 space-y-1">
                    {topic.options.map((option) => {
                      const accepted = option.id === topic.acceptedOptionId;
                      return (
                        <li
                          key={option.id}
                          className={`flex items-center gap-2 text-sm ${
                            accepted
                              ? 'font-bold text-indigo-700 dark:text-indigo-300'
                              : 'text-gray-700 dark:text-gray-300'
                          }`}
                        >
                          {accepted ? (
                            <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                          ) : (
                            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600" aria-hidden="true" />
                          )}
                          {option.text}
                          {accepted && <span className="text-xs font-semibold">· {t('council.topic.accepted')}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {!held && (
                /*
                 * THE OUTCOME WITHOUT THE MEETING SCREEN. The owner: "пришёл домой и хочу
                 * внести результат" — the same panel the conduct screen uses, opened here per
                 * section, so a council can be recorded after the fact, one section at a time.
                 */
                <div className="mt-3 rounded-xl border border-indigo-200/80 bg-indigo-50/50 p-3 dark:border-indigo-900/50 dark:bg-indigo-950/20">
                  {/* An announcement's row of three does not fit beside the label on a phone: there it
                      stacks — label above, row below, wrapping — and sits in one line from `sm` up. */}
                  <div
                    className={
                      info
                        ? 'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3'
                        : 'flex items-start justify-between gap-3'
                    }
                  >
                    <div className="min-w-0">
                      <p className={labelClass}>{t('council.topic.atCouncil')}</p>
                      {/* An announcement's state IS the lit button beside it, and an open panel IS the
                          decision's state — either way a line here would say it twice. */}
                      {!info && !enteringOutcome && (
                        <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {handled ? (
                            stateLine(topic).text
                          ) : (
                            <span className="font-normal text-gray-500 dark:text-gray-400">{stateLine(topic).text}</span>
                          )}
                        </p>
                      )}
                    </div>
                    {/* A section that is only said needs no form to open: its one button stands right here. */}
                    {info ? (
                      <div className="sm:shrink-0">
                        <CouncilOutcomePanel
                          topic={topic}
                          onWrite={(next) =>
                            onChange((current) => applyOutcome(current, next, { at: new Date().toISOString(), trackChanges: false }))
                          }
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEnteringOutcome((value) => !value)}
                        className={`${buttonText} shrink-0 ${enteringOutcome ? '' : 'text-indigo-700 dark:text-indigo-300'}`}
                        aria-expanded={enteringOutcome}
                        data-testid={`council-topic-outcome-${topic.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                        {enteringOutcome ? t('council.topic.hideOutcome') : handled ? t('council.topic.editOutcome') : t('council.topic.enterOutcome')}
                      </button>
                    )}
                  </div>
                  {enteringOutcome && !info && (
                    <div className="mt-3 border-t border-indigo-200/80 pt-3 dark:border-indigo-900/50">
                      <CouncilOutcomePanel
                        topic={topic}
                        onWrite={(next) =>
                          onChange((current) => applyOutcome(current, next, { at: new Date().toISOString(), trackChanges: false }))
                        }
                      />
                    </div>
                  )}
                </div>
              )}

              {held && (
                <div className="mt-3 rounded-xl border border-indigo-200/80 bg-indigo-50/70 p-3 dark:border-indigo-900/50 dark:bg-indigo-950/30">
                  {editingOutcome && info ? (
                    <div className="space-y-2">
                      <CouncilOutcomePanel
                        topic={topic}
                        onWrite={(next) =>
                          onChange((current) => applyOutcome(current, next, { at: new Date().toISOString(), trackChanges: true }))
                        }
                      />
                      <button type="button" onClick={() => setEditingOutcome(false)} className={buttonQuiet}>
                        {t('council.topic.done')}
                      </button>
                    </div>
                  ) : editingOutcome ? (
                    <div className="space-y-2">
                      {topic.options.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {topic.options.map((option) => (
                            <Chip
                              key={option.id}
                              size="sm"
                              tone="indigo"
                              selected={draftOption === option.id}
                              onClick={() => setDraftOption(draftOption === option.id ? '' : option.id)}
                            >
                              {option.text}
                            </Chip>
                          ))}
                        </div>
                      )}
                      <input
                        value={draftDecision}
                        onChange={(event) => setDraftDecision(event.target.value)}
                        placeholder={t('council.topic.decisionPlaceholder')}
                        aria-label={t('council.topic.decision')}
                        className={inputClass}
                      />
                      <div className="flex flex-wrap gap-1.5">
                        <Chip size="sm" tone="neutral" selected={draftResolution === 'postponed'} onClick={() => setDraftResolution(draftResolution === 'postponed' ? undefined : 'postponed')}>
                          {t('council.topic.postponed')}
                        </Chip>
                        <Chip size="sm" tone="neutral" selected={draftResolution === 'dropped'} onClick={() => setDraftResolution(draftResolution === 'dropped' ? undefined : 'dropped')}>
                          {t('council.topic.dropped')}
                        </Chip>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={saveOutcome} className={buttonPrimary}>
                          {t('council.topic.saveOutcome')}
                        </button>
                        <button type="button" onClick={() => setEditingOutcome(false)} className={buttonQuiet}>
                          {t('council.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={labelClass}>{t('council.topic.atCouncil')}</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {outcomeLine(topic, outcome) || (
                            <span className="font-normal text-gray-500 dark:text-gray-400">{stateLine(topic).text}</span>
                          )}
                        </p>
                        {topic.changes && topic.changes.length > 0 && (
                          <ul className="mt-2 space-y-1 border-t border-indigo-100 pt-2 text-xs text-gray-600 dark:border-indigo-900/50 dark:text-gray-400">
                            {topic.changes.map((change, changeIndex) => (
                              <li key={`${change.at}-${changeIndex}`}>
                                <span className="font-semibold">{t('council.topic.changedOn', { date: formatDate(change.at) })}</span>
                                {' · '}
                                {t('council.topic.was')}: <span className="line-through">{change.from || '—'}</span>
                                {' → '}
                                {t('council.topic.became')}: <span className="font-semibold text-gray-800 dark:text-gray-200">{change.to || '—'}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <button type="button" onClick={startOutcomeEdit} className={buttonText}>
                          <Pencil className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                          {t('council.topic.editOutcome')}
                        </button>
                        {canCarry && topic.carriedToCouncilId ? (
                          <Link
                            href={`/care/council/${topic.carriedToCouncilId}`}
                            className={`${buttonText} text-indigo-700 dark:text-indigo-300`}
                          >
                            <ArrowRightToLine className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                            {t('council.topic.carriedTo', { title: carriedTo?.title ?? t('council.nextCouncilTitle') })}
                          </Link>
                        ) : canCarry ? (
                          <button
                            type="button"
                            // One council being prepared — it goes there; several — the person picks.
                            onClick={() => (carryTargets.length > 1 ? setChoosingTarget((value) => !value) : onCarryToNext())}
                            className={`${buttonText} text-indigo-700 dark:text-indigo-300`}
                            aria-expanded={carryTargets.length > 1 ? choosingTarget : undefined}
                            data-testid={`council-topic-carry-${topic.id}`}
                          >
                            <ArrowRightToLine className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                            {t('council.topic.toNextCouncil')}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )}
                  {choosingTarget && canCarry && !topic.carriedToCouncilId && (
                    <div className="mt-3 border-t border-indigo-200/80 pt-3 dark:border-indigo-900/50" data-testid="council-carry-chooser">
                      <p className={labelClass}>{t('council.topic.carryWhere')}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {carryTargets.map((target) => (
                          <Chip
                            key={target.id}
                            size="md"
                            tone="indigo"
                            onClick={() => {
                              setChoosingTarget(false);
                              onCarryToNext(target.id);
                            }}
                          >
                            {target.title}
                            {target.date ? ` · ${formatDateOnly(target.date)}` : ''}
                          </Chip>
                        ))}
                        <Chip
                          size="md"
                          tone="neutral"
                          onClick={() => {
                            setChoosingTarget(false);
                            onCarryToNext('new');
                          }}
                        >
                          {t('council.topic.carryNew')}
                        </Chip>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!held && (
                <div className="mt-3 flex justify-end">
                  <button type="button" onClick={onEdit} className={buttonText} data-testid={`council-topic-edit-${topic.id}`}>
                    <Pencil className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                    {t('council.topic.edit')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function TopicEditor({
  topic,
  onChange,
  onRemove,
  onDone,
}: {
  topic: CouncilTopic;
  onChange: (updater: TopicUpdater) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <input
        autoFocus
        value={topic.title}
        onChange={(event) => onChange((current) => ({ ...current, title: event.target.value }))}
        placeholder={t('council.detail.newTopicPlaceholder')}
        aria-label={t('council.detail.newTopicPlaceholder')}
        className={`${inputClass} text-base font-bold`}
      />

      {/*
        WHAT THE SECTION IS FOR — the pastor's decision, not the program's guess. A decision
        section carries options and a line of what was decided; a section that is only said
        carries neither, and at the council it is ticked as told.
      */}
      <div>
        <span className={labelClass}>{t('council.topic.kind')}</span>
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('council.topic.kind')}>
          <Chip
            size="md"
            tone="indigo"
            selected={!isInfoTopic(topic)}
            onClick={() =>
              onChange((current) => {
                const next = { ...current };
                delete next.kind;
                return next;
              })
            }
            data-testid="council-kind-decision"
          >
            {t('council.topic.kindDecision')}
          </Chip>
          <Chip
            size="md"
            tone="indigo"
            selected={isInfoTopic(topic)}
            icon={<Megaphone className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />}
            onClick={() => onChange((current) => ({ ...current, kind: 'info' }))}
            data-testid="council-kind-info"
          >
            {t('council.topic.kindInfo')}
          </Chip>
        </div>
        <p className={hintClass}>{t('council.topic.kindHint')}</p>
      </div>

      <div>
        <span className={labelClass}>{t('council.topic.summary')}</span>
        <p className={hintClass}>{t('council.topic.summaryHint')}</p>
        {/*
          The same editor the study notes use, so bold, lists and headings behave the way the
          pastor already knows — a section about a sound system holds a price list, not a line.
        */}
        <div className="mt-1.5">
          <RichMarkdownEditor
            value={topic.summary ?? ''}
            onChange={(markdown) => onChange((current) => ({ ...current, summary: markdown }))}
            placeholder={t('council.topic.summaryPlaceholder')}
            minHeight="120px"
          />
        </div>
      </div>

      <div>
        <span className={labelClass}>{t('council.topic.questions')}</span>
        <p className={hintClass}>{t('council.topic.questionsHint')}</p>
        <ul className="mt-1.5 space-y-2">
          {topic.questions.map((question) => (
            <li key={question.id} className="flex gap-2">
              <div className="flex-1 space-y-1">
                <input
                  value={question.question}
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      questions: current.questions.map((item) =>
                        item.id === question.id ? { ...item, question: event.target.value } : item
                      ),
                    }))
                  }
                  placeholder={t('council.topic.questionPlaceholder')}
                  className={`${inputClass} font-semibold`}
                />
                <input
                  value={question.answer ?? ''}
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      questions: current.questions.map((item) =>
                        item.id === question.id ? { ...item, answer: event.target.value } : item
                      ),
                    }))
                  }
                  placeholder={t('council.topic.answerPlaceholder')}
                  className={inputClass}
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  onChange((current) => ({
                    ...current,
                    questions: current.questions.filter((item) => item.id !== question.id),
                  }))
                }
                className={`${buttonText} self-start`}
                aria-label={t('council.topic.remove')}
              >
                <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => onChange((current) => ({ ...current, questions: [...current.questions, newQuestion()] }))}
          className={`${buttonText} mt-1.5`}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          {t('council.topic.addQuestion')}
        </button>
      </div>

      {!isInfoTopic(topic) && (
      <div>
        <span className={labelClass}>{t('council.topic.options')}</span>
        <p className={hintClass}>{t('council.topic.optionsHint')}</p>
        <ul className="mt-1.5 space-y-2">
          {topic.options.map((option) => (
            <li key={option.id} className="flex gap-2">
              <input
                value={option.text}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    options: current.options.map((item) =>
                      item.id === option.id ? { ...item, text: event.target.value } : item
                    ),
                  }))
                }
                placeholder={t('council.topic.optionPlaceholder')}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() =>
                  onChange((current) => ({ ...current, options: current.options.filter((item) => item.id !== option.id) }))
                }
                className={buttonText}
                aria-label={t('council.topic.remove')}
              >
                <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => onChange((current) => ({ ...current, options: [...current.options, newOption()] }))}
          className={`${buttonText} mt-1.5`}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          {t('council.topic.addOption')}
        </button>
      </div>
      )}

      <label className="flex items-start gap-2.5 text-sm text-gray-800 dark:text-gray-200">
        <input
          type="checkbox"
          checked={Boolean(topic.forAssembly)}
          onChange={(event) => onChange((current) => ({ ...current, forAssembly: event.target.checked }))}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        <span>
          <span className="block font-semibold">{t('council.topic.forAssembly')}</span>
          <span className={hintClass}>{t('council.topic.forAssemblyHint')}</span>
        </span>
      </label>

      <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
        <button type="button" onClick={onRemove} className={`${buttonText} text-red-600 hover:text-red-700 dark:text-red-400`}>
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          {t('council.topic.delete')}
        </button>
        <button type="button" onClick={onDone} className={buttonPrimary} data-testid="council-topic-done">
          <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          {t('council.topic.done')}
        </button>
      </div>
    </div>
  );
}

/**
 * A SECTION WHILE ARRANGING: title, a grip, two arrows. The grip is 44px and `touch-none`, the
 * lesson the orders of service paid for on an iPad — a smaller handle, or one the browser is
 * allowed to scroll with, drops the drag after twenty pixels.
 */
function SortableTopicRow({
  topic,
  index,
  total,
  onMove,
}: {
  topic: CouncilTopic;
  index: number;
  total: number;
  onMove: (topicId: string, toIndex: number) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: topic.id,
  });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : undefined }}>
      <TopicRowView topic={topic} index={index} total={total} onMove={onMove} handleProps={{ ...attributes, ...listeners, ref: setActivatorNodeRef }} />
    </li>
  );
}

function TopicRowView({
  topic,
  index,
  total,
  onMove,
  handleProps,
  overlay = false,
}: {
  topic: CouncilTopic;
  index: number;
  total: number;
  onMove: (topicId: string, toIndex: number) => void;
  handleProps?: Record<string, unknown>;
  overlay?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex items-center gap-2 rounded-2xl border bg-white px-2 py-2 dark:bg-gray-900 ${
        overlay ? 'border-indigo-400 shadow-lg' : 'border-gray-200 shadow-sm dark:border-gray-800'
      }`}
    >
      <button
        type="button"
        aria-label={`${t('council.detail.reorder')}: ${topic.title}`}
        className="flex h-11 w-11 shrink-0 touch-none select-none cursor-grab items-center justify-center rounded-lg text-gray-500 active:cursor-grabbing dark:text-gray-400"
        {...(handleProps ?? {})}
      >
        <GripVertical className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>
      <span className={`w-5 shrink-0 text-sm font-extrabold ${tone.count}`}>{index + 1}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-900 dark:text-gray-100">{topic.title}</span>
      <ReorderArrows
        canMoveUp={index > 0}
        canMoveDown={index < total - 1}
        onMoveUp={() => onMove(topic.id, index - 1)}
        onMoveDown={() => onMove(topic.id, index + 1)}
        upLabel={t('council.detail.moveUp')}
        downLabel={t('council.detail.moveDown')}
      />
    </div>
  );
}
