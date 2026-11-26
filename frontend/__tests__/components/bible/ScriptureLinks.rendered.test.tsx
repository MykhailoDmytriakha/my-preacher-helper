// Runs against the REAL react-markdown, not the global stub in jest.setup.js: references must become
// links inside rendered Markdown, and only where a screen gives them somewhere to open.
jest.unmock('react-markdown');
jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { fireEvent, render, screen } from '@testing-library/react';

import { SCRIPTURE_LINK_MARK, ScriptureText, ScriptureLinks, ScriptureWrittenIn, WithoutScriptureLinks } from '@/components/bible/ScriptureLinks';
import ScriptureOpening from '@/components/common/ScriptureOpening';
import { leadingReference } from '@/utils/bibleLink';
import MarkdownDisplay from '@/components/MarkdownDisplay';
import PlanMarkdown from '@/components/plan/PlanMarkdown';

// The interface's language, changed by a test that reads as someone else does.
let mockLanguage = 'ru';
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: mockLanguage } }),
}));

const plan = '## Суды, которые уже были\n\nПотоп: «конец всякой плоти пришёл» (Быт. 6:13). См. [ссылку](https://example.com) и `Мф. 24:38`.\n\n- Содом: Быт. 19:24\n- Даниил 3 года молился';

describe('ScriptureLinks — a reference in text is a link where a screen opens it', () => {
  it('links the references of a plan — in a sentence, in brackets, in a list — and nothing in code, links or counts', () => {
    const onOpen = jest.fn();
    render(<ScriptureLinks onOpen={onOpen}><PlanMarkdown markdown={plan} /></ScriptureLinks>);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Быт. 6:13', 'Быт. 19:24']);
    fireEvent.click(screen.getByRole('button', { name: 'Быт. 6:13' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ bible: 'rst', book: 'Genesis', chapter: 6, fromVerse: 13 }));
    // The sentence keeps every word around the link.
    expect(screen.getByRole('button', { name: 'Быт. 6:13' }).closest('p')).toHaveTextContent('Потоп: «конец всякой плоти пришёл» (Быт. 6:13). См. ссылку и Мф. 24:38.');
  });

  it('links the references of a note or a block drawn by MarkdownDisplay', () => {
    const onOpen = jest.fn();
    render(<ScriptureLinks onOpen={onOpen}><MarkdownDisplay content={'Прочитайте **Рим 12:1–2** и обсудите.'} /></ScriptureLinks>);
    fireEvent.click(screen.getByRole('button', { name: 'Рим 12:1–2' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ book: 'Romans', chapter: 12, fromVerse: 1, toVerse: 2 }));
  });

  it.each([
    ['bold', '**Притч. 1:23**; 3:11–12; 9:8–9', 'strong'],
    ['italic', '*Притч. 1:23*; 3:11–12; 9:8–9', 'em'],
    ['nested', '***Притч. 1:23***; 3:11–12; 9:8–9', 'em strong'],
    ['plain inline HTML', '<span>Притч. 1:23</span>; 3:11–12; 9:8–9', 'span'],
  ])('keeps a scripture list connected across a %s opening', (_style, markdown, formatting) => {
    const onOpen = jest.fn();
    render(<ScriptureLinks onOpen={onOpen} writtenIn="ru"><MarkdownDisplay content={markdown} /></ScriptureLinks>);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Притч. 1:23', '3:11–12', '9:8–9']);
    expect(buttons[0].closest(formatting)).toHaveTextContent('Притч. 1:23');
    expect(buttons[0].closest('p')?.textContent).toBe('Притч. 1:23; 3:11–12; 9:8–9');
    fireEvent.click(buttons[1]);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ bible: 'rst', book: 'Proverbs', chapter: 3, fromVerse: 11, toVerse: 12 }));
  });

  it('keeps one control per place when markup falls inside the reference or its separator', () => {
    const onOpen = jest.fn();
    const content = 'Притч. **1:23; 3:11**–12; *9:8–9*';
    render(<ScriptureLinks onOpen={onOpen} writtenIn="ru"><MarkdownDisplay content={content} searchQuery="3:11" /></ScriptureLinks>);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Притч. 1:23', '3:11–12', '9:8–9']);
    expect(buttons[1].querySelector('strong mark')).toHaveTextContent('3:11');
    expect(buttons[0].closest('p')?.textContent).toBe('Притч. 1:23; 3:11–12; 9:8–9');
    fireEvent.click(buttons[1]);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ bible: 'rst', book: 'Proverbs', chapter: 3, fromVerse: 11, toVerse: 12 }));
  });

  it('keeps empty emphasis inside the same scripture control', () => {
    const content = 'Притч. <em><strong></strong></em>1:23; 3:11–12';
    render(<ScriptureLinks onOpen={jest.fn()} writtenIn="ru"><MarkdownDisplay content={content} /></ScriptureLinks>);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Притч. 1:23', '3:11–12']);
    expect(buttons[0].querySelector('em strong')).toBeInTheDocument();
  });

  it.each([
    ['a paragraph', '\n\n'],
    ['a soft line break', '\n'],
    ['a hard line break', '  \n'],
    ['an authored link', ' [Иов 2:1](https://example.com)'],
    ['inline code', ' `Иов 2:1`'],
  ])('does not continue a scripture list across %s', (_boundary, separator) => {
    render(
      <ScriptureLinks onOpen={jest.fn()} writtenIn="ru">
        <MarkdownDisplay content={`**Притч. 1:23**${separator}; 3:11–12. **Рим 8:28**; *12:1–2*.`} />
      </ScriptureLinks>,
    );
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Притч. 1:23', 'Рим 8:28', '12:1–2']);
  });

  it.each([['LF', '\n'], ['CR', '\r'], ['CRLF', '\r\n']])('respects %s line breaks without treating a prose count as a reference', (_ending, newline) => {
    const content = [
      `**Притч.**${newline}1:23; 3:11–12. Рим 8:28.`,
      `Даниил 3${newline}года учился.`,
      `**Притч. 1:23**;${newline}3:11–12.`,
    ].join(newline + newline);
    render(<ScriptureLinks onOpen={jest.fn()} writtenIn="ru"><MarkdownDisplay content={content} /></ScriptureLinks>);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Рим 8:28', 'Притч. 1:23']);
  });

  it('uses the same emphasis-aware lists in sermon plans', () => {
    render(<ScriptureLinks onOpen={jest.fn()} writtenIn="ru"><PlanMarkdown markdown={'## Reading\n\n**Притч. 1:23**; *3:11–12*.'} /></ScriptureLinks>);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Притч. 1:23', '3:11–12']);
  });

  // Codex's review, 2026-10-21: a note opened from the search "24:26" lost the light on its match once the match became a link.
  it('keeps a search match lit inside a reference link', () => {
    render(<ScriptureLinks onOpen={jest.fn()}><MarkdownDisplay content="Призыв: не выходите (Мф 24:26)." searchQuery="24:26" /></ScriptureLinks>);
    expect(screen.getByRole('button', { name: 'Мф 24:26' }).querySelector('mark')).toHaveTextContent('24:26');
  });

  it('links a reference inside a quote callout', () => {
    render(<ScriptureLinks onOpen={jest.fn()}><MarkdownDisplay content={'[Quote: Прочитайте Рим 12:1–2]'} /></ScriptureLinks>);
    expect(screen.getByRole('button', { name: 'Рим 12:1–2' })).toBeInTheDocument();
  });

  // Case 2026-10-12-block-diagram, L8: the notes' search drew a quote callout as plain lit words, and its reference
  // stopped opening while the search was on. The words stay lit and the reference stays a link, its match lit in it.
  it('keeps a reference in a quote callout a link while the notes are searched', () => {
    const onOpen = jest.fn();
    render(<ScriptureLinks onOpen={onOpen}><MarkdownDisplay content={'[Quote: Прочитайте Рим 12:1–2 вслух]'} searchQuery="прочитайте 12:1" /></ScriptureLinks>);
    // The accessible name the test library computes puts a space around the <mark> («Рим 12:1 –2»); a browser does not.
    const link = screen.getByText((_, element) => element?.tagName === 'BUTTON' && element.textContent === 'Рим 12:1–2');
    expect(link.querySelector('mark')).toHaveTextContent('12:1');
    expect(screen.getByText('Прочитайте', { selector: 'mark' })).toBeInTheDocument();
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ book: 'Romans', chapter: 12, fromVerse: 1, toVerse: 2 }));
  });

  it('leaves a document drawn inside a linking page — a PDF — with its references as words', () => {
    render(<ScriptureLinks onOpen={jest.fn()}><WithoutScriptureLinks><PlanMarkdown markdown={plan} /></WithoutScriptureLinks></ScriptureLinks>);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('leaves text as written where no screen opens references — a PDF, a shared page, a note', () => {
    render(
      <>
        <PlanMarkdown markdown={plan} />
        <MarkdownDisplay content={'Прочитайте Рим 12:1–2'} />
      </>
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('Прочитайте Рим 12:1–2')).toBeInTheDocument();
  });
});

/*
 * A reference is read in the Bible it was written in, and marked with it where the reader, taking its
 * letters in their own language and Bible, would land elsewhere (the owner, 2026-10-20, case
 * 2026-10-12-block-diagram, 2.2.1 — "the reference's translation").
 */
describe('ScriptureLinks — a reference keeps the Bible it was written in', () => {
  afterEach(() => { mockLanguage = 'ru'; });

  it('opens a Russian sermon\'s "Пс 22:1" as the Synodal numbers it for an English reader, and marks only that one', () => {
    mockLanguage = 'en';
    const onOpen = jest.fn();
    render(<ScriptureLinks onOpen={onOpen}><MarkdownDisplay content={'Господь — Пастырь мой (Пс 22:1). Так возлюбил Бог мир — Ин 3:16.'} /></ScriptureLinks>);
    fireEvent.click(screen.getByRole('button', { name: 'Пс 22:1' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ bible: 'rst', book: 'Psalms', chapter: 22, fromVerse: 1 }));
    expect(screen.getByRole('button', { name: 'Пс 22:1' }).nextElementSibling).toHaveTextContent('bible.translations.rst.short');
    // John 3:16 is John 3:16 in every Bible: no mark.
    expect(screen.getAllByText('bible.translations.rst.short')).toHaveLength(1);
  });

  it('reads a Ukrainian note\'s "1Цар 3:5" as 1 Kings under a Russian interface, by the note\'s words, and marks it', () => {
    const onOpen = jest.fn();
    render(<ScriptureLinks onOpen={onOpen}><MarkdownDisplay content={'Господь з’явився Соломонові уві сні — 1Цар 3:5.'} /></ScriptureLinks>);
    fireEvent.click(screen.getByRole('button', { name: '1Цар 3:5' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ bible: 'ubio', book: '1 Kings', chapter: 3, fromVerse: 5 }));
    expect(screen.getByText('bible.translations.ubio.short')).toBeInTheDocument();
  });

  it('takes the document\'s language for a short text whose own letters do not say it', () => {
    const onOpen = jest.fn();
    render(<ScriptureLinks onOpen={onOpen} writtenIn="uk"><MarkdownDisplay content={'1Цар 3:5'} /></ScriptureLinks>);
    fireEvent.click(screen.getByRole('button', { name: '1Цар 3:5' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ bible: 'ubio', book: '1 Kings' }));
  });
});

describe('ScriptureLinks — the document\'s words decide, not a quote\'s', () => {
  // The owner on the case canvas, 2026-10-20: a book Russian and Ukrainian write alike is read by the
  // document's words. A Ukrainian quote in a Russian note keeps the note's "1Цар"; a name only
  // Ukrainian writes ("Йоїл") still says its own Bible.
  it('reads "1Цар 3:5" in a Ukrainian quote of a Russian note as the note\'s 1 Samuel, and "Йоїл 3:1" as Ohienko\'s', () => {
    const onOpen = jest.fn();
    const content = 'Мы были слепы, но Господь открыл нам глаза. Мы были грешны, но Он простил нас.\n\n> Господь з’явився **Соломонові** — 1Цар 3:5. Виллю Мого Духа — Йоїл 3:1.';
    render(<ScriptureLinks onOpen={onOpen}><MarkdownDisplay content={content} /></ScriptureLinks>);
    fireEvent.click(screen.getByRole('button', { name: '1Цар 3:5' }));
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ bible: 'rst', book: '1 Samuel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Йоїл 3:1' }));
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ bible: 'ubio', book: 'Joel', chapter: 3, fromVerse: 1 }));
  });

  it('takes the screen\'s document language over the words of one text in it', () => {
    const onOpen = jest.fn();
    render(<ScriptureLinks onOpen={onOpen} writtenIn="uk"><MarkdownDisplay content={'Мы были слепы — 1Цар 3:5.'} /></ScriptureLinks>);
    fireEvent.click(screen.getByRole('button', { name: '1Цар 3:5' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ bible: 'ubio', book: '1 Kings' }));
  });
});

describe('ScriptureLinks — a document inside another', () => {
  it('reads a note shown inside a Russian sermon by the note\'s own words', () => {
    const onOpen = jest.fn();
    render(
      <ScriptureLinks onOpen={onOpen} writtenIn="ru">
        <ScriptureWrittenIn language="uk"><MarkdownDisplay content={'1Цар 3:5'} /></ScriptureWrittenIn>
      </ScriptureLinks>
    );
    fireEvent.click(screen.getByRole('button', { name: '1Цар 3:5' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ bible: 'ubio', book: '1 Kings' }));
  });

  it('marks a sermon\'s opening verse as a reference link, so a copy of the plan turns it back into words', () => {
    const text = 'Пс 22:1 — «Господь — Пастырь мой»';
    render(<ScriptureOpening text={text} reference={leadingReference(text, { locale: 'ru' })} onOpen={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Пс 22:1' })).toHaveAttribute(SCRIPTURE_LINK_MARK);
  });

  // BUG-20261117-scripture-list-shorthand-not-linked: a list in one book linked only its first place.
  it('links every place of a list in one book, in a block and in a sermon\'s verse', () => {
    const onOpen = jest.fn();
    const { unmount } = render(
      <ScriptureLinks onOpen={onOpen}><MarkdownDisplay content={'Притч. 10:13; 13:24; 19:18–19; 29:15, 17.\n\nНаказание как средство удержать человека.'} /></ScriptureLinks>,
    );
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Притч. 10:13', '13:24', '19:18–19', '29:15', '17']);
    fireEvent.click(screen.getByRole('button', { name: '17' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ bible: 'rst', book: 'Proverbs', chapter: 29, fromVerse: 17 }));
    unmount();

    const verse = 'Притч. 1:23; 3:11–12 — обличение и наставление';
    const open = jest.fn();
    render(<ScriptureOpening text={verse} reference={leadingReference(verse, { locale: 'ru' })} onOpen={open} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Притч. 1:23', '3:11–12']);
    expect(screen.getByRole('button', { name: '3:11–12' }).parentElement).toHaveTextContent(verse);
    fireEvent.click(screen.getByRole('button', { name: '3:11–12' }));
    expect(open).toHaveBeenCalledWith(expect.stringContaining('at=3%3A11'), expect.anything());
  });
});


it('keeps a reference click and double-click out of a display-text editor', () => {
  const onOpen = jest.fn();
  const edit = jest.fn();
  render(<ScriptureLinks onOpen={onOpen}><div onDoubleClick={edit}><ScriptureText text="Read Ruth 1:2" /></div></ScriptureLinks>);
  const link = screen.getByRole('button', { name: 'Ruth 1:2' });
  fireEvent.click(link);
  fireEvent.doubleClick(link);
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ book: 'Ruth', chapter: 1, fromVerse: 2 }));
  expect(edit).not.toHaveBeenCalled();
});
