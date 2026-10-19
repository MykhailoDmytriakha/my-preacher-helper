import { bookSlug } from './bibleText';

import type { BibleId } from './bibles';

/** One marks document per owner, Bible and book across all devices. */
export const marksDocumentId = (owner: string, bible: BibleId, bookId: string) => `${owner}_${bible}_${bookSlug(bookId)}`;
