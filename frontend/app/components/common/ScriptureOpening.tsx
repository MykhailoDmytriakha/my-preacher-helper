'use client';

import { SCRIPTURE_LINK_CLASSES, SCRIPTURE_LINK_MARK, WrittenInMark } from '@/components/bible/ScriptureLinks';

import type { LeadingReference } from '@/utils/bibleLink';

interface ScriptureOpeningProps {
  /** The verse as the person wrote it. */
  text: string;
  /** The reference the text opens with (`leadingReference`), or null when it names none. */
  reference?: LeadingReference | null;
  /** The address into the Bible, and the reference itself for a screen that shows it in place. */
  onOpen?: (href: string, opening: LeadingReference) => void;
}

/**
 * A sermon's verse as words, its opening reference a link into the Bible: "1 Пар. 4:9–10" opens
 * the Bible there, the words after it stay words. Plain text when there is no reference or no way
 * to open it. The sermon header and the plan header show the verse through this one piece.
 */
export default function ScriptureOpening({ text, reference = null, onOpen }: ScriptureOpeningProps) {
  if (!reference || !onOpen) return <>{text}</>;
  return (
    <>
      <button
        type="button"
        onClick={() => onOpen(reference.href, reference)}
        className={SCRIPTURE_LINK_CLASSES}
        {...{ [SCRIPTURE_LINK_MARK]: '' }}
      >
        {text.slice(0, reference.end)}
      </button>
      {reference.writtenIn ? <WrittenInMark bible={reference.writtenIn} /> : null}
      {text.slice(reference.end)}
    </>
  );
}
