'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { AnalysisIcon } from '@/components/Icons';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { refusalMessage } from '@/utils/actionFailureMessage';
import { useTranslation } from '@locales/useTranslation';


import { PassagePickBar } from '../verseCopy/PassagePickBar';
import { VerseCopyBar, type VerseWriting } from '../verseCopy/VerseCopyBar';

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
export function ReaderAnalysis({ copy, text, wide, bookId, bible, locale, opening, onOpening, marks, onOpenScreen, onUseBible, onWrite }: {
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
  /** The chosen verses' bar writes a comment or a paragraph on them: the reader's comment window. */
  onWrite?: (kind: VerseWriting, passage: PickedPassage) => void;
}) {
  const { t } = useTranslation();
  const { uid } = useResolvedUid();
  const scope = JSON.stringify([uid, bookId, bible]);
  const currentScope = useRef<string | null>(scope);
  useLayoutEffect(() => { currentScope.current = scope; return () => { currentScope.current = null; }; }, [scope]);
  const capturing = useRef(new Set<string>());
  const [busyScopes, setBusyScopes] = useState<ReadonlySet<string>>(() => new Set());
  const busy = busyScopes.has(scope);
  const choosing = copy.purpose === 'analysis' && text;
  // The analysis whose verses are being chosen again, if any; a choice let go of lets it go.
  const [reshaping, setReshaping] = useState<string | null>(null);
  useEffect(() => { setReshaping(null); }, [scope]);
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
    if (capturing.current.has(scope)) return;
    const source = reshaping;
    if (!source) { copy.clear(); onOpening({ kind: 'new', passage }); return; }
    capturing.current.add(scope); setBusyScopes(new Set(capturing.current));
    try {
      const said = await reshape(source, passage);
      if (currentScope.current !== scope) return;
      if (!said) { toast(t('analysis.reshape.apart')); return; }
      copy.clear();
      toast(t('analysis.reshape.prepared'));
      onOpening({ kind: 'open', id: source, editing: true });
    } catch (error) {
      if (currentScope.current === scope) toast.error(refusalMessage(error, t, 'common.saveError'));
    } finally {
      capturing.current.delete(scope);
      if (currentScope.current !== null) setBusyScopes(new Set(capturing.current));
    }
  };
  return (
    <>
      {/* Verses chosen for a comment have the comment's own bar (`ReaderCommentDialog.tsx`). */}
      {choosing ? (
        <PassagePickBar copy={copy} wide={wide} onOpen={open} busy={busy} action={t(reshaping ? 'analysis.pick.apply' : 'analysis.pick.open')} icon={<AnalysisIcon className="h-5 w-5" />} cancelLabel={t('analysis.pick.cancel')} />
      ) : copy.purpose === 'comment' ? null : <VerseCopyBar copy={copy} wide={wide} text={text} onWrite={onWrite} onAnalyse={(passage) => { copy.clear(); onOpening({ kind: 'new', passage }); }} />}
      {opening && text ? <AnalysisEditor opening={opening} text={text} bookId={bookId} bible={bible} locale={locale} marks={marks} onClose={() => onOpening(null)} onEditVerses={editVerses} door={ANALYSES_DOOR} onOpenScreen={onOpenScreen} onUseBible={onUseBible} /> : null}
    </>
  );
}
