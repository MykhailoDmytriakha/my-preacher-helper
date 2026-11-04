import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import StudyNoteCard from '../StudyNoteCard';

import type { StudyNote } from '@/models/models';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }) }));

/*
 * The owner, 03.11: «когда ты смотришь этот список разборов, то … ты должен видеть … то, как ты видишь это в просмотре…
 * а не так, как пункты-подпункты». An analysis's card draws its structure as the Bible and a sermon's prep do — a part a
 * line, stepped — never as a Markdown list of points.
 */
const content = [
  '- Благословен Бог и Отец Господа нашего Иисуса Христа,',
  '- благословивший нас во Христе всяким духовным благословением',
  '  - в небесах,',
  '- так как Он избрал нас в Нем прежде создания мира,',
].join('\n');
const analysis: StudyNote = {
  id: 'a1', userId: 'owner', type: 'analysis', title: 'Разбор · Еф 1:3–14', content,
  scriptureRefs: [{ id: 'r1', book: 'Ephesians', chapter: 1, fromVerse: 3, toVerse: 14 }], tags: [],
  createdAt: '2026-10-29T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', isDraft: false,
};
const card = (props: Partial<Parameters<typeof StudyNoteCard>[0]>) =>
  render(<StudyNoteCard note={analysis} bibleLocale="ru" isExpanded={false} onToggleExpand={jest.fn()} onEdit={jest.fn()} {...props} />);
const lines = (box: HTMLElement) => Array.from(box.querySelectorAll<HTMLElement>('[data-analysis-line]'));

describe('an analysis\'s card in Studies — its structure, not points', () => {
  it('folded, shows the opening of the structure stepped as in the analysis, and no list', () => {
    const { container } = card({});
    const glimpse = screen.getByTestId('analysis-glimpse');
    expect(lines(glimpse).map((line) => line.style.paddingLeft)).toEqual(['0px', '0px', '14px', '0px']);
    expect(lines(glimpse)[2]).toHaveTextContent('в небесах,');
    expect(container.querySelector('li')).toBeNull();
  });

  it('opened, draws the whole structure, and a press on it reads the analysis in its screen', async () => {
    const onOpen = jest.fn();
    const { container } = card({ isExpanded: true, onOpen });
    const outline = screen.getByTestId('analysis-outline');
    expect(lines(outline)).toHaveLength(4);
    expect(container.querySelector('li')).toBeNull();
    await userEvent.click(within(outline).getByText('небесах,'));
    expect(onOpen).toHaveBeenCalledWith(analysis);
  });

  it('opened during a search, lights the words found in the structure', () => {
    card({ isExpanded: true, searchQuery: 'небесах' });
    expect(within(screen.getByTestId('analysis-outline')).getByText('небесах')).toHaveClass('rounded');
  });

  it('folded during a search, shows where the words were found as lines of words with them lit, never as points', () => {
    // Codex, 04.11: the snippets of a folded card went through Markdown and brought the list of points back.
    const { container } = card({ searchQuery: 'небесах' });
    expect(container.querySelector('li')).toBeNull();
    expect(container.textContent).not.toMatch(/(^|\n)\s*- /);
    expect(screen.getAllByText('небесах')[0].tagName).toBe('MARK');
  });

  it('leaves a note\'s card as it was: its words, not a structure', () => {
    card({ note: { ...analysis, id: 'n1', type: 'note', title: 'Заметка' } });
    expect(screen.queryByTestId('analysis-glimpse')).not.toBeInTheDocument();
  });
});
