'use client';

import { SCRIPTURE_LINK_CLASSES, SCRIPTURE_LINK_MARK, useScriptureLinks, WrittenInMark } from '@/components/bible/ScriptureLinks';

import type { LeadingReference } from '@/utils/bibleLink';

interface ScriptureOpeningProps {
  /** The verse as the person wrote it. */
  text: string;
  /** The reference the text opens with (`leadingReference`), or null when it names none. */
  reference?: LeadingReference | null;
  /** Where the screen opens references nowhere (no `ScriptureLinks` around): the address into the Bible, and the reference itself. */
  onOpen?: (href: string, opening: LeadingReference) => void;
}

/**
 * A sermon's verse as words, its opening reference a link: "1 Пар. 4:9–10" opens the way every
 * reference on the screen opens (`ScriptureLinks` — over the page, or over a meeting), else through
 * `onOpen`; the words after it stay words. Plain text when there is no reference or no way to open
 * it. The sermon header, the plan header and the preaching view show the verse through this one piece.
 */
export default function ScriptureOpening({ text, reference = null, onOpen }: ScriptureOpeningProps) {
  const links = useScriptureLinks();
  if (!reference || (!links && !onOpen)) return <>{text}</>;
  const open = () => {
    if (links) links.onOpen({ ...reference.reference, label: text.slice(0, reference.end) });
    else onOpen?.(reference.href, reference);
  };
  return (
    <>
      <button
        type="button"
        onClick={open}
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
