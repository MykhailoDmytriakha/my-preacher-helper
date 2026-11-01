import { noteScreenHref } from '@/components/bible/analysis/analysisAddress';
import { bibleHref } from '@/utils/bibleLink';

import type { ScriptureReference, StudyNote } from '@/models/models';

const source = (range: Pick<ScriptureReference, 'chapter' | 'fromVerse' | 'toChapter' | 'endChapter' | 'toVerse'>): ScriptureReference => ({
  id: 'reference-1',
  bible: 'rst',
  book: 'Ephesians',
  ...range,
});

const analysis = (reference: ScriptureReference): Pick<StudyNote, 'id' | 'type' | 'scriptureRefs'> => ({
  id: 'analysis-1',
  type: 'analysis',
  scriptureRefs: [reference],
});

const queryOf = (href: string) => new URL(href, 'https://app.invalid').searchParams;

const sermonOrigin = { locale: 'en' as const, from: '/sermons/sermon-1' };

describe('analysis note screen addresses', () => {
  it('opens a legacy exact cross-chapter endpoint without dropping its ending chapter', () => {
    const reference = source({ chapter: 1, fromVerse: 23, toChapter: 2, toVerse: 2 });
    const original = { ...reference };

    const query = queryOf(noteScreenHref(analysis(reference), sermonOrigin));

    expect(query.get('at')).toBe('1:23');
    expect(query.get('to')).toBe('2:2');
    expect(query.get('analysis')).toBe('analysis-1');
    expect(query.get('mode')).toBe('view');
    expect(query.get('tr')).toBe('rst');
    expect(query.get('from')).toBe('/sermons/sermon-1');
    expect(reference).toEqual(original);
  });

  it('preserves the ending chapter of an ascending legacy exact cross-chapter range', () => {
    const query = queryOf(noteScreenHref(
      analysis(source({ chapter: 1, fromVerse: 2, toChapter: 2, toVerse: 5 })),
      sermonOrigin,
    ));

    expect(query.get('at')).toBe('1:2');
    expect(query.get('to')).toBe('2:5');
  });

  it('preserves a canonical exact cross-chapter endpoint', () => {
    const query = queryOf(noteScreenHref(
      analysis(source({ chapter: 1, fromVerse: 23, endChapter: 2, toVerse: 2 })),
      sermonOrigin,
    ));

    expect(query.get('at')).toBe('1:23');
    expect(query.get('to')).toBe('2:2');
  });

  it('uses the explicit exact endpoint when a legacy chapter range is also present', () => {
    const query = queryOf(noteScreenHref(
      analysis(source({ chapter: 1, fromVerse: 23, toChapter: 3, endChapter: 2, toVerse: 2 })),
      sermonOrigin,
    ));

    expect(query.get('to')).toBe('2:2');
  });

  it('keeps a legacy exact same-chapter range unchanged', () => {
    const query = queryOf(noteScreenHref(
      analysis(source({ chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 2 })),
      sermonOrigin,
    ));

    expect(query.get('at')).toBe('1:1');
    expect(query.get('to')).toBe('2');
  });

  it('keeps ordinary study notes on their note screen even when they have a scripture reference', () => {
    const note = { ...analysis(source({ chapter: 1, fromVerse: 23, toChapter: 2, toVerse: 2 })), type: 'note' as const };

    expect(noteScreenHref(note, sermonOrigin)).toBe('/studies/analysis-1');
  });

  it('keeps generic Bible links on legacy fromVerse-wins semantics outside analysis links', () => {
    const reference = source({ chapter: 1, fromVerse: 23, toChapter: 2, toVerse: 2 });
    const original = { ...reference };

    const query = queryOf(bibleHref(reference, sermonOrigin)!);

    expect(query.get('at')).toBe('1:23');
    expect(query.get('to')).toBe('23');
    expect(query.get('tr')).toBe('rst');
    expect(query.get('from')).toBe('/sermons/sermon-1');
    expect(reference).toEqual(original);
  });
});
