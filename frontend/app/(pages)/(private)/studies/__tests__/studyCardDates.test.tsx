import { render, screen } from '@testing-library/react';

import { CommentCard } from '../CommentCard';
import StudyNoteCard from '../StudyNoteCard';

import type { StudyNote } from '@/models/models';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
// The interface speaks Russian; the test runner's own date language is English, as an English Mac's browser is.
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }) }));

/*
 * BUG-20261102-dates-in-browser-language (the owner, 02.11: «локализация не сработала» on Studies): a card's date
 * older than a month came from the browser's `toLocaleDateString()` and read «7/26/2026» in a Russian interface.
 */
const question: StudyNote = {
  id: 'q1', userId: 'owner', type: 'question', title: 'Кто есть ближний?', content: 'Лк 10',
  scriptureRefs: [], tags: [], createdAt: new Date(2026, 6, 20, 9).toISOString(), updatedAt: new Date(2026, 6, 26, 10).toISOString(), isDraft: false,
};

describe('the dates on Studies\' cards', () => {
  it('say an old note\'s last change in the interface language', () => {
    render(<StudyNoteCard note={question} bibleLocale="ru" isExpanded={false} onToggleExpand={jest.fn()} onEdit={jest.fn()} />);
    expect(screen.getByText('26 июл. 2026')).toBeInTheDocument();
    expect(screen.queryByText('7/26/2026')).not.toBeInTheDocument();
  });

  it('say the open card\'s creation day in the interface language', () => {
    render(<StudyNoteCard note={question} bibleLocale="ru" isExpanded onToggleExpand={jest.fn()} onEdit={jest.fn()} />);
    expect(screen.getByText('20 июл. 2026')).toBeInTheDocument();
    // Readable small words: gray-500 on white is 4.8:1, gray-400 was 2.5:1 (Codex UX, 04.11).
    expect(screen.getByText('20 июл. 2026')).toHaveClass('text-gray-500', 'dark:text-gray-400');
  });

  it('say an old comment\'s last change in the interface language', () => {
    render(<CommentCard note={{ ...question, id: 'c1', type: 'comment', title: '' }} onOpen={jest.fn()} />);
    expect(screen.getByText('26 июл. 2026')).toBeInTheDocument();
  });
});
