'use client';

import { useTranslation } from '@locales/useTranslation';

import { linesOf, partsOf, type BookGroup } from './bookOrder';

import type { ReactNode } from 'react';

/**
 * A group's books as the lists show them — the Bible page's and the reader's window. A split group goes part after
 * part (Philemon among the letters from prison), each part in its colour and kept whole. Lines are the owner's: a part
 * starts a new line unless it joins the one before (`linesOf`: 1 Kings, Ezra, Hosea, 1 John, Ephesians,
 * 1 Thessalonians, 1 Timothy begin lines; Jude follows 3 John, Hebrews follows Titus — owner, 2026-11-21). Within a
 * line parts stand a little further apart than books (12 px against 6), as on the canvas board «Итог»; a line wider
 * than the card wraps, a part keeping its books together. For a screen reader each part is a list under its name.
 * Reading — "next book", `bookSequence` — keeps the order the Bible prints.
 */
export function GroupBooks({ group, renderBook }: { group: BookGroup; renderBook: (bookId: string, part: number | null) => ReactNode }) {
  const { t } = useTranslation();
  const parts = partsOf(group);
  if (!parts) {
    return (
      <ul className="flex flex-wrap gap-1.5">
        {group.ids.map((bookId) => <li key={bookId}>{renderBook(bookId, null)}</li>)}
      </ul>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {linesOf(parts).map((line) => (
        <div key={line[0].key} className="flex flex-wrap gap-x-3 gap-y-1.5">
          {line.map((part) => {
            const tone = parts.indexOf(part);
            return (
              // role="list": WebKit hears an unmarked list (Preflight takes the markers) as a group (Codex, 2026-11-21).
              // eslint-disable-next-line jsx-a11y/no-redundant-roles
              <ul key={part.key} role="list" aria-label={t(`bible.bookParts.${part.key}.name`)} className="flex flex-wrap gap-1.5">
                {part.ids.map((bookId) => <li key={bookId}>{renderBook(bookId, tone)}</li>)}
              </ul>
            );
          })}
        </div>
      ))}
    </div>
  );
}
