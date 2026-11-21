'use client';

import { useTranslation } from '@locales/useTranslation';

import { partsOf, type BookGroup } from './bookOrder';

import type { ReactNode } from 'react';

/**
 * A group's books as the lists show them — the Bible page's and the reader's window: one flowing row, a split group
 * part after part (Philemon among the letters from prison), each part in its colour. Colour is for the eye; for a
 * screen reader each part is a list of its own under its name — `contents` keeps the row one flow. Reading — "next
 * book", `bookSequence` — keeps the order the Bible prints (owner, 2026-11-21, canvas «Библия — группы книг»).
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
    <div className="flex flex-wrap gap-1.5">
      {parts.map((part, index) => (
        // role="list": WebKit hears an unmarked list (Preflight takes the markers) as a group (Codex, 2026-11-21).
        // eslint-disable-next-line jsx-a11y/no-redundant-roles
        <ul key={part.key} role="list" aria-label={t(`bible.bookParts.${part.key}.name`)} className="contents">
          {part.ids.map((bookId) => <li key={bookId}>{renderBook(bookId, index)}</li>)}
        </ul>
      ))}
    </div>
  );
}
