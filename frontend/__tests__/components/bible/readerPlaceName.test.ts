import { readerPlaceName } from '@/components/bible/ReaderCommentDialog';

describe('readerPlaceName', () => {
  it('names a place as the reader does, in the Bible being read', () => {
    expect(readerPlaceName({ id: 'r', bible: 'rst', book: 'Isaiah', chapter: 41, fromVerse: 2 }, 'rst', 'ru')).toBe('Ис 41:2');
  });

  it('names every piece of a place a gap parts in the Bible being read: King James Romans 16 in the Synodal', () => {
    expect(readerPlaceName({ id: 'r', bible: 'kjv', book: 'Romans', chapter: 16 }, 'rst', 'ru')).toMatch(/^Рим 14:24.26, 16/);
  });
});
