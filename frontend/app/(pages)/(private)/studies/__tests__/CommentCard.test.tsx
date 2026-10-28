import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ScriptureLinks } from '@/components/bible/ScriptureLinks';

import { CommentCard } from '../CommentCard';

import type { StudyNote } from '@/models/models';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

/*
 * A comment in Studies (case 2026-10-12-block-diagram, 3.2): its words open it in its window; its place opens the verse
 * over the page, as a note's place does (the owner, 2026-10-28: «нажимаю — не открываются тексты, как обычно»).
 */
const comment: StudyNote = {
  id: 'c1', userId: 'owner', type: 'comment', title: '', content: 'Ждать — не бездействие.',
  scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Isaiah', chapter: 40, fromVerse: 31 }],
  tags: [], createdAt: '', updatedAt: '', isDraft: false,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CommentCard', () => {
  it('opens its place over the page, as a note\'s does — not the comment', async () => {
    const openVerse = jest.fn();
    const onOpen = jest.fn();
    render(<ScriptureLinks onOpen={openVerse}><CommentCard note={comment} onOpen={onOpen} /></ScriptureLinks>);
    await userEvent.click(screen.getByRole('button', { name: /40:31/ }));
    expect(openVerse).toHaveBeenCalledWith(expect.objectContaining({ bible: 'rst', book: 'Isaiah', chapter: 40, fromVerse: 31 }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens the Bible at its place where nothing opens references over the page', async () => {
    render(<CommentCard note={comment} onOpen={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /40:31/ }));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toMatch(/^\/bible\?book=isaiah&at=40%3A31/);
  });

  it('opens the comment in its window from its words', async () => {
    const onOpen = jest.fn();
    render(<CommentCard note={comment} onOpen={onOpen} />);
    await userEvent.click(screen.getByText('Ждать — не бездействие.'));
    expect(onOpen).toHaveBeenCalledWith('c1');
  });
});
