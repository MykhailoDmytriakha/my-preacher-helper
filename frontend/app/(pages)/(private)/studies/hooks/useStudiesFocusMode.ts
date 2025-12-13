'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback, useMemo } from 'react';

import { StudyNote } from '@/models/models';

interface UseStudiesFocusModeProps {
  visibleNotes: StudyNote[];
}

interface UseStudiesFocusModeReturn {
  focusedNoteId: string | null;
  focusedNote: StudyNote | null;
  focusedIndex: number;
  totalCount: number;
  enterFocus: (noteId: string) => void;
  exitFocus: () => void;
  goToNext: () => void;
  goToPrev: () => void;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Hook for managing Focus Mode in Studies workspace.
 * Syncs focus state with URL params while preserving search/filter context.
 */
export const useStudiesFocusMode = ({
  visibleNotes,
}: UseStudiesFocusModeProps): UseStudiesFocusModeReturn => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Read focus param from URL - this is our single source of truth
  const focusedNoteId = searchParams?.get('focus') ?? null;

  // Build URL with updated params
  const buildUrlWithParams = useCallback(
    (params: URLSearchParams) => {
      const query = params.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [pathname]
  );

  // Find focused note and index in visible notes
  const focusedIndex = useMemo(() => {
    if (!focusedNoteId) return -1;
    return visibleNotes.findIndex((note) => note.id === focusedNoteId);
  }, [focusedNoteId, visibleNotes]);

  const focusedNote = useMemo(() => {
    if (focusedIndex === -1) return null;
    return visibleNotes[focusedIndex] ?? null;
  }, [focusedIndex, visibleNotes]);

  const totalCount = visibleNotes.length;
  const hasNext = focusedIndex >= 0 && focusedIndex < totalCount - 1;
  const hasPrev = focusedIndex > 0;

  // Enter focus mode for a specific note
  const enterFocus = useCallback(
    (noteId: string) => {
      // Update URL, preserving existing params (search query, filters)
      const newParams = new URLSearchParams(searchParams?.toString() ?? '');
      newParams.set('focus', noteId);
      router.push(buildUrlWithParams(newParams), { scroll: false });
    },
    [searchParams, buildUrlWithParams, router]
  );

  // Exit focus mode
  const exitFocus = useCallback(() => {
    // Remove focus param from URL, preserve other params
    const newParams = new URLSearchParams(searchParams?.toString() ?? '');
    newParams.delete('focus');
    router.push(buildUrlWithParams(newParams), { scroll: false });
  }, [searchParams, buildUrlWithParams, router]);

  // Navigate to next note in filtered list
  const goToNext = useCallback(() => {
    if (!hasNext) return;
    const nextNote = visibleNotes[focusedIndex + 1];
    if (nextNote) {
      enterFocus(nextNote.id);
    }
  }, [hasNext, focusedIndex, visibleNotes, enterFocus]);

  // Navigate to previous note in filtered list
  const goToPrev = useCallback(() => {
    if (!hasPrev) return;
    const prevNote = visibleNotes[focusedIndex - 1];
    if (prevNote) {
      enterFocus(prevNote.id);
    }
  }, [hasPrev, focusedIndex, visibleNotes, enterFocus]);

  // Keyboard navigation
  useEffect(() => {
    if (!focusedNoteId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          exitFocus();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          goToPrev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          goToNext();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [focusedNoteId, exitFocus, goToPrev, goToNext]);

  return {
    focusedNoteId,
    focusedNote,
    focusedIndex,
    totalCount,
    enterFocus,
    exitFocus,
    goToNext,
    goToPrev,
    hasNext,
    hasPrev,
  };
};

