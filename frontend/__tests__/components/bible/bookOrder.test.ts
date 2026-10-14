import { readFileSync } from 'node:fs';
import path from 'node:path';

import { BIBLE_BOOKS_DATA } from '@/(pages)/(private)/studies/bibleData';
import { PROTESTANT_BOOKS, SYNODAL_BOOKS, bookSequence, booksOf } from '@/components/bible/bookOrder';
import { bookSlug } from '@/utils/bibleText';

const TEXT = path.join(__dirname, '../../../public/bible-text/rst/v1');

/** The order of the RST+ module's `books` table, by MyBible book number (read 2026-10-13). */
const RST_MODULE_ORDER = [
  10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 190, 220, 230, 240, 250, 260, 290, 300, 310, 330, 340, 350,
  360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460, 470, 480, 490, 500, 510, 660, 670, 680, 690, 700, 710, 720, 520, 530, 540,
  550, 560, 570, 580, 590, 600, 610, 620, 630, 640, 650, 730,
];

describe('the order of the books', () => {
  it('lists every book once', () => {
    const ids = bookSequence(SYNODAL_BOOKS);
    expect(new Set(ids).size).toBe(66);
    expect([...ids].sort()).toEqual(BIBLE_BOOKS_DATA.map((book) => book.id).sort());
  });

  it('is the Synodal translation\'s own: the general epistles after Acts, then Paul\'s', () => {
    const sources = bookSequence(SYNODAL_BOOKS).map((id) => {
      const file = JSON.parse(readFileSync(path.join(TEXT, `${bookSlug(id)}.json`), 'utf8')) as { source: number };
      return file.source;
    });
    expect(sources).toEqual(RST_MODULE_ORDER);
  });

  it.each(['kjv', 'ubio'] as const)('is the %s edition\'s own: Paul\'s letters first, as MyBible numbers the books', (bible) => {
    expect(booksOf(bible)).toBe(PROTESTANT_BOOKS);
    const sources = bookSequence(PROTESTANT_BOOKS).map((id) => {
      const file = JSON.parse(readFileSync(path.join(__dirname, `../../../public/bible-text/${bible}/v1`, `${bookSlug(id)}.json`), 'utf8')) as { source: number };
      return file.source;
    });
    expect(sources).toEqual([...sources].sort((a, b) => a - b));
    expect(new Set(bookSequence(PROTESTANT_BOOKS)).size).toBe(66);
  });

  it('gives the Synodal its own order', () => {
    expect(booksOf('rst')).toBe(SYNODAL_BOOKS);
  });
});
