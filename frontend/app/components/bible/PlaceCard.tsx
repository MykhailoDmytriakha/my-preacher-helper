import { ChevronRight } from 'lucide-react';

import { versesPreview, type PlaceVerse } from '@/utils/placeText';

import type { ScriptureRefShape } from '@/utils/scriptureReference';
import type { ReactNode } from 'react';

/** A run of verses shows whole, up to the cross-reference window's eight; a whole chapter, its opening two. */
const RUN_VERSES_SHOWN = 8;
const CHAPTER_VERSES_SHOWN = 2;

/** The words a place card shows: a run of verses whole, a whole chapter its opening verses; null while the text is on its way. */
export function placeWords(verses: readonly PlaceVerse[], place: Pick<ScriptureRefShape, 'fromVerse'>): string | null {
  return versesPreview(verses, place.fromVerse === undefined ? CHAPTER_VERSES_SHOWN : RUN_VERSES_SHOWN);
}

/** Each section's own colour on its place cards (moved here from the word for the occasion, 2026-11-25). */
const TONES = {
  emerald: {
    card: 'hover:border-emerald-300 hover:bg-emerald-50/40 has-[:focus-visible]:border-emerald-400 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/20',
    label: 'text-emerald-700 dark:text-emerald-300',
  },
  /** The colour of Scripture in the app's texts (`SCRIPTURE_LINK_CLASSES`), for a section whose own colour is not a reading one. */
  indigo: {
    card: 'hover:border-indigo-300 hover:bg-indigo-50/40 has-[:focus-visible]:border-indigo-400 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/20',
    label: 'text-indigo-700 dark:text-indigo-300',
  },
} as const;

/**
 * One place as a card: its label, a quiet note, its words; a press anywhere on the card opens it.
 * The opening button stretches over the whole card (its `after:` layer), so a card can also carry
 * its own action (`action`, the remove of an own place) beside the arrow, never inside a button.
 */
export function PlaceCard({ label, note, words, loadingWords, openLabel, onOpen, action, tone = 'emerald' }: {
  label: string; note: ReactNode; words: string | null; loadingWords: string; openLabel: string; onOpen: () => void; action?: ReactNode;
  tone?: keyof typeof TONES;
}) {
  const colours = TONES[tone];
  return (
    <div className={`group relative flex w-full items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 transition dark:border-gray-800 dark:bg-gray-900 ${colours.card}`}>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2.5">
          <button
            type="button"
            onClick={onOpen}
            aria-label={openLabel}
            className={`text-left text-sm font-bold after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none ${colours.label}`}
          >
            {label}
          </button>
          {note && <span className="text-xs text-gray-500 dark:text-gray-400">{note}</span>}
        </span>
        <span className="mt-1.5 block font-serif text-[17px] leading-relaxed text-gray-800 dark:text-gray-200">
          {words ?? <span className="font-sans text-sm text-gray-500 dark:text-gray-400">{loadingWords}</span>}
        </span>
      </span>
      {action}
      <ChevronRight className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gray-400 dark:text-gray-500" strokeWidth={2} aria-hidden="true" />
    </div>
  );
}
