'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { VerseCopyBar } from '../verseCopy/VerseCopyBar';

import { readAnalysisAddress } from './analysisAddress';
import { AnalysisEditor, type AnalysisOpening } from './AnalysisEditor';
import { AnalysisPickBar } from './AnalysisPickBar';
import { useAnalysisReshape } from './useAnalysisReshape';

import type { AnalysisMarks } from './useAnalysisMarks';
import type { PickedPassage } from '../verseCopy/passagePick';
import type { VerseCopy } from '../verseCopy/useVerseCopy';
import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';
import type { BookText } from '@/utils/bibleText';

/**
 * WHAT THE READER SHOWS FOR CHOSEN VERSES AND FOR AN ANALYSIS (case 2026-10-12-block-diagram, 3.4): the copy bar, or —
 * when the verses are chosen for an analysis — the analysis bar; and the analysis screen over the text once it is open.
 * The analysis's verses are changed by choosing them again, its own chosen to start with (the owner, 2026-10-29).
 */
export function ReaderAnalysis({ copy, text, wide, bookId, bible, locale, opening, onOpening, marks, onOpenScreen }: {
  copy: VerseCopy;
  text: BookText | null;
  wide: boolean;
  bookId: string;
  bible: BibleId;
  locale: AppLocale;
  opening: AnalysisOpening | null;
  onOpening: (opening: AnalysisOpening | null) => void;
  /** The reader's marks of the book, painted and made in the analysis too. */
  marks?: AnalysisMarks | null;
  /** Another screen of the app opened from an analysis (a sermon made from it), the reader's way. */
  onOpenScreen?: (href: string) => void;
}) {
  const { t } = useTranslation();
  const choosing = copy.purpose === 'analysis' && text;
  // The analysis whose verses are being chosen again, if any; a choice let go of lets it go.
  const [reshaping, setReshaping] = useState<string | null>(null);
  useEffect(() => { if (!copy.picking) setReshaping(null); }, [copy.picking]);
  const reshape = useAnalysisReshape({ text, bookId, bible, locale });
  // An analysis the address names — a reload while it was open — opens again, in the mode it was in.
  const fromAddress = useRef(true);
  useEffect(() => {
    if (!fromAddress.current || !text) return;
    fromAddress.current = false;
    const named = readAnalysisAddress();
    if (named && !opening) onOpening({ kind: 'open', id: named.id, editing: named.mode === 'edit' });
  }, [onOpening, opening, text]);
  const editVerses = (id: string | null, passage: PickedPassage) => {
    onOpening(null);
    copy.startPassage({ chapter: passage.chapter, verse: passage.fromVerse }, { chapter: passage.toChapter, verse: passage.toVerse });
    setReshaping(id);
  };
  const open = (passage: PickedPassage) => {
    copy.clear();
    if (!reshaping) { onOpening({ kind: 'new', passage }); return; }
    const said = reshape(reshaping, passage);
    if (said) toast.success(said); else toast(t('analysis.reshape.apart'));
    onOpening({ kind: 'open', id: reshaping, editing: true });
  };
  return (
    <>
      {choosing
        ? <AnalysisPickBar copy={copy} wide={wide} onOpen={open} action={reshaping ? t('analysis.pick.apply') : undefined} />
        : <VerseCopyBar copy={copy} wide={wide} />}
      {opening && text ? <AnalysisEditor opening={opening} text={text} bookId={bookId} bible={bible} locale={locale} marks={marks} onClose={() => onOpening(null)} onEditVerses={editVerses} onOpenScreen={onOpenScreen} /> : null}
    </>
  );
}
