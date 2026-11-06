import { render, screen } from '@testing-library/react';

import { CommentPlaceShown, type useCommentPlace } from '@/components/CommentPlaceMove';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const here = { id: 'r', bible: 'kjv' as const, book: 'Romans', chapter: 16, fromVerse: 23, toVerse: 25 };
const where = { here, moved: false, movable: false, open: false, list: null, context: '', homeLabel: () => '', putBack: jest.fn(), moveTo: jest.fn() } as unknown as ReturnType<typeof useCommentPlace>;

describe('the place of a comment whose verses are not chosen again here', () => {
  it('says why where «Изменить стихи» would stand', () => {
    render(<CommentPlaceShown where={where} place="" busy={false} deciding={false} onChooseVerses={jest.fn()} versesRefusal={() => 'comment.verses.notOneRun'} />);
    expect(screen.queryByTestId('comment-choose-verses')).toBeNull();
    expect(screen.getByTestId('comment-verses-why').textContent).toBe('comment.verses.notOneRun');
  });

  it('offers the button and says nothing where they can be chosen', () => {
    render(<CommentPlaceShown where={where} place="" busy={false} deciding={false} onChooseVerses={jest.fn()} versesRefusal={() => null} />);
    expect(screen.getByTestId('comment-choose-verses')).toBeTruthy();
    expect(screen.queryByTestId('comment-verses-why')).toBeNull();
  });
});
