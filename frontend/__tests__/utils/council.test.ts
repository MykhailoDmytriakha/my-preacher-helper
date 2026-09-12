import {
  applyOutcome,
  copyTopicForNext,
  councilProgress,
  daysUntil,
  firstOpenTopicIndex,
  holdCouncil,
  mergeUnsentCouncils,
  nextPreparingCouncil,
  removeTopicOption,
  setTopicKind,
  outcomeText,
  reorderTopics,
  reopenCouncil,
  seedCouncils,
  sortCouncils,
  splitForList,
  topicState,
} from '@/utils/council';

import type { CouncilTopic } from '@/models/models';

const topic = (overrides: Partial<CouncilTopic> = {}): CouncilTopic => ({
  id: 't1',
  title: 'Крыша',
  questions: [],
  options: [
    { id: 'o1', text: 'Иванов' },
    { id: 'o2', text: 'Петренко' },
  ],
  ...overrides,
});

describe('council logic', () => {
  it('seeds one council being prepared and two held ones for the first opening', () => {
    const councils = seedCouncils('u1', new Date('2026-09-11T00:00:00Z'));
    expect(councils.map((council) => council.status)).toEqual(['preparing', 'held', 'held']);
    expect(councils[0].topics.length).toBeGreaterThanOrEqual(4);
    // Every held example already carries an outcome a person can read.
    const held = councils.filter((council) => council.status === 'held');
    held.forEach((council) => {
      expect(council.heldAt).toBeTruthy();
      expect(council.topics.some((item) => outcomeText(item))).toBe(true);
    });
    // The recorded change ends where the current decision stands, or the history would lie.
    const roof = councils[1].topics[0];
    expect(roof.changes?.[0].to).toBe(outcomeText(roof));
  });

  it('reads the outcome as the accepted option, the typed decision, or both', () => {
    expect(outcomeText(topic())).toBe('');
    expect(outcomeText(topic({ acceptedOptionId: 'o1' }))).toBe('Иванов');
    expect(outcomeText(topic({ decision: 'аванс 30%' }))).toBe('аванс 30%');
    expect(outcomeText(topic({ acceptedOptionId: 'o2', decision: 'аванс 30%' }))).toBe('Петренко — аванс 30%');
  });

  it('derives the tick from the content instead of taking it by hand', () => {
    const picked = applyOutcome(topic(), { acceptedOptionId: 'o1' }, { at: 'T', trackChanges: false });
    expect(picked.discussed).toBe(true);
    const unpicked = applyOutcome(picked, { acceptedOptionId: '' }, { at: 'T', trackChanges: false });
    expect(unpicked.discussed).toBeUndefined();
    const typed = applyOutcome(unpicked, { decision: 'аванс 30%' }, { at: 'T', trackChanges: false });
    expect(typed.discussed).toBe(true);
    const erased = applyOutcome(typed, { decision: '' }, { at: 'T', trackChanges: false });
    expect(erased.discussed).toBeUndefined();
  });

  it('lets the council put a section off or take it off the agenda, and a later decision supersedes that', () => {
    const postponed = applyOutcome(topic({ acceptedOptionId: 'o1' }), { resolution: 'postponed' }, { at: 'T', trackChanges: false });
    expect(postponed.resolution).toBe('postponed');
    expect(postponed.acceptedOptionId).toBeUndefined();
    expect(postponed.discussed).toBeUndefined();
    expect(topicState(postponed)).toBe('postponed');
    expect(councilProgress({ ...seedCouncils('u1')[0], topics: [postponed, topic()] })).toEqual({ done: 1, total: 2 });

    const decidedLater = applyOutcome(postponed, { decision: 'решили всё же' }, { at: 'T', trackChanges: false });
    expect(decidedLater.resolution).toBeUndefined();
    expect(topicState(decidedLater)).toBe('decided');

    const cleared = applyOutcome(postponed, { resolution: null }, { at: 'T', trackChanges: false });
    expect(topicState(cleared)).toBe('open');
  });

  it('treats a section that is only said as told or not, never as decided', () => {
    const info = topic({ kind: 'info', options: [] });
    expect(topicState(info)).toBe('open');
    const told = applyOutcome(info, { told: true }, { at: 'T', trackChanges: false });
    expect(topicState(told)).toBe('told');
    expect(councilProgress({ ...seedCouncils('u1')[0], topics: [told] })).toEqual({ done: 1, total: 1 });
    // Decision content is meaningless on it and is not kept.
    const ignored = applyOutcome(told, { decision: 'x' }, { at: 'T', trackChanges: false });
    expect(ignored.decision).toBeUndefined();
    expect(topicState(ignored)).toBe('told');
    const untold = applyOutcome(told, { told: false }, { at: 'T', trackChanges: false });
    expect(topicState(untold)).toBe('open');
    const carried = copyTopicForNext(told);
    expect(carried.kind).toBe('info');
    expect(carried.discussed).toBeUndefined();
  });

  it('writes the outcome silently while conducting and keeps history once the council is held', () => {
    const conducting = applyOutcome(topic(), { acceptedOptionId: 'o1' }, { at: 'T1', trackChanges: false });
    expect(conducting.acceptedOptionId).toBe('o1');
    expect(conducting.discussed).toBe(true);
    expect(conducting.changes).toBeUndefined();

    const edited = applyOutcome(conducting, { decision: 'аванс 30%' }, { at: 'T2', trackChanges: true });
    expect(edited.changes).toEqual([{ at: 'T2', from: 'Иванов', to: 'Иванов — аванс 30%' }]);

    // Saving the same words again is not a change.
    const same = applyOutcome(edited, { decision: 'аванс 30%' }, { at: 'T3', trackChanges: true });
    expect(same.changes).toHaveLength(1);
  });

  it('clears an emptied decision instead of keeping a blank line', () => {
    const next = applyOutcome(topic({ decision: 'старое' }), { decision: '   ' }, { at: 'T', trackChanges: false });
    expect(next.decision).toBeUndefined();
  });

  it('holds a council with the moment it ended, counts handled sections, and can reopen it', () => {
    const [prepared] = seedCouncils('u1');
    const held = holdCouncil(prepared, '2026-09-18T20:00:00.000Z');
    expect(held.status).toBe('held');
    expect(held.heldAt).toBe('2026-09-18T20:00:00.000Z');
    expect(councilProgress(prepared)).toEqual({ done: 0, total: prepared.topics.length });
    const reopened = reopenCouncil(held, 'T');
    expect(reopened.status).toBe('preparing');
    expect(reopened.heldAt).toBeUndefined();
  });

  it('resumes conducting at the first section still open', () => {
    const [prepared] = seedCouncils('u1');
    expect(firstOpenTopicIndex(prepared)).toBe(0);
    const topics = prepared.topics.map((item, index) =>
      index < 2 ? applyOutcome(item, { decision: 'да' }, { at: 'T', trackChanges: false }) : item
    );
    expect(firstOpenTopicIndex({ ...prepared, topics })).toBe(2);
    const all = topics.map((item) => applyOutcome(item, { resolution: 'dropped' }, { at: 'T', trackChanges: false }));
    expect(firstOpenTopicIndex({ ...prepared, topics: all })).toBe(0);
  });

  it('moves a section to where it was dropped and ignores impossible moves', () => {
    const [prepared] = seedCouncils('u1');
    const titles = (council: typeof prepared) => council.topics.map((item) => item.title);
    const moved = reorderTopics(prepared, 4, 0);
    expect(titles(moved)[0]).toBe('Заявление сестры Надежды о членстве');
    expect(titles(moved)[1]).toBe(titles(prepared)[0]);
    expect(reorderTopics(prepared, 1, 1)).toBe(prepared);
    expect(reorderTopics(prepared, 9, 0)).toBe(prepared);
  });

  it('sorts earlier councils above later ones, and an undated one last', () => {
    const councils = seedCouncils('u1');
    const undated = { ...councils[0], id: 'x', title: 'Без даты', date: undefined };
    const sorted = sortCouncils([undated, councils[0], councils[2], councils[1]]);
    expect(sorted.map((council) => council.title)).toEqual(['Совет 3 июля', 'Совет 14 августа', 'Совет 18 сентября', 'Без даты']);
  });

  it('counts whole days to a planned date from the local calendar day', () => {
    const now = new Date(2026, 8, 11, 23, 30); // late evening, so a UTC shift would be off by one
    expect(daysUntil('2026-09-11', now)).toBe(0);
    expect(daysUntil('2026-09-18', now)).toBe(7);
    expect(daysUntil('2026-09-10', now)).toBe(-1);
  });

  it('carries a section to the next council without its outcome and with fresh ids', () => {
    const copy = copyTopicForNext(topic({ acceptedOptionId: 'o1', decision: 'решено', discussed: true, forAssembly: true }));
    expect(copy.id).not.toBe('t1');
    expect(copy.options.map((option) => option.text)).toEqual(['Иванов', 'Петренко']);
    expect(copy.options[0].id).not.toBe('o1');
    expect(copy.acceptedOptionId).toBeUndefined();
    expect(copy.decision).toBeUndefined();
    expect(copy.discussed).toBeUndefined();
    expect(copy.forAssembly).toBe(true);
  });

  it('lists what is ahead nearest-first and what has passed most-recent-first', () => {
    const councils = seedCouncils('u1');
    const later = { ...councils[0], id: 'later', title: 'Совет в октябре', date: '2026-10-09' };
    const { preparing, past } = splitForList([later, ...councils]);
    expect(preparing.map((council) => council.title)).toEqual(['Совет 18 сентября', 'Совет в октябре']);
    expect(past.map((council) => council.title)).toEqual(['Совет 14 августа', 'Совет 3 июля']);
  });

  it('lands a carried section in the nearest council being prepared, and in none when all are held', () => {
    const councils = seedCouncils('u1');
    const later = { ...councils[0], id: 'later', title: 'Совет в октябре', date: '2026-10-09' };
    expect(nextPreparingCouncil([later, ...councils])?.title).toBe('Совет 18 сентября');
    expect(nextPreparingCouncil(councils.filter((council) => council.status === 'held'))).toBeUndefined();
  });
});

describe('a background read never erases what is still being typed', () => {
  const council = (over: Partial<import('@/models/models').Council> = {}) =>
    ({ id: 'c1', userId: 'u1', title: 'Совет', status: 'preparing', topics: [], createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', rev: 1, ...over }) as import('@/models/models').Council;

  it('keeps the browser copy of a council whose write has not been confirmed', () => {
    const typed = council({ title: 'Совет с только что набранным вопросом', updatedAt: '2026-09-01T10:00:05.000Z' });
    const merged = mergeUnsentCouncils([council()], [typed], (id) => id === 'c1');
    expect(merged).toEqual([typed]);
  });

  it('trusts the queue and not the clock: a settled local copy never shadows the server', () => {
    // Two devices mean two clocks. A phone running fast would otherwise hide every answer the
    // server gives behind its own older copy.
    const localWithFutureClock = council({ title: 'Часы спешат', updatedAt: '2099-01-01T00:00:00.000Z' });
    const fromServer = council({ title: 'С сервера', rev: 9 });
    expect(mergeUnsentCouncils([fromServer], [localWithFutureClock], () => false)).toEqual([fromServer]);
  });

  it('takes the server copy for everything settled, so another device is seen', () => {
    const fromServer = council({ title: 'С другого устройства', updatedAt: '2026-09-02T10:00:00.000Z', rev: 4 });
    expect(mergeUnsentCouncils([fromServer], [council()], () => false)).toEqual([fromServer]);
  });

  it('never lets a read that set out earlier undo a save the server already confirmed', () => {
    // The read carries rev 1; the write that landed while it travelled took the council to rev 2.
    const stale = council({ title: 'Каким было до сохранения', rev: 1 });
    const mine = council({ title: 'Сохранённое', rev: 2 });
    expect(mergeUnsentCouncils([stale], [mine], () => false, { confirmedRev: () => 2, confirmedAfterTheReadBegan: () => false })).toEqual([mine]);
    // A genuinely newer answer from another device is taken as it is.
    const newer = council({ title: 'С другого устройства', rev: 5 });
    expect(mergeUnsentCouncils([newer], [mine], () => false, { confirmedRev: () => 2, confirmedAfterTheReadBegan: () => false })).toEqual([newer]);
  });

  it('keeps a council created while the read was travelling, which could not be in that answer', () => {
    const justCreated = council({ id: 'c3', title: 'Создан, пока чтение шло' });
    const settled = () => false;
    expect(
      mergeUnsentCouncils([], [justCreated], settled, { confirmedRev: () => 0, confirmedAfterTheReadBegan: () => true })
    ).toEqual([justCreated]);
    // Confirmed long ago and absent now means deleted somewhere else: it goes.
    expect(
      mergeUnsentCouncils([], [justCreated], settled, { confirmedRev: () => 0, confirmedAfterTheReadBegan: () => false })
    ).toEqual([]);
  });

  it('holds back a council the server did not return only while it is unsettled', () => {
    const justCreated = council({ id: 'c2' });
    expect(mergeUnsentCouncils([], [justCreated], (id) => id === 'c2')).toEqual([justCreated]);
    // Settled and absent from the answer means deleted elsewhere: it does not come back.
    expect(mergeUnsentCouncils([], [justCreated], () => false)).toEqual([]);
  });
});

describe('changing what a section is clears an outcome that no longer applies', () => {
  it('drops the mark when an announcement becomes a decision', () => {
    const said = topic({ kind: 'info', discussed: true, options: [], questions: [] });
    const asDecision = setTopicKind(said, 'decision');
    expect(asDecision.discussed).toBeUndefined();
    expect(topicState(asDecision)).toBe('open');
  });

  it('drops the accepted option when that option is deleted', () => {
    const decided = topic({ acceptedOptionId: 'o1', discussed: true, decision: '' });
    const without = removeTopicOption(decided, 'o1');
    expect(without.acceptedOptionId).toBeUndefined();
    expect(topicState(without)).toBe('open');
    expect(without.options.some((option) => option.id === 'o1')).toBe(false);
  });

  it('keeps a written decision when a different option is deleted', () => {
    const decided = topic({ acceptedOptionId: 'o1', discussed: true, decision: 'Подрядчик Иванов' });
    const without = removeTopicOption(decided, 'o2');
    expect(without.acceptedOptionId).toBe('o1');
    expect(topicState(without)).toBe('decided');
  });
});
