// Runs against the REAL react-markdown, not the global stub in jest.setup.js: references must become
// links inside rendered Markdown, and only where a screen gives them somewhere to open.
jest.unmock('react-markdown');
jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { fireEvent, render, screen } from '@testing-library/react';

import { ScriptureLinks, WithoutScriptureLinks } from '@/components/bible/ScriptureLinks';
import MarkdownDisplay from '@/components/MarkdownDisplay';
import PlanMarkdown from '@/components/plan/PlanMarkdown';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }),
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
