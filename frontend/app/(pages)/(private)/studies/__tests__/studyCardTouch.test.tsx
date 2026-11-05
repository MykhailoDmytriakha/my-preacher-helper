import { render, screen } from '@testing-library/react';

import StudyNoteCard from '../StudyNoteCard';

import type { StudyNote } from '@/models/models';
import { TOUCH_AREA } from '@/utils/touchTarget';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }) }));

/*
 * Codex UX, 04.11: on a phone the card's arrow is 20 px, Copy 32 px, Edit about 28 px high — a near miss on the arrow opened
 * the note instead of folding it. Each takes the finger over 44 × 44 px; how they look does not change.
 */
const note: StudyNote = {
  id: 'n1', userId: 'u', type: 'note', title: 'Заметка', content: 'Слова', scriptureRefs: [], tags: [],
  createdAt: '2026-10-29T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', isDraft: false,
};

describe('a Studies card under a finger', () => {
  it('gives its arrow, Copy and Edit a 44 px area each, the arrow readable', () => {
    render(<StudyNoteCard note={note} bibleLocale="ru" isExpanded onToggleExpand={jest.fn()} onEdit={jest.fn()} />);
    const arrow = screen.getByRole('button', { name: 'common.collapse' });
    expect(arrow).toHaveClass(...TOUCH_AREA.small.split(' '), 'text-gray-500');
    expect(screen.getByRole('button', { name: /common\.copy/ })).toHaveClass(...TOUCH_AREA.compact.split(' '));
    expect(screen.getByRole('button', { name: /common\.edit/ })).toHaveClass(...TOUCH_AREA.short.split(' '));
  });
});
