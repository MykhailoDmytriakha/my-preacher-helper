import { newClientId } from '@/utils/clientId';

import type {
  Council,
  CouncilTopic,
  CouncilTopicOption,
  CouncilTopicQuestion,
} from '@/models/models';

/**
 * Pure council logic — everything that does not touch storage or React, so it can be tested
 * in a millisecond and reused by whichever storage layer the section ends up on.
 */

export const newTopic = (title = ''): CouncilTopic => ({
  id: newClientId(),
  title,
  questions: [],
  options: [],
});

export const newQuestion = (question = ''): CouncilTopicQuestion => ({ id: newClientId(), question });

export const newOption = (text = ''): CouncilTopicOption => ({ id: newClientId(), text });

export interface TopicOutcome {
  acceptedOptionId?: string;
  decision?: string;
  /** `null` clears a resolution; a value sets it and, with it, drops any decision content. */
  resolution?: CouncilTopic['resolution'] | null;
  /** For a section that is only said: whether it was. Ignored on a decision section. */
  told?: boolean;
}

export type TopicState = 'decided' | 'told' | 'postponed' | 'dropped' | 'open';

export const isInfoTopic = (topic: CouncilTopic): boolean => topic.kind === 'info';

/** Whether the council is done with this section, one way or another. */
export const isTopicHandled = (topic: CouncilTopic): boolean => Boolean(topic.discussed || topic.resolution);

export function topicState(topic: CouncilTopic): TopicState {
  if (topic.resolution) return topic.resolution;
  if (!topic.discussed) return 'open';
  return isInfoTopic(topic) ? 'told' : 'decided';
}

/** The line a person reads as "what was decided": the accepted option, the typed decision, or both. */
export function outcomeText(topic: CouncilTopic): string {
  const accepted = topic.options.find((option) => option.id === topic.acceptedOptionId)?.text;
  const decision = topic.decision?.trim();
  if (accepted && decision) return `${accepted} — ${decision}`;
  return accepted ?? decision ?? '';
}

/**
 * Apply an outcome to a section. While the council is being CONDUCTED the outcome is simply
 * written; once the council is HELD every change to what was decided is kept as a dated
 * "was → became" entry, because the owner asked to see what changed and when.
 */
export function applyOutcome(
  topic: CouncilTopic,
  outcome: TopicOutcome,
  options: { at: string; trackChanges: boolean }
): CouncilTopic {
  const next: CouncilTopic = {
    ...topic,
    ...(outcome.acceptedOptionId !== undefined ? { acceptedOptionId: outcome.acceptedOptionId } : {}),
    ...(outcome.decision !== undefined ? { decision: outcome.decision } : {}),
  };
  if (!next.acceptedOptionId) delete next.acceptedOptionId;
  if (!next.decision?.trim()) delete next.decision;

  if (outcome.resolution === null) {
    delete next.resolution;
  } else if (outcome.resolution) {
    // "We put it off" and "we decided X" cannot both be true of one section.
    next.resolution = outcome.resolution;
    delete next.acceptedOptionId;
    delete next.decision;
    if (isInfoTopic(next)) delete next.discussed;
  } else if (next.acceptedOptionId || next.decision) {
    // A decision written after a postponement supersedes it.
    delete next.resolution;
  }

  if (isInfoTopic(next)) {
    // A section that is only said has nothing to derive the tick from: it is told, or not.
    if (outcome.told !== undefined) {
      next.discussed = outcome.told;
      if (outcome.told) delete next.resolution;
    }
    delete next.acceptedOptionId;
    delete next.decision;
  } else {
    // The tick follows the content — never the other way round.
    next.discussed = Boolean(next.acceptedOptionId || next.decision);
  }
  if (!next.discussed) delete next.discussed;

  if (!options.trackChanges) return next;

  // What the record reads for a section: its decision, or what happened instead — including
  // "told" for a section that is only said, so a later change of that is history too.
  const label = (item: CouncilTopic) =>
    outcomeText(item) || item.resolution || (isInfoTopic(item) && item.discussed ? 'told' : '');
  const before = label(topic);
  const after = label(next);
  if (before === after) return next;
  return { ...next, changes: [...(topic.changes ?? []), { at: options.at, from: before, to: after }] };
}

export function holdCouncil(council: Council, at: string): Council {
  return { ...council, status: 'held', heldAt: at, updatedAt: at };
}

export function councilProgress(council: Council): { done: number; total: number } {
  return {
    done: council.topics.filter(isTopicHandled).length,
    total: council.topics.length,
  };
}

/** Where conducting resumes: the first section not yet handled, or the top when all are. */
export function firstOpenTopicIndex(council: Council): number {
  const index = council.topics.findIndex((topic) => !isTopicHandled(topic));
  return index < 0 ? 0 : index;
}

export const hasProgress = (council: Council): boolean => council.topics.some(isTopicHandled);

/** The sections in a new order — the moved one lands where the eye dropped it. */
export function reorderTopics(council: Council, fromIndex: number, toIndex: number): Council {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= council.topics.length || toIndex >= council.topics.length) {
    return council;
  }
  const topics = [...council.topics];
  const [moved] = topics.splice(fromIndex, 1);
  topics.splice(toIndex, 0, moved);
  return { ...council, topics };
}

/** Reopen a held council: back to preparing, outcomes kept, the held moment forgotten. */
export function reopenCouncil(council: Council, at: string): Council {
  const next: Council = { ...council, status: 'preparing', updatedAt: at };
  delete next.heldAt;
  return next;
}

/**
 * Chronological, earliest first. A council with no date yet has no place in time, so it waits
 * at the bottom. The list page reads this two ways — see `splitForList`.
 */
export function sortCouncils(councils: Council[]): Council[] {
  const stamp = (council: Council) =>
    council.heldAt ?? (council.date ? `${council.date}T00:00:00.000Z` : `9999-12-31T00:00:00.000Z${council.createdAt}`);
  return [...councils].sort((a, b) => (stamp(a) < stamp(b) ? -1 : stamp(a) > stamp(b) ? 1 : 0));
}

/**
 * EXAMPLES FOR THE FIRST OPENING — realistic matters of a Slavic Baptist church, none of them
 * about anyone's private life. The owner asked to see the section already filled ("хочу
 * увидеть замоканные данные, какие уже есть") so he can try it before shaping it; a person
 * deletes them in two taps once his own councils are in.
 */
export function seedCouncils(userId: string, now = new Date()): Council[] {
  const iso = (date: string) => new Date(date).toISOString();
  const q = (question: string, answer?: string): CouncilTopicQuestion => ({ id: newClientId(), question, answer });
  const o = (text: string): CouncilTopicOption => ({ id: newClientId(), text });

  const baptismOptions = [o('Крестить 27 сентября, на Жатву'), o('Крестить в октябре отдельным служением'), o('Отложить до весны')];
  const harvestOptions = [o('Ведёт брат Сергей, проповедую я'), o('Ведёт брат Сергей, проповедует гость')];
  const hallOptions = [o('Дать большой зал с 18:00'), o('Дать малый зал'), o('Отказать до окончания ремонта')];
  const porchOptions = [o('Утвердить смету'), o('Запросить вторую смету')];
  const membershipOptions = [o('Рекомендовать собранию принять'), o('Отложить до повторной беседы')];

  const roofOptions = [o('Подрядчик Иванов'), o('Подрядчик Петренко')];
  const choirOptions = [o('Четверг, 19:00'), o('Суббота, 17:00')];
  const campOptions = [o('Провести лагерь в июле'), o('Провести лагерь в августе')];

  const createdAt = iso('2026-09-01T10:00:00Z');
  const updatedAt = now.toISOString();

  return [
    {
      id: newClientId(),
      userId,
      title: 'Совет 18 сентября',
      date: '2026-09-18',
      status: 'preparing',
      createdAt,
      updatedAt,
      topics: [
        {
          id: newClientId(),
          title: 'Крещение: Андрей и Оксана',
          summary: 'Оба прошли беседы, свидетельства ясные. Предлагаю крестить на Жатву — семья и гости будут в церкви.',
          questions: [
            q('Достаточно ли времени прошло с обращения Андрея?', 'Полгода. Беседы с мая, в собрании каждое воскресенье.'),
            q('Кто будет наставником после крещения?', 'Брат Павел согласился.'),
          ],
          options: baptismOptions,
        },
        {
          id: newClientId(),
          title: 'Праздник Жатвы 27 сентября',
          summary: 'Кто ведёт служение, кто проповедует, обед после служения.',
          questions: [
            q('Кто отвечает за обед?', 'Сёстры предлагают Ольгу, она согласна.'),
            q('Будут ли гости из соседней церкви?', 'Пригласили, ответа пока нет.'),
          ],
          options: harvestOptions,
        },
        {
          id: newClientId(),
          title: 'Молодёжное служение просит зал по субботам',
          summary: 'Хотят собираться каждую субботу вечером. Нужно решить, какой зал и с какого времени.',
          questions: [q('Не пересекается ли с хором?', 'Хор репетирует в четверг, суббота свободна.')],
          options: hallOptions,
        },
        {
          id: newClientId(),
          title: 'Ремонт крыльца — смета от брата Павла',
          summary:
            'Смета брата Павла, сделать до осенних дождей:\n\n- доски и брус — **600**\n- крепёж и пропитка — **200**\n- работа — **400**\n\n**Итого 1 200.** Вторую смету не брали: Павел делал крыльцо у соседней церкви.',
          questions: [q('Есть ли средства в фонде здания?', 'Есть, на смету хватает.')],
          options: porchOptions,
        },
        {
          id: newClientId(),
          title: 'Заявление сестры Надежды о членстве',
          summary: 'Переехала к нам, письмо от её церкви получено, беседа с пресвитером прошла.',
          questions: [q('Нужна ли ещё одна беседа?', 'Достаточно письма и беседы с пресвитером.')],
          options: membershipOptions,
          forAssembly: true,
        },
      ],
    },
    {
      id: newClientId(),
      userId,
      title: 'Совет 14 августа',
      date: '2026-08-14',
      status: 'held',
      heldAt: iso('2026-08-14T20:30:00Z'),
      createdAt: iso('2026-08-01T10:00:00Z'),
      updatedAt: iso('2026-08-20T09:00:00Z'),
      topics: [
        {
          id: newClientId(),
          title: 'Крыша: выбор подрядчика',
          summary: 'Две сметы, обе в пределах фонда. Иванов делал крышу соседней церкви.',
          questions: [q('Есть ли гарантия?', 'У Иванова — три года, у Петренко — год.')],
          options: roofOptions,
          discussed: true,
          acceptedOptionId: roofOptions[0].id,
          decision: 'Начать в сентябре, аванс 30%, окончание до 15 октября',
          changes: [
            {
              at: iso('2026-08-20T09:00:00Z'),
              from: 'Подрядчик Иванов — Начать в сентябре, аванс 30%',
              to: 'Подрядчик Иванов — Начать в сентябре, аванс 30%, окончание до 15 октября',
            },
          ],
        },
        {
          id: newClientId(),
          title: 'Летний лагерь — отчёт',
          summary: 'Лагерь прошёл, нужен отчёт к членскому собранию.',
          questions: [],
          options: [],
          discussed: true,
          decision: 'Отчёт готовит брат Сергей к собранию',
        },
        {
          id: newClientId(),
          title: 'Бюджет на осень',
          summary: 'Предложение по расходам на отопление и ремонт.',
          questions: [q('Хватит ли на отопление?', 'По прошлому году — да, с запасом.')],
          options: [],
          forAssembly: true,
          discussed: true,
          decision: 'Вынести на членское собрание',
        },
        {
          id: newClientId(),
          title: 'Хор — день репетиций',
          questions: [],
          options: choirOptions,
          discussed: true,
          acceptedOptionId: choirOptions[0].id,
        },
      ],
    },
    {
      id: newClientId(),
      userId,
      title: 'Совет 3 июля',
      date: '2026-07-03',
      status: 'held',
      heldAt: iso('2026-07-03T20:10:00Z'),
      createdAt: iso('2026-06-20T10:00:00Z'),
      updatedAt: iso('2026-07-03T20:10:00Z'),
      topics: [
        {
          id: newClientId(),
          title: 'Летний лагерь — сроки',
          summary: 'Две недели на выбор, зависит от базы.',
          questions: [],
          options: campOptions,
          discussed: true,
          acceptedOptionId: campOptions[0].id,
        },
        {
          id: newClientId(),
          title: 'Посещение семьи Ковальчук',
          summary: 'Год со дня утраты — посетить всем советом.',
          questions: [],
          options: [],
          discussed: true,
          decision: 'Посетить 29 сентября после служения',
        },
        {
          id: newClientId(),
          title: 'Библиотека: новые книги',
          questions: [],
          options: [],
          discussed: false,
        },
      ],
    },
  ];
}

/** Whole days from today's calendar date to the planned one; negative when it has passed. */
export function daysUntil(date: string, now = new Date()): number {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/**
 * A section carried to the next council: the same matter, questions and options with fresh
 * ids and no outcome — what was not talked through is talked through next time.
 */
export function copyTopicForNext(topic: CouncilTopic): CouncilTopic {
  return {
    id: newClientId(),
    ...(topic.kind ? { kind: topic.kind } : {}),
    title: topic.title,
    ...(topic.summary ? { summary: topic.summary } : {}),
    questions: topic.questions.map((question) => ({ ...question, id: newClientId() })),
    options: topic.options.map((option) => ({ ...option, id: newClientId() })),
    ...(topic.forAssembly ? { forAssembly: true } : {}),
  };
}

/**
 * THE TWO GROUPS OF THE LIST, EACH IN THE ORDER PEOPLE EXPECT OF ITS KIND. What is ahead reads
 * like a calendar — the nearest council first; what has passed reads like a history — the most
 * recent first, the way mail, a feed and a log all do. The owner corrected the second half
 * after seeing July above August: "те, которые прошли недавно, должны быть вверху".
 */
export function splitForList(councils: Council[]): { preparing: Council[]; past: Council[] } {
  const sorted = sortCouncils(councils);
  return {
    preparing: sorted.filter((council) => council.status === 'preparing'),
    past: sorted.filter((council) => council.status === 'held').reverse(),
  };
}

/** The councils a carried section may land in, nearest first. */
export function preparingCouncils(councils: Council[]): Council[] {
  return sortCouncils(councils.filter((council) => council.status === 'preparing'));
}

/** The council a carried section lands in when nobody chose: the one being prepared with the nearest date. */
export function nextPreparingCouncil(councils: Council[]): Council | undefined {
  return preparingCouncils(councils)[0];
}
