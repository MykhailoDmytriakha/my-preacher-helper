/**
 * @jest-environment node
 */
/**
 * THE NUMBERING AGAINST THE ORIGINAL ITSELF — run when a Bible's numbering changes or a Bible is added:
 *
 *   BIBLE_MODULES_DIR=/path/to/mybible-modules npx jest __tests__/utils/versification.audit.test.ts
 *
 * The MyBible modules RST+ and KJV+ tag words with Strong numbers — the Hebrew and Greek words they
 * translate — so a pair of verses the numbering puts together must share most of them, and a
 * numbering off by a verse shows at once (same numbers alone fail 1 746 verses). The modules live
 * outside the repository, so without the folder the audit is skipped.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { getBookIds } from '@/utils/bibleBooks';
import { numberingEntries, placesIn, type VersePlace } from '@/utils/versification';

import type { BibleId } from '@/utils/bibles';

const MODULES = process.env.BIBLE_MODULES_DIR;
const FILES: Partial<Record<BibleId, string>> = { rst: 'RST+.SQLite3', kjv: 'KJV+.SQLite3' };
const run = MODULES && Object.values(FILES).every((file) => existsSync(join(MODULES, file as string))) ? describe : describe.skip;

// Particles that every verse has: an overlap on them alone proves nothing.
const COMMON = new Set(['853', '3588', '2532', '1161', '3756', '1722', '1519', '3361', '5213', '846', '1473', '4771', '3739', '3754', '1063', '5124']);

type SqliteDatabase = { prepare: (sql: string) => { all: () => unknown[] } };

const readStrongs = (bible: BibleId): Map<string, Set<string>> => {
  // node:sqlite (Node 22+) is loaded only when the audit runs; the installed Node types do not know it yet.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string, options: { readOnly: boolean }) => SqliteDatabase };
  const db = new DatabaseSync(join(MODULES as string, FILES[bible] as string), { readOnly: true });
  const numbers = (db.prepare('SELECT book_number AS b FROM books ORDER BY book_number').all() as { b: number }[]).map((row) => row.b);
  const books = getBookIds();
  const verses = new Map<string, Set<string>>();
  for (const row of db.prepare('SELECT book_number AS b, chapter AS c, verse AS v, text AS t FROM verses').all() as { b: number; c: number; v: number; t: string }[]) {
    const strongs = [...row.t.matchAll(/<S>(\d+)<\/S>/g)].map((match) => match[1]).filter((number) => !COMMON.has(number));
    verses.set(`${books[numbers.indexOf(row.b)]} ${row.c}:${row.v}`, new Set(strongs));
  }
  return verses;
};

const key = (place: VersePlace) => `${place.book} ${place.chapter}:${place.verse}`;
const share = (a: Set<string>, b: Set<string>) => {
  if (a.size === 0 || b.size === 0) return null;
  let common = 0;
  for (const number of a) if (b.has(number)) common += 1;
  return common / Math.min(a.size, b.size);
};

run('the numbering against the Strong numbers of RST+ and KJV+', () => {
  it.each([['rst', 'kjv'], ['kjv', 'rst']] as const)('every verse of %s meets the %s verses that translate the same words', (from, to) => {
    const here = readStrongs(from);
    const there = readStrongs(to);
    const off: string[] = [];
    for (const [place] of numberingEntries(from)) {
      const found = placesIn(to, from, place);
      const words = new Set(found.flatMap((verse) => [...(there.get(key(verse)) ?? [])]));
      const overlap = share(here.get(key(place)) ?? new Set(), words);
      if (overlap !== null && overlap < 0.25) off.push(`${key(place)} → ${found.map(key).join(' + ')} (${overlap.toFixed(2)})`);
    }
    // Song 1:1 carries no Strong numbers in RST+; nothing else may fall off.
    expect(off.filter((line) => !line.startsWith('Song of Solomon 1:1 '))).toEqual([]);
  });
});
