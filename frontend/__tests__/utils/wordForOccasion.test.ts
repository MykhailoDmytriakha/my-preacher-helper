import { versesHeldIn } from '@/utils/scriptureReferenceNumbering';
import { OCCASIONS, OCCASION_KINDS, OCCASION_SOURCES, occasionById, occasionNameKey, occasionNameMatches } from '@/utils/wordForOccasion';

import en from '../../locales/en/translation.json';
import ru from '../../locales/ru/translation.json';
import uk from '../../locales/uk/translation.json';

import type { BibleId } from '@/utils/bibles';

const LOCALES = { en, ru, uk } as const;
const BIBLES: BibleId[] = ['kjv', 'rst', 'ubio'];

type Tree = { [key: string]: string | Tree };
const leafPaths = (tree: Tree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([key, value]) => (typeof value === 'string' ? [`${prefix}${key}`] : leafPaths(value, `${prefix}${key}.`)));
const lookup = (tree: Tree, path: string): unknown =>
  path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Tree)[key] : undefined), tree);

describe('word for the occasion — the merged Gideon index', () => {
  it('holds every topic of every kind once, each with places — all the Gideons print', () => {
    const ids = OCCASIONS.map((occasion) => occasion.id);
    expect(ids.length).toBe(231);
    const byKind = (kind: string) => OCCASIONS.filter((occasion) => occasion.kind === kind).length;
    expect([byKind('situation'), byKind('virtue'), byKind('teaching')]).toEqual([140, 45, 46]);
    expect(occasionById('christsBirth')?.kind).toBe('teaching');
    expect(occasionById('humility')?.kind).toBe('virtue');
    expect(new Set(ids).size).toBe(ids.length);
    for (const occasion of OCCASIONS) expect(occasion.places.length).toBeGreaterThan(0);
    expect(occasionById('afraid')?.places.length).toBeGreaterThan(0);
    expect(occasionById('no-such-situation')).toBeUndefined();
  });

  it('names its ten indexes, each with an address to check it against', () => {
    expect(OCCASION_SOURCES).toHaveLength(10);
    for (const source of OCCASION_SOURCES) expect(source.url).toMatch(/^https:\/\//);
  });

  it('points at places every Bible of the app holds — a misread reference would open nothing', () => {
    const missing: string[] = [];
    for (const occasion of OCCASIONS) {
      for (const place of occasion.places) {
        for (const bible of BIBLES) {
          if (!versesHeldIn(place, bible).length) missing.push(`${occasion.id} · ${place.book} ${place.chapter}:${place.fromVerse ?? ''} in ${bible}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps each place once in a situation: no repeat, no run inside another run of the same chapter', () => {
    const repeats: string[] = [];
    for (const occasion of OCCASIONS) {
      const runs = occasion.places.filter((place) => place.fromVerse !== undefined && (place.endChapter ?? place.chapter) === place.chapter);
      runs.forEach((a, i) => runs.slice(i + 1).forEach((b) => {
        const overlap = a.book === b.book && a.chapter === b.chapter
          && a.fromVerse! <= (b.toVerse ?? b.fromVerse!) && b.fromVerse! <= (a.toVerse ?? a.fromVerse!);
        if (overlap) repeats.push(`${occasion.id} · ${a.book} ${a.chapter}`);
      }));
    }
    expect(repeats).toEqual([]);
  });

  it('keeps the King James numbering the indexes print: the Shepherd psalm is Psalm 23 here', () => {
    const lonely = occasionById('lonely')!;
    expect(lonely.places.some((place) => place.book === 'Psalms' && place.chapter === 23)).toBe(true);
    for (const place of lonely.places) expect(place.bible).toBe('kjv');
  });

  it('names every kind in all three languages — the group headings are asked for by a variable key', () => {
    for (const [language, file] of Object.entries(LOCALES)) {
      const missing = OCCASION_KINDS.filter((kind) => typeof lookup(file as unknown as Tree, `careWord.kinds.${kind}`) !== 'string');
      expect({ language, missing }).toEqual({ language, missing: [] });
    }
  });

  it('names every topic in all three languages', () => {
    for (const [language, file] of Object.entries(LOCALES)) {
      const missing = OCCASIONS.filter((occasion) => {
        const name = lookup(file as unknown as Tree, occasionNameKey(occasion.id));
        return typeof name !== 'string' || !name.trim();
      });
      expect({ language, missing: missing.map((occasion) => occasion.id) }).toEqual({ language, missing: [] });
    }
  });

  it('says the section the same way in all three languages', () => {
    const paths = (file: unknown) => leafPaths((file as { careWord: Tree }).careWord).filter((path) => !/_(few|many)$/.test(path)).sort();
    expect(paths(ru)).toEqual(paths(en));
    expect(paths(uk)).toEqual(paths(en));
  });

  it('finds a situation by any part of its name, ё read as е', () => {
    expect(occasionNameMatches('Страх будущего', 'будущ')).toBe(true);
    expect(occasionNameMatches('Безнадёжность', 'безнадеж')).toBe(true);
    expect(occasionNameMatches('Утрата близкого', 'УТРАТА')).toBe(true);
    expect(occasionNameMatches('Страх', 'болезнь')).toBe(false);
    expect(occasionNameMatches('Страх', '   ')).toBe(true);
  });
});
