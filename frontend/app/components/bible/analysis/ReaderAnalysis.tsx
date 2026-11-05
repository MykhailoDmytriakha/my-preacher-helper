'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { AnalysisIcon } from '@/components/Icons';

import { PassagePickBar } from '../verseCopy/PassagePickBar';
import { VerseCopyBar } from '../verseCopy/VerseCopyBar';

import { analysesListHref, readAnalysisAddress, readNewAnalysisStep } from './analysisAddress';
import { AnalysisEditor, type AnalysisOpening } from './AnalysisEditor';
import { useAnalysisReshape } from './useAnalysisReshape';

import type { AnalysisDoor } from './AnalysisParts';
import type { AnalysisMarks } from './useAnalysisMarks';
import type { PickedPassage } from '../verseCopy/passagePick';
import type { VerseCopy } from '../verseCopy/useVerseCopy';
import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';
import type { BookText } from '@/utils/bibleText';

/** The analysis's other home from the reader: Studies' list of analyses, opened at it. */
const ANALYSES_DOOR: AnalysisDoor = { home: 'analyses', href: analysesListHref };

/**
 * WHAT THE READER SHOWS FOR CHOSEN VERSES AND FOR AN ANALYSIS (case 2026-10-12-block-diagram, 3.4): the copy bar, or —
 * when the verses are chosen for an analysis — the analysis bar; and the analysis screen over the text once it is open.
 * The analysis's verses are changed by choosing them again, its own chosen to start with (the owner, 2026-10-29). Its door
 * «Все разборы» leads to Studies' list opened at it, and Back returns to it open over the text (the owner, 03.11).
 */
export function ReaderAnalysis({ copy, text, wide, bookId, bible, locale, opening, onOpening, marks, onOpenScreen, onUseBible }: {
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
  /** An analysis made in another Bible: the reader turns to that Bible (`OtherBibleNotice`). */
  onUseBible?: (bible: BibleId) => void;
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
  // Forward onto an analysis's step opens it again; Back off it is the screen's own business (`useAnalysisAddress`). A jump
  // from one analysis's step to another's opens the other once the one left has closed (Codex, 04.11).
  const now = useRef({ opening, onOpening, text });
  now.current = { opening, onOpening, text };
  useEffect(() => {
    let after: ReturnType<typeof setTimeout> | undefined;
    const moved = () => {
      clearTimeout(after);
      after = setTimeout(() => {
        if (now.current.opening || !now.current.text) return;
        const named = readAnalysisAddress();
        if (named) { now.current.onOpening({ kind: 'open', id: named.id, editing: named.mode === 'edit' }); return; }
        // A new analysis's step, before it had a note: it opens again on the passage it was begun on.
        const begun = readNewAnalysisStep();
        if (begun) now.current.onOpening({ kind: 'new', passage: begun });
      }, 0);
    };
    window.addEventListener('popstate', moved);
    return () => { window.removeEventListener('popstate', moved); clearTimeout(after); };
  }, []);
  const editVerses = (id: string | null, passage: PickedPassage) => {
    onOpening(null);
    copy.startPassage({ chapter: passage.chapter, verse: passage.fromVerse }, { chapter: passage.toChapter, verse: passage.toVerse });
    setReshaping(id);
  };
  const open = async (passage: PickedPassage) => {
    copy.clear();
    if (!reshaping) { onOpening({ kind: 'new', passage }); return; }
    const outcome = await reshape(reshaping, passage);
    if (!outcome) toast(t('analysis.reshape.apart'));
    else if (outcome.kind === 'refused') toast.error(t('analysis.reshape.refused'));
    else toast.success(outcome.said);
    onOpening({ kind: 'open', id: reshaping, editing: true });
  };
  return (
    <>
      {/* Verses chosen for a comment have the comment's own bar (`ReaderCommentDialog.tsx`). */}
      {choosing ? (
        <PassagePickBar copy={copy} wide={wide} onOpen={open} action={t(reshaping ? 'analysis.pick.apply' : 'analysis.pick.open')} icon={<AnalysisIcon className="h-5 w-5" />} cancelLabel={t('analysis.pick.cancel')} />
      ) : copy.purpose === 'comment' ? null : <VerseCopyBar copy={copy} wide={wide} />}
      {opening && text ? <AnalysisEditor opening={opening} text={text} bookId={bookId} bible={bible} locale={locale} marks={marks} onClose={() => onOpening(null)} onEditVerses={editVerses} door={ANALYSES_DOOR} onOpenScreen={onOpenScreen} onUseBible={onUseBible} /> : null}
    </>
  );
}
