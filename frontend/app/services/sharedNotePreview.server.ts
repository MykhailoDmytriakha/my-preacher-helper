import { detectTextLocale } from '@/utils/appLocale';
import { buildSharedNotePreview } from '@/utils/sharedNotePreview';
import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';
import { studyNoteShareLinksRepository } from '@repositories/studyNoteShareLinks.repository';

import type { AppLocale } from '@/utils/appLocale';
import type { SharedNotePreview, SharedNotePreviewWords } from '@/utils/sharedNotePreview';

const TRANSLATIONS = { en, ru, uk };

function previewWords(locale: AppLocale): SharedNotePreviewWords {
  const { studiesWorkspace } = TRANSLATIONS[locale];
  return {
    note: studiesWorkspace.type.note,
    question: studiesWorkspace.type.question,
    untitled: studiesWorkspace.untitled,
  };
}

export interface SharedNotePreviewResult extends SharedNotePreview {
  locale: AppLocale;
}

/**
 * The preview of a shared note, or `null` when the link does not open a note. Reads through
 * `readSharedNote` — the one place that decides what a token makes public — and never counts a
 * view: messengers fetch the preview on their own, and that is not a person reading the note.
 *
 * The card speaks the language the note is written in, read off the text itself: the people a
 * Ukrainian note is sent to read Ukrainian, whatever language the author's own screens are in,
 * and the note is the one thing the link already has in hand.
 */
export async function readSharedNotePreview(token: string): Promise<SharedNotePreviewResult | null> {
  try {
    // A messenger fetches a card once and keeps it; one passing database error should not
    // decide what a link looks like for good, so a failed read gets a second try.
    const shared = await studyNoteShareLinksRepository.readSharedNote(token).catch((error: unknown) => {
      console.warn('readSharedNotePreview: retrying after a failed read', error);
      return studyNoteShareLinksRepository.readSharedNote(token);
    });
    if (!shared) return null;
    const locale = detectTextLocale(`${shared.title ?? ''}\n${shared.content}`);
    return { ...buildSharedNotePreview(shared, locale, previewWords(locale)), locale };
  } catch (error) {
    console.error('readSharedNotePreview failed', error);
    return null;
  }
}
