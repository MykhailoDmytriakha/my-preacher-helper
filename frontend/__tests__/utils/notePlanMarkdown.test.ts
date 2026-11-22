import { assembleNotePlanMarkdown, noteLanguage, placeNotePlanReferences, replaceNotePlanReferences, type NotePlanLanguage } from '@/utils/notePlanMarkdown';

const LABEL: Record<NotePlanLanguage, string> = { uk: 'Висновок', ru: 'Вывод', en: 'Conclusion' };
const label = (language: NotePlanLanguage) => LABEL[language];

/*
 * The shape of a plan cell built from a note (owner, 2026-11-21): entry → numbered steps, each standing on its
 * verses with its thoughts indented under it → an optional table → conclusion. The model fills; this module forms.
 */
const empty = { entry: null, refs: [], steps: [], table: null, conclusion: null };

describe('assembleNotePlanMarkdown', () => {
  it('builds the point: entry, the point\'s verse, steps with verses before thoughts, conclusion', () => {
    const markdown = assembleNotePlanMarkdown({
      entry: 'Пойдут ли двое вместе?',
      refs: ['Ам. 3:3: «Пойдут ли двое вместе, не сговорившись между собою?»'],
      steps: [
        { title: 'Иосиф и Мария', gist: 'хотел тайно отпустить', refs: ['Мф. 1:19–20: «хотел тайно отпустить Её. Но когда он помыслил это…»'], thoughts: ['Бог открыл Иосифу то, что знала Мария'] },
        { title: 'Маной и жена', gist: null, refs: [], thoughts: ['Маной поверил жене', 'Просил за обоих'] },
      ],
      table: null,
      conclusion: 'Бог не оставил их на разных путях.',
    }, label);
    expect(markdown).toBe([
      'Пойдут ли двое вместе?',
      '*Ам. 3:3: «Пойдут ли двое вместе, не сговорившись между собою?»*',
      '1. **Иосиф и Мария** — хотел тайно отпустить',
      '   *Мф. 1:19–20: «хотел тайно отпустить Её. Но когда он помыслил это…»*',
      '   - Бог открыл Иосифу то, что знала Мария',
      '2. **Маной и жена**',
      '   - Маной поверил жене\n   - Просил за обоих',
      '**Вывод:** Бог не оставил их на разных путях.',
    ].join('\n\n'));
  });

  it('owns the form: strips the model\'s own numbers, bold and bullets, and writes «…» for three dots', () => {
    const markdown = assembleNotePlanMarkdown({
      ...empty,
      steps: [{ title: '1. **Лот**', gist: null, refs: ['*Быт. 19:17: «не оглядывайся назад... спасайся на гору»*'], thoughts: ['- Сердце осталось в городе'] }],
    }, label);
    expect(markdown).toBe('1. **Лот**\n\n   *Быт. 19:17: «не оглядывайся назад… спасайся на гору»*\n\n   - Сердце осталось в городе');
  });

  it('numbers only the steps that say something', () => {
    const markdown = assembleNotePlanMarkdown({
      ...empty,
      steps: [{ title: ' ', gist: null, refs: [], thoughts: [] }, { title: 'Иов', gist: null, refs: [], thoughts: [] }],
    }, label);
    expect(markdown).toBe('1. **Иов**');
  });

  it('writes a comparison as a table whose first column names the rows; a pipe is escaped, it cannot split a cell', () => {
    const markdown = assembleNotePlanMarkdown({
      ...empty,
      entry: 'Отдельно братьям и отдельно сёстрам.',
      table: {
        columns: ['Братьям', 'Сёстрам'],
        rows: [
          { label: 'Порядок', cells: ['1 Кор. 11:3: «всякому мужу глава Христос»', 'Еф. 5:22: «повинуйтесь… как Господу»'] },
          { label: 'Дети', cells: ['Ной | ковчег'] },
        ],
      },
    }, label);
    expect(markdown).toBe([
      'Отдельно братьям и отдельно сёстрам.',
      '|  | Братьям | Сёстрам |\n| --- | --- | --- |\n| Порядок | 1 Кор. 11:3: «всякому мужу глава Христос» | Еф. 5:22: «повинуйтесь… как Господу» |\n| Дети | Ной \\| ковчег |  |',
    ].join('\n\n'));
  });

  it('leaves no trace of empty parts', () => {
    expect(assembleNotePlanMarkdown(empty, label)).toBe('');
  });
});

describe('noteLanguage', () => {
  it.each([
    ['uk', 'Бог не залишив їх на різних шляхах'],
    ['ru', 'Бог не оставил их на разных путях'],
    ['en', 'God did not leave them on separate paths'],
  ])('reads %s from the cell\'s words, for the conclusion\'s label', (language, text) => {
    expect(noteLanguage(text)).toBe(language);
  });
});

describe('replaceNotePlanReferences', () => {
  it('takes the new verses where the old ones stood in a cell written before steps existed', () => {
    const current = '**→ Old turn**\n\n- Cue\n\n*Ин. 10:1: old*';
    expect(replaceNotePlanReferences(current, { refs: [], steps: [{ title: 'x', gist: null, refs: ['Ин. 10:28: никто не похитит'], thoughts: [] }] }))
      .toBe('**→ Old turn**\n\n- Cue\n\n*Ин. 10:28: никто не похитит*');
  });

  it('replaces the point\'s own verse in the opening and keeps a step without new verses as it was', () => {
    const current = ['Вход', '*Ам. 3:3: old*', '1. **Шаг**', '   *Быт. 1:1: keep*', '   - Мысль', '**Вывод:** Конец.'].join('\n\n');
    expect(replaceNotePlanReferences(current, { refs: ['Ам. 3:3: «Пойдут ли двое вместе»'], steps: [{ title: 'Шаг', gist: null, refs: [], thoughts: [] }] }))
      .toBe(current.replace('Ам. 3:3: old', 'Ам. 3:3: «Пойдут ли двое вместе»'));
  });
});

describe('the form holds at the edges (Codex review, 2026-11-21)', () => {
  it('indents a tenth step\'s content by its wider marker, so it stays inside the list', () => {
    const steps = Array.from({ length: 10 }, (_, index) => ({ title: `Шаг ${index + 1}`, gist: null, refs: [] as string[], thoughts: [] as string[] }));
    steps[9].refs = ['Ин. 10:28: «никто не похитит их»'];
    expect(assembleNotePlanMarkdown({ ...empty, steps }, label)).toContain('10. **Шаг 10**\n\n    *Ин. 10:28: «никто не похитит их»*');
  });

  it('names a step by its gist, else by its verse, else by its first thought — a bare number loses its content', () => {
    const markdown = assembleNotePlanMarkdown({ ...empty, steps: [
      { title: '', gist: 'только суть', refs: [], thoughts: [] },
      { title: '', gist: null, refs: ['Быт. 30:1: «дай мне детей»'], thoughts: [] },
      { title: '', gist: null, refs: [], thoughts: ['одна мысль', 'вторая'] },
    ] }, label);
    expect(markdown).toBe('1. **только суть**\n\n2. **Быт. 30:1**\n\n   *Быт. 30:1: «дай мне детей»*\n\n3. **одна мысль**\n\n   - вторая');
  });

  it('keeps markup out of a step\'s name, escapes a pipe in a table cell, and never ends the entry on a colon', () => {
    const markdown = assembleNotePlanMarkdown({ ...empty, entry: 'Посмотрим на три пары:', steps: [{ title: '** Лот \\', gist: null, refs: [], thoughts: [] }],
      table: { columns: ['A'], rows: [{ label: 'x', cells: ['a | b'] }] } }, label);
    expect(markdown).toBe('Посмотрим на три пары.\n\n1. **Лот**\n\n|  | A |\n| --- | --- |\n| x | a \\| b |');
  });

  it('takes the request\'s language for a Cyrillic cell its letters cannot tell', () => {
    expect(noteLanguage('Бог нас любить. Бог дав нам Слово', 'uk')).toBe('uk');
    expect(noteLanguage('Бог нас любить. Бог дав нам Слово', 'ru')).toBe('ru');
    // One Ukrainian letter in a quoted word does not outvote the cell's Russian ones.
    expect(noteLanguage('Это объясняет, почему «їжа» там стоит', 'uk')).toBe('ru');
  });
});

describe('a references-only revision changes the verse lines and nothing else (Codex review, 2026-11-21)', () => {
  const ten = Array.from({ length: 10 }, (_, index) => {
    const marker = index + 1 < 10 ? ` ${index + 1}.` : `${index + 1}.`;
    return `${marker} **Шаг ${index + 1}**\n\n    *Ин. ${index + 1}:1: old*`;
  }).join('\n\n');

  it('finds the step by its name — the editor\'s " 1." markers beside "10." included — and leaves the rest', () => {
    const revised = replaceNotePlanReferences(ten, { refs: [], steps: [{ title: 'Шаг 3', gist: null, refs: ['Ин. 3:16: «так возлюбил»'], thoughts: [] }] });
    expect(revised).toBe(ten.replace('*Ин. 3:1: old*', '*Ин. 3:16: «так возлюбил»*'));
  });

  it('does not move a verse to another step when the answer names fewer steps', () => {
    const current = '1. **Адам**\n\n   *Быт. 3:9: old Adam*\n\n2. **Руфь**\n\n   *Руфь 1:16: old Ruth*';
    expect(replaceNotePlanReferences(current, { refs: [], steps: [{ title: 'Руфь', gist: null, refs: ['Руфь 1:16: «твой народ — мой народ»'], thoughts: [] }] }))
      .toBe('1. **Адам**\n\n   *Быт. 3:9: old Adam*\n\n2. **Руфь**\n\n   *Руфь 1:16: «твой народ — мой народ»*');
  });

  it('keeps line endings, deep bullets and code byte for byte, and returns the very string when nothing changes', () => {
    const current = '1. **Шаг**\r\n\r\n   *Ин. 1:1: old*\r\n\r\n   - мысль\r\n     - глубже\r\n\r\n```\r\n1. **Шаг**\r\n```';
    expect(replaceNotePlanReferences(current, { refs: [], steps: [{ title: 'Шаг', gist: null, refs: ['Ин. 1:14: «Слово стало плотью»'], thoughts: [] }] }))
      .toBe(current.replace('*Ин. 1:1: old*', '*Ин. 1:14: «Слово стало плотью»*'));
    expect(replaceNotePlanReferences(current, { refs: [], steps: [] })).toBe(current);
  });

  it('puts a step\'s first verse right under its name, before its thoughts', () => {
    const current = '1. **Шаг**\n\n   - мысль';
    expect(replaceNotePlanReferences(current, { refs: [], steps: [{ title: 'Шаг', gist: null, refs: ['Ин. 1:1: «В начале было Слово»'], thoughts: [] }] }))
      .toBe('1. **Шаг**\n\n   *Ин. 1:1: «В начале было Слово»*\n\n   - мысль');
  });

  it('leaves a table point as it is: its verses live in cells, not in verse lines', () => {
    const current = 'Вход\n\n| | Братьям |\n| --- | --- |\n| Порядок | 1 Кор. 11:3 |\n\n**Вывод:** Конец.';
    expect(replaceNotePlanReferences(current, { refs: ['Еф. 5:22: «повинуйтесь»'], steps: [] })).toBe(current);
  });
});

describe('the Markdown itself says where a verse belongs (Codex review, second round)', () => {
  const answer = (title: string, refs: string[]) => ({ refs: [] as string[], steps: [{ title, gist: null, refs, thoughts: [] as string[] }] });

  it('leaves two steps that share a name alone, rather than give both the same verse', () => {
    const current = '1. **Молитва** — до\n\n   *Флп. 4:6: old one*\n\n2. **Молитва** — после\n\n   *Флп. 4:7: old two*';
    expect(replaceNotePlanReferences(current, answer('Молитва', ['Флп. 4:6–7: «о всём молитесь»']))).toBe(current);
  });

  it('never reaches past the step: a verse after the list and text in an HTML pre stay', () => {
    const current = '1. **Шаг**\n\n   *Ин. 1:1: old*\n\n*Ин. 1:2: after the list*\n\n<pre>\n*Ин. 1:3: inside pre*\n</pre>';
    expect(replaceNotePlanReferences(current, answer('Шаг', ['Ин. 1:14: «Слово стало плотью»'])))
      .toBe(current.replace('*Ин. 1:1: old*', '*Ин. 1:14: «Слово стало плотью»*'));
  });

  it('puts one new verse in place of two old ones: the extra one is emptied where it stood, every line stays', () => {
    const current = '1. **Шаг**\n\n   *Ин. 1:1: old*\r\n\r\n   *Ин. 1:5: old too*\n\n   - мысль \t\n';
    expect(replaceNotePlanReferences(current, answer('Шаг', ['Ин. 1:14: «Слово стало плотью»'])))
      .toBe('1. **Шаг**\n\n   *Ин. 1:14: «Слово стало плотью»*\r\n\r\n   \n\n   - мысль \t\n');
  });

  it('tells two steps apart by their whole names, a dash inside the name included', () => {
    const current = '1. **Молитва — до**\n\n   *Флп. 4:6: old*\n\n2. **Молитва — после**\n\n   *Флп. 4:7: old*';
    expect(replaceNotePlanReferences(current, answer('Молитва — после', ['Флп. 4:7: «мир Божий»'])))
      .toBe(current.replace('*Флп. 4:7: old*', '*Флп. 4:7: «мир Божий»*'));
  });

  it('replaces verses pair by pair in their places, so an explanation between them stays between them', () => {
    const current = '1. **Шаг**\n\n   *Ин. 1:1: old*\n\n   объяснение первого\n\n   *Ин. 1:5: old*\n\n   объяснение второго';
    expect(replaceNotePlanReferences(current, answer('Шаг', ['Ин. 1:1: «В начале было Слово»', 'Ин. 1:5: «свет во тьме светит»'])))
      .toBe(current.replace('*Ин. 1:1: old*', '*Ин. 1:1: «В начале было Слово»*').replace('*Ин. 1:5: old*', '*Ин. 1:5: «свет во тьме светит»*'));
  });

  it('never edits authored HTML, and keeps single-CR line endings intact', () => {
    const html = '<ol><li><p><strong>Шаг</strong></p><p><em>Ин. 1:1: old</em></p><p><em>Ин. 1:2: extra</em></p></li></ol>\n\nClosing';
    expect(replaceNotePlanReferences(html, answer('Шаг', ['Ин. 1:14: «плоть»']))).toBe(html);
    const cr = '1. **Шаг**\r\r   *Ин. 1:1: old*\r\r   *Ин. 1:2: extra*\r\r   - мысль';
    expect(replaceNotePlanReferences(cr, answer('Шаг', ['Ин. 1:14: «плоть»']))).toBe('1. **Шаг**\r\r   *Ин. 1:14: «плоть»*\r\r   \r\r   - мысль');
  });
});

it('does not escape a pipe the model already escaped, so the next cell stays in its column', () => {
  const markdown = assembleNotePlanMarkdown({ ...empty, table: { columns: ['A', 'B'], rows: [{ label: 'x', cells: ['a \\| b', 'intact'] }] } }, label);
  expect(markdown).toBe('|  | A | B |\n| --- | --- | --- |\n| x | a \\| b | intact |');
});

describe('only what is surely the preacher\'s verse moves (Codex review, fourth round)', () => {
  const answer = (title: string, refs: string[]) => ({ refs: [] as string[], steps: [{ title, gist: null, refs, thoughts: [] as string[] }] });

  it('takes a remark with a time for what it is: «*Начать в 10:30*» is not a verse and stays', () => {
    const current = '1. **Шаг**\n\n   *Ин. 1:1: old*\n\n   *Начать в 10:30*';
    expect(replaceNotePlanReferences(current, answer('Шаг', ['Ин. 1:2: «new»']))).toBe('1. **Шаг**\n\n   *Ин. 1:2: «new»*\n\n   *Начать в 10:30*');
  });

  it('keeps numbers in a name, and a name two lists share belongs to neither', () => {
    expect(replaceNotePlanReferences('1. **3.14**\n\n   *Ин. 1:1: old*', answer('2.14', ['Ин. 1:2: «new»']))).toBe('1. **3.14**\n\n   *Ин. 1:1: old*');
    const twoLists = '1. **Шаг**\n\n   *Ин. 1:1: one*\n\nПауза\n\n1. **Шаг**\n\n   *Ин. 1:5: two*';
    expect(replaceNotePlanReferences(twoLists, answer('Шаг', ['Ин. 1:2: «new»']))).toBe(twoLists);
  });

  it('leaves an old cell with captioned parts alone: the order of its verses says nothing about where a new one goes', () => {
    const current = '**Адам**\n\n*Быт. 3:9: old*\n\n**Руфь**\n\n*Руфь 1:16: old*';
    expect(replaceNotePlanReferences(current, answer('Руфь', ['Руфь 1:16: «new»']))).toBe(current);
  });

  it('puts a verse under a name only when the name is a line of its own', () => {
    const current = '1. **Шаг**\n   своя проза автора\n\n   - мысль';
    expect(replaceNotePlanReferences(current, answer('Шаг', ['Ин. 1:1: «В начале»']))).toBe(current);
  });

  it('writes a «<» from the model as text, so no answer can close a list item or a table cell', () => {
    const markdown = assembleNotePlanMarkdown({ ...empty, steps: [{ title: 'Шаг', gist: null, refs: ['Ин. 1:2: </li>'], thoughts: [] }],
      table: { columns: ['A', 'B'], rows: [{ label: 'x', cells: ['</td><td>Extra', 'intact'] }] } }, label);
    expect(markdown).not.toMatch(/<\/(li|td)>/);
    expect(markdown).toContain('&lt;/li>');
  });

  it('counts what it could not place: a name nobody has, a verse that lives in a table', () => {
    const current = '1. **Руфь**\n\n   *Руфь 1:15: old*';
    expect(placeNotePlanReferences(current, { refs: [], table: null, steps: [{ title: 'Ноеминь', gist: null, refs: ['Руфь 1:20: «Мара»'], thoughts: [] }] }).unplaced).toBe(1);
    expect(placeNotePlanReferences('Вход', { refs: [], steps: [], table: { columns: ['A'], rows: [{ label: 'x', cells: ['Еф. 5:22: «повинуйтесь»'] }] } }).unplaced).toBe(1);
    expect(placeNotePlanReferences(current, { refs: [], table: null, steps: [{ title: 'Руфь', gist: null, refs: ['Руфь 1:15: old'], thoughts: [] }] }).unplaced).toBe(0);
  });

  it('reads an empty cell in the request\'s language, and HTML tags do not outweigh the words', () => {
    expect(noteLanguage('', 'ru')).toBe('ru');
    expect(noteLanguage('<table><tbody><tr><td>Бог дав нам Слово</td></tr></tbody></table>', 'uk')).toBe('uk');
  });
});

describe('the last round of refusals (Codex review, fifth round)', () => {
  const answer = (title: string, refs: string[]) => ({ refs: [] as string[], steps: [{ title, gist: null, refs, thoughts: [] as string[] }] });

  it('leaves an old cell with «**Name:** words» parts alone and says so', () => {
    const current = '**Адам:** непослушание\n\n*Быт. 3:9: «Где ты?»*\n\n**Руфь:** верность\n\n*Руфь 1:16: «Твой народ»*';
    const placed = placeNotePlanReferences(current, { ...answer('Руфь', ['Руфь 1:16: «Твой народ — мой народ»']), table: null });
    expect(placed).toEqual({ text: current, unplaced: 1 });
  });

  it('compares names whole: «2. Молитва» is not «Молитва»', () => {
    const current = '1. **Молитва**\n\n   *Иак. 5:16: «Молитесь друг за друга»*\n\n2. **2. Молитва**\n\n   *Мф. 6:6: «Помолись Отцу»*';
    expect(replaceNotePlanReferences(current, answer('2. Молитва', ['Мф. 6:6: «войди в комнату твою»'])))
      .toBe(current.replace('«Помолись Отцу»', '«войди в комнату твою»'));
  });

  it('reads a reference written with a space after the colon whole', () => {
    const current = '1. **Faith**\n\n   *John 3: 16: «God so loved the world»*\n\n   - Read slowly';
    expect(replaceNotePlanReferences(current, answer('Faith', ['John 3:17: «that the world might be saved»'])))
      .toBe('1. **Faith**\n\n   *John 3:17: «that the world might be saved»*\n\n   - Read slowly');
  });

  it('keeps every verse of an answer for a one-group old cell: the point\'s and the step\'s', () => {
    const placed = placeNotePlanReferences('*John 3:16: «God loved»*', { refs: ['John 3:16: «God so loved»'], table: null, steps: [{ title: 'Faith', gist: null, refs: ['John 3:18: «not condemned»'], thoughts: [] }] });
    expect(placed).toEqual({ text: '*John 3:16: «God so loved»*\n\n*John 3:18: «not condemned»*', unplaced: 0 });
  });
});

describe('the sixth round (Codex review)', () => {
  it('leaves an old cell whose verses stand between other blocks: they mark parts, not one group', () => {
    const current = '- Адам\n\n*Быт. 3:9: «Где ты?»*\n\n- Руфь\n\n*Руфь 1:16: «Твой народ»*';
    expect(placeNotePlanReferences(current, { refs: [], table: null, steps: [{ title: 'Руфь', gist: null, refs: ['Руфь 1:16: «new»'], thoughts: [] }] }))
      .toEqual({ text: current, unplaced: 1 });
  });

  it('treats a name the answer gives twice as nobody\'s, and compares names with their punctuation', () => {
    const current = '1. **Молитва**\n\n   *Иак. 5:16: «Молитесь»*';
    expect(placeNotePlanReferences(current, { refs: [], table: null, steps: [
      { title: 'Молитва', gist: null, refs: [], thoughts: [] }, { title: 'Молитва', gist: null, refs: ['Мф. 6:6: «Помолись»'], thoughts: [] },
    ] })).toEqual({ text: current, unplaced: 1 });
    expect(replaceNotePlanReferences('1. **Молитва?**\n\n   *Иак. 5:16: «Молитесь»*', { refs: [], steps: [{ title: 'Молитва!', gist: null, refs: ['Мф. 6:6: «x»'], thoughts: [] }] }))
      .toBe('1. **Молитва?**\n\n   *Иак. 5:16: «Молитесь»*');
  });

  it('takes a verse in underscores as a verse too, so pairs never shift', () => {
    const current = '1. **Шаг**\n\n   _Ин. 3:16: «Бог возлюбил мир»_\n\n   Пояснение\n\n   *Ин. 3:18: «не судится»*';
    expect(replaceNotePlanReferences(current, { refs: [], steps: [{ title: 'Шаг', gist: null, refs: ['Ин. 3:16: «так возлюбил»', 'Ин. 3:18: «верующий не судится»'], thoughts: [] }] }))
      .toBe('1. **Шаг**\n\n   *Ин. 3:16: «так возлюбил»*\n\n   Пояснение\n\n   *Ин. 3:18: «верующий не судится»*');
  });

  it('counts a verse in a table\'s first column as not placed', () => {
    expect(placeNotePlanReferences('| Место | Тема |\n| --- | --- |\n| Мф. 6:5 | Молитва |', { refs: [], steps: [], table: { columns: ['Тема'], rows: [{ label: 'Мф. 6:6: «Помолись»', cells: ['Молитва'] }] } }).unplaced).toBe(1);
  });
});

describe('the seventh round (Codex review): what the code cannot read for sure, it does not move', () => {
  const step = (title: string, refs: string[]) => ({ title, gist: null, refs, thoughts: [] as string[] });
  const place = (current: string, node: { refs?: string[]; steps?: ReturnType<typeof step>[]; table?: { columns: string[]; rows: { label: string; cells: string[] }[] } | null }) =>
    placeNotePlanReferences(current, { refs: node.refs ?? [], steps: node.steps ?? [], table: node.table ?? null });

  it('leaves a step whose verses are written two ways, italic and plain', () => {
    const current = '1. **Faith**\n\n   John 3:16: God loved the world.\n\n   Explain the gift.\n\n   *John 3:18: Whoever believes is not condemned.*';
    expect(place(current, { steps: [step('Faith', ['John 3:16: God so loved the world.', 'John 3:18: not condemned.'])] })).toEqual({ text: current, unplaced: 1 });
  });

  it('takes as a step\'s name only the bold run its line begins with', () => {
    const current = '1. Peter’s denial — contrast with **Peter’s restoration**\n\n   *Luke 22:61: The Lord turned and looked at Peter.*';
    expect(place(current, { steps: [step('Peter’s restoration', ['John 21:17: Feed my sheep.'])] })).toEqual({ text: current, unplaced: 1 });
  });

  it('does not take a verse under a heading for the point\'s own verse', () => {
    const current = '### Example: Adam\n\n*Genesis 3:9: Where are you?*\n\n### Application\n\n1. **Ruth**';
    expect(place(current, { refs: ['John 3:16: God so loved the world.'] })).toEqual({ text: current, unplaced: 1 });
  });

  it('reads a name as the eye does: «Молитва*» is not «Молитва»', () => {
    const current = '1. **Молитва\\***\n\n   *Иак. 5:16: «Молитесь»*';
    expect(place(current, { steps: [step('Молитва', ['Мф. 6:6: «Помолись Отцу»'])] })).toEqual({ text: current, unplaced: 1 });
  });

  it('knows a reference written with a dot, in a verse line and in a table', () => {
    expect(place('| Place | Theme |\n| --- | --- |\n| John 3.16 | Faith |', { table: { columns: ['Theme'], rows: [{ label: 'John 3.18', cells: ['Faith'] }] } }).unplaced).toBe(1);
    expect(replaceNotePlanReferences('1. **Faith**\n\n   *John 3.16: God loved the world.*', { refs: [], steps: [step('Faith', ['John 3:16: God so loved the world.'])] }))
      .toBe('1. **Faith**\n\n   *John 3:16: God so loved the world.*');
  });

  it('keeps the cell\'s heading line out of the check, so a step named by its reference still takes its verse', () => {
    const current = '1. **Мф. 1:19–20**\n\n   *Мф. 1:19: «хотел тайно отпустить»*';
    expect(replaceNotePlanReferences(current, { refs: [], steps: [step('Мф. 1:19–20', ['Мф. 1:19–20: «хотел тайно отпустить Её… не бойся принять Марию»'])] }))
      .toBe('1. **Мф. 1:19–20**\n\n   *Мф. 1:19–20: «хотел тайно отпустить Её… не бойся принять Марию»*');
  });

  it('gives an old cue cell\'s closing verses to the point as a whole, as the old format meant them', () => {
    const current = '- Адам прятался\n- Руфь осталась\n\n*Руфь 1:16: «твой народ»*';
    expect(place(current, { steps: [step('Адам', ['Быт. 3:9: «где ты?»'])] }))
      .toEqual({ text: '- Адам прятался\n- Руфь осталась\n\n*Быт. 3:9: «где ты?»*', unplaced: 0 });
  });
});

describe('the eighth round (Codex ship check)', () => {
  const step = (title: string, refs: string[]) => ({ title, gist: null, refs, thoughts: [] as string[] });
  const place = (current: string, node: { refs?: string[]; steps?: ReturnType<typeof step>[] }) =>
    placeNotePlanReferences(current, { refs: node.refs ?? [], steps: node.steps ?? [], table: null });

  it('leaves a cell the reader cannot even parse as it was, and counts the miss', () => {
    const current = `${'> '.repeat(3000)}x`;
    expect(place(current, { refs: ['John 3:17: New'] })).toEqual({ text: current, unplaced: 1 });
  });

  it('reads the answer\'s name whole: «Faith*» goes to «Faith*», not to «Faith»', () => {
    const current = '1. **Faith**\n\n   *John 3:16: Old.*\n\n2. **Faith\\***\n\n   *James 2:17: Old.*';
    expect(place(current, { steps: [step('Faith*', ['James 2:17: Faith without works is dead.'])] }))
      .toEqual({ text: current.replace('*James 2:17: Old.*', '*James 2:17: Faith without works is dead.*'), unplaced: 0 });
  });

  it('knows a verse whose words begin with a number, or follow the colon with no space', () => {
    expect(replaceNotePlanReferences('1. **Faith**\n\n   *John 3:16: 16 For God so loved the world.*', { refs: [], steps: [step('Faith', ['John 3:16: God so loved the world.'])] }))
      .toBe('1. **Faith**\n\n   *John 3:16: God so loved the world.*');
    expect(replaceNotePlanReferences('1. **Faith**\n\n   *John 3:16:Old.*', { refs: [], steps: [step('Faith', ['John 3:16: New.'])] }))
      .toBe('1. **Faith**\n\n   *John 3:16: New.*');
  });

  it('gives a one-line step of a tight list its first verse', () => {
    expect(place('1. **Faith**', { steps: [step('Faith', ['John 3:16: God so loved the world.'])] }))
      .toEqual({ text: '1. **Faith**\n\n   *John 3:16: God so loved the world.*', unplaced: 0 });
  });

  it('finds the point\'s verses where the assembler writes them: after the opening, before the steps or the conclusion', () => {
    expect(place('Why?\n\n*John 3:16: God loved.*\n\n**Conclusion:** Believe.', { refs: ['John 3:16: God so loved.'] }))
      .toEqual({ text: 'Why?\n\n*John 3:16: God so loved.*\n\n**Conclusion:** Believe.', unplaced: 0 });
    expect(place('*John 3:16: God loved.*\n\n*John 3:18: Not condemned.*\n\n1. **Faith**', { refs: ['John 3:16: So loved.', 'John 3:18: Believes.'] }))
      .toEqual({ text: '*John 3:16: So loved.*\n\n*John 3:18: Believes.*\n\n1. **Faith**', unplaced: 0 });
  });
});

it('leaves the point\'s verses when one of them was made bold: the old one would stay beside its new copy (Codex, ninth round)', () => {
  const current = 'Why?\n\n*John 3:16: Old love.*\n\n**John 3:18: Old belief.**\n\n**Conclusion:** Believe.';
  expect(placeNotePlanReferences(current, { refs: ['John 3:16: New love.', 'John 3:18: New belief.'], steps: [], table: null }))
    .toEqual({ text: current, unplaced: 1 });
});
