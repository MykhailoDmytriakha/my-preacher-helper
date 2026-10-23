'use client';

import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import type { BibleId } from '@/utils/bibles';

/**
 * «КАК ИСКАТЬ»: the ways to search, each with an example that is tapped to try it at once (the owner,
 * 2026-10-22: show how a search can be written — not how to dictate). The formula leads: where first,
 * then what. The examples are in the language of the Bible being read, so each one finds something.
 * The sign of an example (* _ ") is drawn in the accent: it is what the row teaches.
 */
type Row = { example: string; describe: string; values?: Record<string, string> };

const SIGNED = /([*_"])/;

function Example({ text, touch, onTry }: { text: string; touch: boolean; onTry: (text: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onTry(text)}
      className={`inline-flex max-w-full items-center whitespace-nowrap rounded-md bg-gray-100 text-sm font-medium text-gray-900 transition hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 ${touch ? 'h-11 px-3' : 'h-7 px-2'}`}
    >
      {text.split(SIGNED).filter(Boolean).map((piece, index) => (SIGNED.test(piece)
        ? <span key={index} className="text-[1.1em] font-semibold text-indigo-600 dark:text-indigo-300">{piece}</span>
        : <span key={index}>{piece}</span>))}
    </button>
  );
}

export function SearchHelp({ bible, columns, touch, onTry }: { bible: BibleId; columns: 1 | 2; touch: boolean; onTry: (text: string) => void }) {
  const { t } = useTranslation();
  const example = (kind: string) => t(`bible.search.examples.${bible}.${kind}`);
  const describe = (row: Row) => t(`bible.search.describe.${row.describe}`, row.values);
  const sections: Array<{ title: string; rows: Row[]; note?: string }> = [
    {
      title: t('bible.search.sections.where'),
      rows: [
        { example: example('book'), describe: 'book' },
        { example: example('chapter'), describe: 'chapter' },
        { example: example('passage'), describe: 'passage' },
        { example: example('testament'), describe: 'testament', values: { nt: example('nt'), ot: example('ot') } },
        { example: example('gospels'), describe: 'gospels' },
        { example: example('prophets'), describe: 'prophets' },
        { example: example('epistles'), describe: 'epistles' },
      ],
    },
    // Without typing: the reader's windows go book → chapter → verse a press a step, and a hold opens at once.
    { title: t('bible.search.sections.open'), rows: [{ example: example('verse'), describe: 'verse' }, { example: example('wholeChapter'), describe: 'wholeChapter' }], note: t('bible.search.byFingerNote') },
    { title: t('bible.search.sections.words'), rows: [{ example: example('allWords'), describe: 'allWords' }], note: t('bible.search.formsNote', { forms: example('forms') }) },
    {
      title: t('bible.search.sections.exact'),
      rows: [
        { example: example('phrase'), describe: 'phrase' },
        { example: example('star'), describe: 'star', values: { forms: example('starForms') } },
        { example: example('letter'), describe: 'letter', values: { forms: example('letterForms') } },
      ],
    },
  ];
  const groups = columns === 2 ? [sections.slice(0, 1), sections.slice(1)] : [sections];

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 border-b border-gray-100 pb-2.5 dark:border-gray-800">
        <h2 className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-white">{t('bible.search.help')}</h2>
        <span className="text-xs text-gray-400 dark:text-gray-500">{t('bible.search.helpTip')}</span>
      </div>
      <div className={columns === 2 ? 'grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-x-10' : ''}>
        {groups.map((group, column) => (
          <div key={column} className="min-w-0">
            {group.map((section) => (
              <section key={section.title} className="pt-3.5">
                <h3 className="pb-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400">{section.title}</h3>
                {/* One grid per section: its examples line up, as wide as the longest of them. */}
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5">
                  {section.rows.map((row) => (
                    <Fragment key={row.example}>
                      <span className="min-w-0"><Example text={row.example} touch={touch} onTry={onTry} /></span>
                      <span className="text-[13px] leading-snug text-gray-500 dark:text-gray-400">{describe(row)}</span>
                    </Fragment>
                  ))}
                </div>
                {section.note ? <p className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{section.note}</p> : null}
              </section>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
