import { ReaderShell } from '../../../test-utils/reader-shell';
import { act, render as renderUI, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BibleBookReader } from '@/components/bible/BibleBookReader';
import { resetCrossReferencePrefsForTests } from '@/components/bible/crossReferencePrefs';
import { readPlaceTrail, resetPlaceTrailForTests } from '@/components/bible/placeTrailStore';
import { forgetLoadedCrossRefs } from '@/utils/crossReferences';

import type { MarksChange } from '@/components/bible/marks/markStore';
import type { BookMarks } from '@/utils/bibleMarks';

const render = (ui: React.ReactNode) => renderUI(ui, { wrapper: ReaderShell });

/*
 * Two acts on a verse that put it on the trail of places (the owner, 2026-10-27, case 2026-10-12-block-diagram, 4.8):
 * a mark made with the marker or the pencil, and a verse pressed on the minimap. The stroke itself — a pointer drawn
 * over words — is `markStrokes.test.tsx`, the press on the map is `BibleMinimap.test.tsx`; here the reader's answer.
 */
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataDocument: () => ({ data: null, loading: true, commit: jest.fn(), status: null, recoveryIdentity: {} }),
}));
/** A red run already in 2:2: a stroke laying the same colour over it changes nothing. */
const STORED: BookMarks = { '2:2': { m: [[0, 1, 'red']] } };
jest.mock('@/components/bible/marks/markStore', () => ({
  ...jest.requireActual('@/components/bible/marks/markStore'),
  useBookMarks: () => ({ marks: STORED, save: jest.fn(), ready: true, writable: true, others: [], sync: null }),
}));
let keepStroke: ((change: MarksChange) => boolean) | null = null;
jest.mock('@/components/bible/marks/useMarkStrokes', () => ({
  useMarkStrokes: ({ save }: { save: (change: MarksChange) => boolean }) => {
    keepStroke = save;
  },
}));
let pressOnMap: ((place: { chapter: number; verse: number }) => void) | null = null;
jest.mock('@/components/bible/BibleMinimap', () => ({
  ...jest.requireActual('@/components/bible/BibleMinimap'),
  BibleMinimap: ({ onJump }: { onJump: (place: { chapter: number; verse: number }) => void }) => {
    pressOnMap = onJump;
    return null;
  },
}));

const publicFile = (path: string) => JSON.parse(readFileSync(join(__dirname, '../../../public', path), 'utf8'));
const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body, clone() { return this; }, headers: new Headers({ 'content-type': 'application/json' }) });

beforeEach(() => {
  keepStroke = null;
  pressOnMap = null;
  // A computer's width: the minimap stands beside the text.
  window.matchMedia = jest.fn((query: string) => ({
    matches: Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity) <= 1280, media: query, onchange: null,
    addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
  window.history.replaceState(null, '');
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetCrossReferencePrefsForTests();
  resetPlaceTrailForTests();
  forgetLoadedCrossRefs();
  global.fetch = jest.fn(async (url: string) => answer(publicFile(url.slice(1)))) as unknown as typeof fetch;
  Element.prototype.scrollIntoView = jest.fn();
  window.scrollTo = jest.fn() as unknown as typeof window.scrollTo;
});

/** Ruth opened at 1:1; the minimap is drawn once the book's text is in. */
const openRuth = async () => {
  render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 1, verse: 1 }} onOpenBook={jest.fn()} />);
  await waitFor(() => expect(pressOnMap).not.toBeNull());
  expect(readPlaceTrail().links).toEqual([{ book: 'Ruth', chapter: 1, verse: 1, bible: 'rst' }]);
};

describe('acts that put a verse on the trail of places', () => {
  it('a stroke that changed marks puts the first verse it changed on the trail; one that changed nothing puts none', async () => {
    await openRuth();

    // The same red laid over the red already there, and an eraser over words that bore nothing.
    act(() => { keepStroke!((marks) => ({ ...marks, '2:2': { m: [[0, 1, 'red']] } })); });
    act(() => { keepStroke!((marks) => ({ ...marks })); });
    expect(readPlaceTrail().links).toHaveLength(1);

    // A yellow run in 2:7 and a pencil line in 2:5: the earlier verse in the book's order is the one put there.
    act(() => { keepStroke!((marks) => ({ ...marks, '2:7': { m: [[0, 2, 'yellow']] }, '2:5': { p: [[1, 1, 'gray']] } })); });
    expect(readPlaceTrail().links).toHaveLength(2);
    expect(readPlaceTrail().links[1]).toEqual({ book: 'Ruth', chapter: 2, verse: 5, bible: 'rst' });
  });

  it('a verse pressed on the minimap joins the trail', async () => {
    await openRuth();

    act(() => { pressOnMap!({ chapter: 3, verse: 4 }); });
    expect(readPlaceTrail().links).toHaveLength(2);
    expect(readPlaceTrail().links[1]).toEqual({ book: 'Ruth', chapter: 3, verse: 4, bible: 'rst' });
  });
});
