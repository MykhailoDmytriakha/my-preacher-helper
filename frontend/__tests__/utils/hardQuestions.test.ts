import {
  buildLibrary, cleanList, cleanText, groupNamed, standsOnScripture, isWaiting, moveInList, movePlan, placeOf, plainLine, rankForNewQuestion, typedPlaces,
  readQuestion, readTheme, searchLibrary, UNGROUPED_KEY, type MoveTarget,
} from '@/utils/hardQuestions';

import { documentScreenHref, isOnDocumentScreen } from '@/utils/documentScreenHref';

import type { HardQuestion, HardQuestionTheme } from '@/models/models';

const theme = (id: string, rank: number, extra: Partial<HardQuestionTheme> = {}): HardQuestionTheme => ({
  id, userId: 'u', title: `Тема ${id}`, rank, groups: [], bases: [], createdAt: '2026-11-01', updatedAt: '2026-11-01', ...extra,
});
const question = (id: string, extra: Partial<HardQuestion> = {}): HardQuestion => ({
  id, userId: 'u', title: `Вопрос ${id}`, rank: 1000, short: 'Ответ.', createdAt: '2026-11-01', updatedAt: '2026-11-01', ...extra,
});

const clothes = theme('clothes', 1000, {
  title: 'Одежда',
  groups: [{ id: 'g-length', title: 'Длина' }, { id: 'g-church', title: 'В церкви' }],
  bases: [{ id: 'b-modesty', title: 'Мерило — стыдливость', scriptureRefs: ['1 Тим 2:9–10'] }, { id: 'b-culture', title: 'Культура меняется' }],
});
const suffering = theme('suffering', 500, { title: 'Страдание' });

describe('reading documents', () => {
  it('keeps only readable groups and bases and never invents a field', () => {
    const read = readTheme({ title: 'T', rank: 5, groups: [{ id: 'g', title: 'G' }, { title: 'no id' }, null], bases: [{ id: 'b', title: 'B', label: '' }] }, 't');
    expect(read.groups).toEqual([{ id: 'g', title: 'G' }]);
    expect(read.bases).toEqual([{ id: 'b', title: 'B' }]);
    expect(read).not.toHaveProperty('intro');
  });

  it('reads a broken rank as no rank, so it sorts after every ranked one', () => {
    expect(Number.isNaN(readQuestion({ title: 'Q', rank: 'x' }, 'q').rank)).toBe(true);
    expect(readQuestion({ title: 'Q', rank: 7, alternates: ['a', 3], themeId: '' }, 'q')).toMatchObject({ rank: 7, alternates: ['a'] });
    expect(readQuestion({ title: 'Q', themeId: '' }, 'q')).not.toHaveProperty('themeId');
  });
});

describe('what the section shows', () => {
  it('waits for an answer only while neither a short answer nor a detail is written', () => {
    expect(isWaiting({ short: '  ', detail: undefined })).toBe(true);
    expect(isWaiting({ short: undefined, detail: 'Подробно.' })).toBe(false);
    expect(isWaiting({ short: 'Да.' })).toBe(false);
  });

  it('calls a basis by its title: a short label an older document holds is not read (removed 2026-11-26)', () => {
    const read = readTheme({ title: 'Одежда', bases: [{ id: 'b', title: 'Мерило — стыдливость', label: 'стыдливость', scriptureRefs: ['1 Тим 2:9'] }] }, 'clothes');
    expect(read.bases).toEqual([{ id: 'b', title: 'Мерило — стыдливость', scriptureRefs: ['1 Тим 2:9'] }]);
  });

  it('cleans text and lists as kept: trimmed, nothing for nothing, a repeat once', () => {
    expect(cleanText('  ')).toBeUndefined();
    expect(cleanText(' Да. ')).toBe('Да.');
    expect(cleanList([' Можно ли брюки? ', '', 'можно  ли брюки?', 'Можно ли шорты?'])).toEqual(['Можно ли брюки?', 'Можно ли шорты?']);
  });
});

describe('buildLibrary', () => {
  const questions = [
    question('q2', { themeId: 'clothes', groupId: 'g-length', rank: 2000, basisIds: ['b-modesty', 'gone'] }),
    question('q1', { themeId: 'clothes', groupId: 'g-length', rank: 1000 }),
    question('q3', { themeId: 'clothes', groupId: 'deleted-group', rank: 1000, short: undefined }),
    question('q4', { themeId: 'deleted-theme', rank: 1000 }),
    question('q5', { rank: 2000, short: '', createdAt: '2026-11-20' }),
    question('q6', { themeId: 'suffering', rank: 1000 }),
  ];
  const library = buildLibrary([clothes, suffering], questions);

  it('orders the themes by rank and the questions of a group by rank', () => {
    expect(library.themes.map((view) => view.theme.id)).toEqual(['suffering', 'clothes']);
    const view = library.themeById.get('clothes')!;
    expect(view.buckets.map((bucket) => bucket.key)).toEqual(['g-length', 'g-church', UNGROUPED_KEY]);
    expect(view.buckets[0].questions.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(view.buckets[1].questions).toEqual([]);
  });

  it('never hides a question whose theme or group is gone: it stands without a theme or without a group', () => {
    expect(library.withoutTheme.map((q) => q.id)).toEqual(['q4', 'q5']);
    expect(library.themeById.get('clothes')!.buckets[2].questions.map((q) => q.id)).toEqual(['q3']);
    expect(library.total).toBe(6);
  });

  it('shows a theme without groups as one list, even an empty one', () => {
    const empty = buildLibrary([theme('t', 1000)], []);
    expect(empty.themes[0].buckets).toEqual([{ key: UNGROUPED_KEY, group: null, questions: [] }]);
  });

  it('lists the questions waiting for an answer, the newest first, and counts them per theme', () => {
    expect(library.waiting.map((q) => q.id)).toEqual(['q5', 'q3']);
    expect(library.themeById.get('clothes')!.waiting).toBe(1);
  });

  it('knows which questions rest on each basis and skips a basis that is gone', () => {
    const view = library.themeById.get('clothes')!;
    expect(view.bases.map((use) => [use.basis.id, use.questions.map((q) => q.id)])).toEqual([['b-modesty', ['q2']], ['b-culture', []]]);
    const place = placeOf(library, library.questionById.get('q2')!);
    expect(place.group?.title).toBe('Длина');
    expect(place.bases.map((basis) => basis.id)).toEqual(['b-modesty']);
    expect(placeOf(library, library.questionById.get('q4')!)).toEqual({ view: null, group: null, bases: [] });
  });
});

describe('placing and moving', () => {
  const questions = [
    question('a', { themeId: 'clothes', groupId: 'g-length', rank: 1000 }),
    question('b', { themeId: 'clothes', groupId: 'g-length', rank: 2000 }),
    question('c', { themeId: 'clothes', groupId: 'g-length', rank: 3000 }),
  ];
  const library = buildLibrary([clothes, suffering], questions);

  it('puts a new question at the end of its group, of the loose questions, or of the questions without a theme', () => {
    expect(rankForNewQuestion(library, 'clothes', 'g-length')).toBe(4000);
    expect(rankForNewQuestion(library, 'clothes', 'g-church')).toBe(1000);
    expect(rankForNewQuestion(library, 'clothes', undefined)).toBe(1000);
    expect(rankForNewQuestion(library, undefined, undefined)).toBe(1000);
  });

  it('moves a question one place by giving it the midpoint past its neighbour, and does nothing at the edges', () => {
    const list = library.themeById.get('clothes')!.buckets[0].questions;
    expect(movePlan(list, 'c', -1)).toEqual([{ id: 'c', rank: 1500 }]);
    expect(movePlan(list, 'a', 1)).toEqual([{ id: 'a', rank: 2500 }]);
    expect(movePlan(list, 'a', -1)).toEqual([]);
    expect(movePlan(list, 'c', 1)).toEqual([]);
  });

  it('spreads the list out again when two neighbours share a rank, instead of an arrow that does nothing', () => {
    // Two devices added at the same rank: 1000, 1000, 2000 (Codex review, 2026-11-25).
    const tied = [{ id: 'x', rank: 1000 }, { id: 'y', rank: 1000 }, { id: 'z', rank: 2000 }];
    const after = (id: string, step: -1 | 1) => {
      const ranks = new Map(tied.map((item) => [item.id, item.rank]));
      movePlan(tied, id, step).forEach((change) => ranks.set(change.id, change.rank));
      return [...ranks.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(([key]) => key);
    };
    expect(after('z', -1)).toEqual(['x', 'z', 'y']);
    expect(after('y', -1)).toEqual(['y', 'x', 'z']);
    expect(movePlan(tied, 'z', -1).length).toBeGreaterThan(0);
  });

  it('moves a theme one place among the themes', () => {
    expect(movePlan(library.themes.map((view) => view.theme), 'clothes', -1)).toEqual([{ id: 'clothes', rank: -500 }]);
    expect(movePlan(library.themes.map((view) => view.theme), 'suffering', -1)).toEqual([]);
  });

  it('swaps a group or a basis with its neighbour', () => {
    expect(moveInList(clothes.groups!, 'g-church', -1)!.map((g) => g.id)).toEqual(['g-church', 'g-length']);
    expect(moveInList(clothes.groups!, 'g-church', 1)).toBeNull();
  });

  /** The order a list reads in after a move's changes are written. */
  const orderAfter = (list: readonly { id: string; rank: number }[], id: string, target: MoveTarget) => {
    const ranks = new Map(list.map((item) => [item.id, item.rank]));
    movePlan(list, id, target).forEach((change) => ranks.set(change.id, change.rank));
    return [...ranks.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(([key]) => key);
  };

  it('puts a dragged question just before the one it was dropped on going up, just after it going down', () => {
    const list = [{ id: 'a', rank: 1000 }, { id: 'b', rank: 2000 }, { id: 'c', rank: 3000 }, { id: 'd', rank: 4000 }];
    expect(orderAfter(list, 'd', { onto: 'b', side: 'before' })).toEqual(['a', 'd', 'b', 'c']);
    expect(orderAfter(list, 'a', { onto: 'c', side: 'after' })).toEqual(['b', 'c', 'a', 'd']);
    expect(orderAfter(list, 'a', { onto: 'd', side: 'after' })).toEqual(['b', 'c', 'd', 'a']);
    expect(orderAfter(list, 'd', { onto: 'a', side: 'before' })).toEqual(['d', 'a', 'b', 'c']);
    // One rank written, on the dragged question alone.
    expect(movePlan(list, 'd', { onto: 'b', side: 'before' })).toEqual([{ id: 'd', rank: 1500 }]);
  });

  it('keeps the side the eye saw when an arrow moved the list before the drop\'s turn came', () => {
    // A B C D: «up» on B, then A dragged down onto B — the screen showed B A C D. When the drop's turn comes
    // B already stands first; «after B» still means B A C D, not A back before B (Codex review, 2026-11-26).
    const afterArrow = [{ id: 'b', rank: 500 }, { id: 'a', rank: 1000 }, { id: 'c', rank: 3000 }, { id: 'd', rank: 4000 }];
    expect(movePlan(afterArrow, 'a', { onto: 'b', side: 'after' })).toEqual([]);
    expect(orderAfter(afterArrow, 'c', { onto: 'b', side: 'after' })).toEqual(['b', 'c', 'a', 'd']);
  });

  it('writes nothing for a drop on itself or on a question no longer in the list', () => {
    const list = [{ id: 'a', rank: 1000 }, { id: 'b', rank: 2000 }];
    expect(movePlan(list, 'a', { onto: 'a', side: 'after' })).toEqual([]);
    expect(movePlan(list, 'a', { onto: 'gone', side: 'after' })).toEqual([]);
    expect(movePlan(list, 'gone', { onto: 'a', side: 'before' })).toEqual([]);
  });

  it('spreads the list out again when a drag lands between two questions of one rank', () => {
    const tied = [{ id: 'x', rank: 1000 }, { id: 'y', rank: 1000 }, { id: 'z', rank: 2000 }];
    expect(orderAfter(tied, 'z', { onto: 'y', side: 'before' })).toEqual(['x', 'z', 'y']);
    expect(orderAfter(tied, 'x', { onto: 'y', side: 'after' })).toEqual(['y', 'x', 'z']);
  });

  it('moves a group or a basis to where it was dropped', () => {
    const list = [{ id: 'p' }, { id: 'q' }, { id: 'r' }];
    expect(moveInList(list, 'r', { onto: 'p', side: 'before' })!.map((item) => item.id)).toEqual(['r', 'p', 'q']);
    expect(moveInList(list, 'p', { onto: 'r', side: 'after' })!.map((item) => item.id)).toEqual(['q', 'r', 'p']);
    expect(moveInList(list, 'p', { onto: 'p', side: 'after' })).toBeNull();
    expect(moveInList(list, 'p', { onto: 'gone', side: 'after' })).toBeNull();
  });
});

describe('standsOnScripture', () => {
  it('holds a basis that names at least one place a Bible can open, whatever else its list holds', () => {
    expect(standsOnScripture(['1 Тим 2:9'], 'ru')).toBe(true);
    expect(standsOnScripture(['Мерило', '1 Кор 11:4, 14'], 'ru')).toBe(true);
  });
  it('refuses a list with no place in it: empty, words, or a chapter the book does not have', () => {
    expect(standsOnScripture(undefined, 'ru')).toBe(false);
    expect(standsOnScripture([], 'ru')).toBe(false);
    expect(standsOnScripture(['стыдливость', ' '], 'ru')).toBe(false);
    expect(standsOnScripture(['Рим 25'], 'ru')).toBe(false);
  });
});

describe('groupNamed', () => {
  const groups = [{ id: 'g1', title: 'Дома и в гостях' }, { id: 'g2', title: 'Ёлка' }];
  it('finds a group by its name as search compares words: case, spaces between and at the ends, ё and е', () => {
    expect(groupNamed(groups, '  дома   и в ГОСТЯХ ')?.id).toBe('g1');
    expect(groupNamed(groups, 'елка')?.id).toBe('g2');
  });
  it('finds nothing for an empty or a new name, and leaves out the group being renamed', () => {
    expect(groupNamed(groups, '   ')).toBeUndefined();
    expect(groupNamed(groups, 'В церкви')).toBeUndefined();
    expect(groupNamed(undefined, 'Ёлка')).toBeUndefined();
    expect(groupNamed(groups, 'ЁЛКА', 'g2')).toBeUndefined();
  });
});

describe('plainLine', () => {
  it('reads Markdown as one plain line, emphasis and link addresses gone', () => {
    expect(plainLine('**Коротко.** Да — [см. Рим 8](https://x.y)\n\nдальше')).toBe('Коротко. Да — см. Рим 8 дальше');
  });

  it('stays quick on a long answer full of unmatched brackets', () => {
    const started = Date.now();
    plainLine('['.repeat(48_000));
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('searchLibrary', () => {
  const questions = [
    question('trousers', { themeId: 'clothes', groupId: 'g-length', title: 'Можно ли христианке носить брюки?', short: 'Мерило — стыдливость (Втор 22:5).', basisIds: ['b-modesty'] }),
    question('length', { themeId: 'clothes', groupId: 'g-length', title: 'Какой длины юбка?', alternates: ['Есть ли мера в сантиметрах?'], short: 'Цифры Писание не даёт.', scriptureRefs: ['1 Тим 2:9'] }),
    question('kids', { themeId: 'suffering', title: 'Почему страдают дети?', alternates: ['Где был Бог?'], short: 'Мир повреждён грехом.' }),
  ];
  const library = buildLibrary([clothes, suffering], questions);
  const ids = (query: string) => searchLibrary(library, query, 'ru').map((hit) => hit.question.id);

  it('finds a question by any of its wordings, in any case and with ё as е', () => {
    expect(ids('где был бог')).toEqual(['kids']);
    expect(ids('БРЮКИ')).toEqual(['trousers']);
    expect(ids('сантиметрах')).toEqual(['length']);
  });

  it('finds the questions holding every word typed, wherever the words are, the question\'s own words first', () => {
    expect(ids('стыдливость')).toEqual(['trousers']);
    expect(ids('мерило')).toEqual(['trousers']); // in the basis's title
    expect(ids('одежда')).toEqual(['length', 'trousers']); // the theme's own order: equal ranks, then id
    expect(ids('брюки дети')).toEqual([]);
  });

  it('finds by a place of Scripture: in the list of places, in the words of the answer, and in a basis the answer rests on', () => {
    // «length» lists the place; «trousers» rests on the basis that names it (Codex review, 2026-11-25).
    expect(ids('1 Тим 2:9-10')).toEqual(['length', 'trousers']);
    expect(ids('Втор 22')).toEqual(['trousers']);
    expect(searchLibrary(library, 'Втор 22:5', 'ru')[0].where).toBe('scripture');
  });

  it('reads a typed entry that lists verses as separate places, not as a span (1 Кор 11:4, 14)', () => {
    const places = typedPlaces('1 Кор 11:4, 14', 'ru');
    expect(places.map((place) => [place.chapter, place.fromVerse, place.toVerse])).toEqual([[11, 4, undefined], [11, 14, undefined]]);
    const listed = buildLibrary([clothes], [question('veil', { themeId: 'clothes', scriptureRefs: ['1 Кор 11:4, 14'] })]);
    expect(searchLibrary(listed, '1 Кор 11:9', 'ru')).toEqual([]);
    expect(searchLibrary(listed, '1 Кор 11:14', 'ru').map((hit) => hit.question.id)).toEqual(['veil']);
  });

  it('reads a searched list of verses as that list, not a span: «1 Кор 11:4, 14» does not find verse 5 (Codex review 2026-11-27)', () => {
    const five = buildLibrary([clothes], [question('five', { themeId: 'clothes', scriptureRefs: ['1 Кор 11:5'] }), question('fourteen', { themeId: 'clothes', scriptureRefs: ['1 Кор 11:14'] })]);
    expect(searchLibrary(five, '1 Кор 11:4, 14', 'ru').map((hit) => hit.question.id)).toEqual(['fourteen']);
  });

  it('searches a line of words with a place in it by its words: a place alone does not find a question the words miss', () => {
    const mixed = buildLibrary([clothes], [
      question('verse-only', { themeId: 'clothes', scriptureRefs: ['Рим 8:28'], short: 'Всё содействует ко благу.' }),
      question('both', { themeId: 'clothes', scriptureRefs: ['Рим 8:28'], short: 'И серьги тоже.' }),
    ]);
    expect(searchLibrary(mixed, 'серьги Рим 8:28', 'ru').map((hit) => hit.question.id)).toEqual(['both']);
    expect(searchLibrary(mixed, 'Рим 8:28', 'ru').map((hit) => hit.question.id).sort()).toEqual(['both', 'verse-only']);
    // A place in parentheses, as an answer writes it, and a typed «chapter, verse» are still places.
    expect(searchLibrary(mixed, '(Рим 8:28)', 'ru').map((hit) => hit.question.id).sort()).toEqual(['both', 'verse-only']);
    const thirteen = buildLibrary([clothes], [question('debt', { themeId: 'clothes', scriptureRefs: ['Рим 13:12'] })]);
    expect(searchLibrary(thirteen, 'Рим 13, 12', 'ru').map((hit) => hit.question.id)).toEqual(['debt']);
  });

  it('finds nothing for an empty line', () => {
    expect(ids('   ')).toEqual([]);
  });
});

describe('where the engine\'s notices send the pastor', () => {
  const ref = { collection: 'hardQuestions', id: 'q1' };
  it('opens a question under its theme, or under none', () => {
    expect(documentScreenHref(ref, { themeId: 't1' })).toBe('/care/questions/t1/q1');
    expect(documentScreenHref(ref, {})).toBe('/care/questions/none/q1');
    expect(documentScreenHref({ collection: 'hardQuestionThemes', id: 't1' })).toBe('/care/questions/t1');
  });

  it('knows the question\'s screen by its id, whatever theme the address carries', () => {
    expect(isOnDocumentScreen('/care/questions/t2/q1', ref, { themeId: 't1' })).toBe(true);
    expect(isOnDocumentScreen('/care/questions/none/q1', ref, null)).toBe(true);
    expect(isOnDocumentScreen('/care/questions/t1/q2', ref, { themeId: 't1' })).toBe(false);
    expect(isOnDocumentScreen('/care/questions/t1/basis/q1', ref, { themeId: 't1' })).toBe(false);
    // A broken escape in the address names no question and breaks nothing.
    expect(isOnDocumentScreen('/care/questions/theme/%ZZ', ref, null)).toBe(false);
  });
});
