import type { NumberingRule } from './tables';
import type { BibleId } from '@/utils/bibles';


/** Which table places the original in a chapter: the Synodal, the King James, or none (verse for verse). */
export type TableId = 'synodal' | 'kjv' | 'original';

/**
 * HOW ONE BIBLE NUMBERS ITS CHAPTERS AND VERSES, as the original placed in it.
 *
 * A chapter of the original takes the rules of one table: `chapters` names it for a chapter,
 * `psalms` for the Psalter, `base` for the rest. `exceptions` are this Bible's own deviations, in
 * the tables' syntax (`tables.ts`); a chapter of the original that has exceptions takes them
 * instead of its table's rules, so every exception describes its whole chapter.
 *
 * Every entry was derived from the Bible's own text and checked against all its verses: the count
 * of every chapter, no verse without a source, no verse fed from two chapters of the original, and
 * for the Synodal and the King James the Strong numbers of every verse pair
 * (`__tests__/utils/versification.test.ts`; `scripts/audit-versification.mjs` with the modules).
 */
export type Numbering = {
  base: TableId;
  psalms?: TableId;
  chapters?: Readonly<Record<string, TableId>>;
  exceptions?: Readonly<Record<string, NumberingRule>>;
};

export const NUMBERINGS: Readonly<Record<BibleId, Numbering>> = {
  // The Synodal table fits this edition (RST+) except where the edition divides otherwise.
  rst: {
    base: 'synodal',
    // Neh 7:68 (the horses) is a verse here, as in the King James.
    chapters: { '16007': 'kjv' },
    exceptions: {
      // Esth 1:6 is two verses here, and 1:7–8 one.
      '17001006:1-9': '17001006', '17001006:10-': '17001007', '17001007': '17001008',
      // Ps 13 (Synodal 12): the title is a verse of its own, as in the original.
      '19013001-006': -1000,
      // Ps 90 (89): the title stands alone, and 90:5–6 are one verse. The table leaves 90:6 out.
      '19090001:1-4': '19089001', '19090001:5-': '19089002', '19090002-005': -999, '19090006': '19089006', '19090007-017': -1000,
      // Ps 142 (141): the title joins verse 1. The table leaves it out.
      '19142001': '19141001', '19142002-008': -1001,
      // Acts 19:40–41 are one verse.
      '44019041': '44019040',
      // Phm 23–24 are one verse, and the closing grace is 24.
      '57001024': '57001023', '57001025': '57001024',
      // Rev 20:7–8 are one verse, and 20:9 two.
      '66020008': '66020007', '66020009:1-8': '66020008', '66020009:9-': '66020009',
    },
  },
  // The King James table fits this edition (KJV+) in every chapter.
  kjv: { base: 'kjv' },
  // Ohienko numbers the Psalter as the Synodal does and the rest as the original, with a few
  // chapters as the King James (UBIO'88).
  ubio: {
    base: 'original',
    psalms: 'synodal',
    chapters: { '13012': 'kjv', '16007': 'kjv', '23063': 'kjv', '23064': 'kjv', '39003': 'kjv' },
    exceptions: {
      // Ps 13 (12) and Ps 142 (141): the title is a verse of its own.
      '19013001-006': -1000,
      '19142001-008': -1000,
      // Ps 90 (89): verse for verse, the title within verse 1.
      '19090001-017': -1000,
      // Jer 5:30–31 are one verse.
      '24005031': '24005030',
      // Acts 19:40–41 are one verse.
      '44019041': '44019040',
    },
  },
};
