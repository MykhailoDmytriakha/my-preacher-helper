// Runs against the REAL react-markdown, not the global stub in jest.setup.js: references must become
// links inside rendered Markdown, and only where a screen gives them somewhere to open.
jest.unmock('react-markdown');
jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { fireEvent, render, screen } from '@testing-library/react';

import { SCRIPTURE_LINK_MARK, ScriptureLinks, ScriptureWrittenIn, WithoutScriptureLinks } from '@/components/bible/ScriptureLinks';
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
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ bible: 'rst', book: 'Genesis', chapter: 6, fromVerse: 13, label: 'Быт. 6:13' }));
    // The sentence keeps every word around the link.
    expect(screen.getByRole('button', { name: 'Быт. 6:13' }).closest('p')).toHaveTextContent('Потоп: «конец всякой плоти пришёл» (Быт. 6:13). См. ссылку и Мф. 24:38.');
  });

  it('links the references of a note or a block drawn by MarkdownDisplay', () => {
    const onOpen = jest.fn();
    render(<ScriptureLinks onOpen={onOpen}><MarkdownDisplay content={'Прочитайте **Рим 12:1–2** и обсудите.'} /></ScriptureLinks>);
    fireEvent.click(screen.getByRole('button', { name: 'Рим 12:1–2' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ book: 'Romans', chapter: 12, fromVerse: 1, toVerse: 2 }));
  });

  it('links a reference inside a quote callout', () => {
    render(<ScriptureLinks onOpen={jest.fn()}><MarkdownDisplay content={'[Quote: Прочитайте Рим 12:1–2]'} /></ScriptureLinks>);
    expect(screen.getByRole('button', { name: 'Рим 12:1–2' })).toBeInTheDocument();
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
});
