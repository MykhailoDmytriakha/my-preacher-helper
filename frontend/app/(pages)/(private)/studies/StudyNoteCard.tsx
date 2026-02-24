'use client';

import {
  BookmarkIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LinkIcon,
  PencilIcon,
  QuestionMarkCircleIcon,
  TagIcon,
  DocumentDuplicateIcon,
} from '@heroicons/react/24/outline';
import { useRouter } from 'next/navigation';
import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useClipboard } from '@/hooks/useClipboard';
import { StudyNote } from '@/models/models';
import { extractSearchSnippets } from '@/utils/searchUtils';
import { formatStudyNoteForCopy } from '@/utils/studyNoteUtils';
import { UI_COLORS } from '@/utils/themeColors';
import HighlightedText from '@components/HighlightedText';
import MarkdownDisplay from '@components/MarkdownDisplay';

import { getLocalizedBookName, BibleLocale, psalmHebrewToSeptuagint } from './bibleData';


interface StudyNoteCardProps {
  note: StudyNote;
  bibleLocale: BibleLocale;
  isExpanded: boolean;
  onEdit: (note: StudyNote) => void;
  searchQuery?: string;
  onShare?: (note: StudyNote) => void;
  /** Whether this note has an active share link */
  hasShareLink?: boolean;
}

const SNIPPET_CONTAINER_CLASS = [
  'rounded-lg border px-3 py-3 space-y-3 shadow-sm',
  UI_COLORS.neutral.bg,
  `dark:${UI_COLORS.neutral.darkBg}`,
  UI_COLORS.neutral.border,
  `dark:${UI_COLORS.neutral.darkBorder}`,
].join(' ');

const MATCH_COUNT_BADGE = [
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
  UI_COLORS.accent.bg,
  `dark:${UI_COLORS.accent.darkBg}`,
  UI_COLORS.accent.text,
  `dark:${UI_COLORS.accent.darkText}`,
  'shadow-inner',
].join(' ');

const CONTENT_SECTION_CLASS = [
  'space-y-2 rounded-md border px-3 py-2',
  UI_COLORS.neutral.bg,
  `dark:${UI_COLORS.neutral.darkBg}`,
  UI_COLORS.neutral.border,
  `dark:${UI_COLORS.neutral.darkBorder}`,
].join(' ');

const CONTENT_SNIPPET_CLASS = [
  'rounded-md border border-l-4 px-3 py-2 shadow-sm bg-white/90 dark:bg-gray-900/40',
  UI_COLORS.success.border,
  `dark:${UI_COLORS.success.darkBorder}`,
].join(' ');

const METADATA_CARD_CLASS = [
  'space-y-2 rounded-md border px-3 py-2',
  UI_COLORS.neutral.bg,
  `dark:${UI_COLORS.neutral.darkBg}`,
  UI_COLORS.neutral.border,
  `dark:${UI_COLORS.neutral.darkBorder}`,
].join(' ');

const TAG_CHIP_CLASS = [
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border',
  UI_COLORS.neutral.bg,
  `dark:${UI_COLORS.neutral.darkBg}`,
  UI_COLORS.neutral.text,
  `dark:${UI_COLORS.neutral.darkText}`,
  UI_COLORS.neutral.border,
  `dark:${UI_COLORS.neutral.darkBorder}`,
].join(' ');

const REF_CHIP_CLASS = [
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border',
  UI_COLORS.success.bg,
  `dark:${UI_COLORS.success.darkBg}`,
  UI_COLORS.success.text,
  `dark:${UI_COLORS.success.darkText}`,
  UI_COLORS.success.border,
  `dark:${UI_COLORS.success.darkBorder}`,
].join(' ');

const ALERT_CLASS = [
  'rounded-md border px-3 py-2 text-xs font-medium',
  UI_COLORS.danger.bg,
  `dark:${UI_COLORS.danger.darkBg}`,
  UI_COLORS.danger.text,
  `dark:${UI_COLORS.danger.darkText}`,
  UI_COLORS.danger.border,
  `dark:${UI_COLORS.danger.darkBorder}`,
].join(' ');

export default function StudyNoteCard({
  note,
  bibleLocale,
  isExpanded,
  onEdit,
  searchQuery = '',
  onShare,
  hasShareLink = false,
}: StudyNoteCardProps) {
  const { t } = useTranslation();
  const router = useRouter();

  // Clipboard functionality
  const clipboardResult = useClipboard({
    successDuration: 1500,
  });
  const { isCopied, copyToClipboard } = clipboardResult || { isCopied: false, copyToClipboard: () => { } };

  // Handle copying note data
  const handleCopyNote = async () => {
    const markdownContent = formatStudyNoteForCopy(note, bibleLocale);
    await copyToClipboard(markdownContent);
  };

  const handleShareNote = () => {
    if (!onShare) return;
    onShare(note);
  };

  // Format relative time
  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return t('common.today');
    if (diffDays === 1) return t('common.yesterday');
    if (diffDays < 7) return t('common.daysAgo', { count: diffDays });
    if (diffDays < 30) return t('common.weeksAgo', { count: Math.floor(diffDays / 7) });
    return date.toLocaleDateString();
  };

  // Check if note needs AI analysis (no title, no refs, no tags)

  // Format scripture reference for display
  const formatRef = useCallback((ref: {
    book: string;
    chapter?: number;
    toChapter?: number;
    fromVerse?: number;
    toVerse?: number
  }) => {
    // Get display chapter for Psalms (convert Hebrew to Septuagint for ru/uk)
    const getDisplayChapter = (book: string, chapter: number) => {
      if (book === 'Psalms' && (bibleLocale === 'ru' || bibleLocale === 'uk')) {
        return psalmHebrewToSeptuagint(chapter);
      }
      return chapter;
    };

    const bookName = getLocalizedBookName(ref.book, bibleLocale);

    // Book-only reference
    if (ref.chapter === undefined) {
      return bookName;
    }

    const chapter = getDisplayChapter(ref.book, ref.chapter);

    // Chapter range (e.g., Matthew 5-7)
    if (ref.toChapter !== undefined) {
      const toChapter = getDisplayChapter(ref.book, ref.toChapter);
      return `${bookName} ${chapter}-${toChapter}`;
    }

    // Chapter-only reference (e.g., Romans 8)
    if (ref.fromVerse === undefined) {
      return `${bookName} ${chapter}`;
    }

    // Verse or verse range
    const verses = ref.toVerse ? `${ref.fromVerse}-${ref.toVerse}` : `${ref.fromVerse}`;
    return `${bookName} ${chapter}:${verses}`;
  }, [bibleLocale]);

  const searchTokens = useMemo(
    () => (searchQuery ? searchQuery.toLowerCase().split(/\s+/).filter(Boolean) : []),
    [searchQuery]
  );


  const contentMatches = useMemo(() => {
    if (!searchTokens.length) return false;
    const lowered = note.content?.toLowerCase() || '';
    return searchTokens.some((token) => lowered.includes(token));
  }, [note.content, searchTokens]);

  const contentSnippets = useMemo(() => {
    if (!contentMatches || !searchQuery) return [];
    // Use the first token (or the full query) to build the snippet window
    const token = searchTokens[0] || searchQuery;
    return extractSearchSnippets(note.content, token, 300);
  }, [contentMatches, note.content, searchQuery, searchTokens]);

  const matchingTags = useMemo(
    () =>
      searchTokens.length === 0
        ? []
        : note.tags.filter((tag) => {
          const lowered = tag.toLowerCase();
          return searchTokens.some((token) => lowered.includes(token));
        }),
    [note.tags, searchTokens]
  );

  const matchingRefs = useMemo(
    () =>
      searchTokens.length === 0
        ? []
        : note.scriptureRefs.filter((ref) => {
          const lowered = formatRef(ref).toLowerCase();
          return searchTokens.some((token) => lowered.includes(token));
        }),
    [note.scriptureRefs, searchTokens, formatRef]
  );

  const titleMatches = useMemo(
    () => {
      if (searchTokens.length === 0) return false;
      const lowered = (note.title || '').toLowerCase();
      return searchTokens.some((token) => lowered.includes(token));
    },
    [note.title, searchTokens]
  );

  const hasAnyMatch =
    contentMatches || matchingTags.length > 0 || matchingRefs.length > 0 || titleMatches;
  const totalMatchSignals =
    contentSnippets.length + matchingTags.length + matchingRefs.length + (titleMatches ? 1 : 0);
  const hasSearchDetails =
    contentSnippets.length > 0 || matchingTags.length > 0 || matchingRefs.length > 0 || !hasAnyMatch;

  return (
    <article
      className={`
        rounded-xl border bg-white shadow-sm transition-all duration-200
        dark:bg-gray-800
        ${isExpanded
          ? note.type === 'question'
            ? 'border-amber-200 dark:border-amber-700'
            : 'border-emerald-200 dark:border-emerald-700'
          : note.type === 'question'
            ? 'border-amber-100 dark:border-amber-900/50 hover:border-amber-200 dark:hover:border-amber-800'
            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
        }
      `}
    >
      {/* Header row: main content is clickable, actions live beside title */}
      <div className="flex w-full items-start gap-3 p-4">
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            router.push(`/studies/${note.id}${window.location.search}`);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const target = e.target as HTMLElement | null;
            if (target?.closest('button')) return;
            e.preventDefault();
            router.push(`/studies/${note.id}${window.location.search}`);
          }}
          className="flex flex-1 items-start gap-3 text-left cursor-pointer"
          aria-expanded={isExpanded}
        >
          {/* Chevron */}
          <div className="mt-0.5 flex-shrink-0 text-gray-400 dark:text-gray-500">
            {isExpanded ? (
              <ChevronDownIcon className="h-5 w-5" />
            ) : (
              <ChevronRightIcon className="h-5 w-5" />
            )}
          </div>

          {/* Content preview */}
          <div className="min-w-0 flex-1">
            {/* Title */}
            <div className="flex items-start gap-2">
              {note.type === 'question' && (
                <span className="mt-0.5 shrink-0 inline-flex items-center rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-900/40 dark:text-amber-300 dark:ring-amber-500/30">
                  <QuestionMarkCircleIcon className="mr-1 h-3.5 w-3.5" />
                  {t('studiesWorkspace.type.question') || 'Question'}
                </span>
              )}
              <h4 className="flex-1 text-base font-semibold text-gray-900 dark:text-gray-50 line-clamp-3 leading-tight">
                {searchQuery ? (
                  <HighlightedText
                    text={note.title || t('studiesWorkspace.untitled')}
                    searchQuery={searchQuery}
                  />
                ) : (
                  note.title || t('studiesWorkspace.untitled')
                )}
              </h4>
              {searchQuery && totalMatchSignals > 0 && !isExpanded && (
                <span className={`${MATCH_COUNT_BADGE} shrink-0`}>
                  {totalMatchSignals} {t('studiesWorkspace.matchingNotes')}
                </span>
              )}
              <div className="ml-2 flex flex-wrap sm:flex-nowrap items-center justify-end gap-1 shrink-0">
                {onShare && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleShareNote();
                    }}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition disabled:opacity-50 ${hasShareLink
                      ? 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-300'
                      : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200'
                      }`}
                    title={t('studiesWorkspace.shareLinks.shareButton')}
                    aria-label={t('studiesWorkspace.shareLinks.shareButton')}
                  >
                    <LinkIcon className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopyNote();
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                  title={isCopied ? t('common.copied', 'Copied!') : t('common.copy', 'Copy')}
                >
                  {isCopied ? (
                    <CheckIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
                  ) : (
                    <DocumentDuplicateIcon className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Preview text (collapsed only) */}
            {!isExpanded && (
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {searchQuery ? (
                  hasSearchDetails ? (
                    <div className={SNIPPET_CONTAINER_CLASS}>
                      {contentSnippets.length > 0 && (
                        <div className={CONTENT_SECTION_CLASS}>
                          <div className="flex justify-end text-xs font-semibold text-gray-700 dark:text-gray-200">
                            <span className={MATCH_COUNT_BADGE}>{contentSnippets.length}</span>
                          </div>
                          <div className="space-y-6">
                            {contentSnippets.map((snippet, index) => (
                              <div key={index} className={CONTENT_SNIPPET_CLASS}>
                                <MarkdownDisplay content={snippet} compact searchQuery={searchQuery} />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {(matchingTags.length > 0 || matchingRefs.length > 0) && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {matchingTags.length > 0 && (
                            <div className={METADATA_CARD_CLASS}>
                              <div className="flex items-center justify-between text-xs font-semibold text-gray-700 dark:text-gray-200">
                                <div className="flex items-center gap-2">
                                  <TagIcon className="h-4 w-4" />
                                  <span>{t('studiesWorkspace.tags')}</span>
                                </div>
                                <span className={MATCH_COUNT_BADGE}>{matchingTags.length}</span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {matchingTags.map((tag) => (
                                  <span key={tag} className={TAG_CHIP_CLASS}>
                                    <span className="opacity-60">#</span>
                                    <HighlightedText text={tag} searchQuery={searchQuery} />
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {matchingRefs.length > 0 && (
                            <div className={METADATA_CARD_CLASS}>
                              <div className="flex items-center justify-between text-xs font-semibold text-gray-700 dark:text-gray-200">
                                <div className="flex items-center gap-2">
                                  <BookmarkIcon className="h-4 w-4" />
                                  <span>{t('studiesWorkspace.scriptureRefs')}</span>
                                </div>
                                <span className={MATCH_COUNT_BADGE}>{matchingRefs.length}</span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {matchingRefs.map((ref) => (
                                  <span key={ref.id} className={REF_CHIP_CLASS}>
                                    <BookmarkIcon className="mr-1 h-3 w-3" />
                                    <HighlightedText text={formatRef(ref)} searchQuery={searchQuery} />
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {searchQuery && !hasAnyMatch && (
                        <div className={ALERT_CLASS}>
                          {t('studiesWorkspace.noSearchMatches', {
                            defaultValue: 'No match found in content, tags, references, or title.',
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="line-clamp-2">
                      <MarkdownDisplay content={note.content} compact searchQuery={searchQuery} />
                    </div>
                  )
                ) : (
                  <div className="line-clamp-2">
                    <MarkdownDisplay content={note.content} compact />
                  </div>
                )}
              </div>
            )}

            {/* Meta info */}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
              <span className="inline-flex items-center gap-1">
                <BookmarkIcon className="h-3.5 w-3.5" />
                {note.scriptureRefs.length}
              </span>
              <span>•</span>
              <span className="inline-flex items-center gap-1">
                🏷️ {note.tags.length}
              </span>
              <span>•</span>
              <span>{formatRelativeTime(note.updatedAt)}</span>
            </div>
          </div>

          {/* Analyze button for notes without metadata (collapsed only) */}

        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-gray-100 dark:border-gray-700">
          {/* Full content */}
          <div className="px-4 py-4 pl-4 sm:pl-12">
            <div className="text-sm text-gray-700 dark:text-gray-200">
              <MarkdownDisplay content={note.content} searchQuery={searchQuery} />
            </div>
          </div>

          {/* Scripture references */}
          {note.scriptureRefs.length > 0 && (
            <div className="border-t border-gray-100 px-4 py-3 pl-4 dark:border-gray-700 sm:pl-12">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                <BookmarkIcon className="h-4 w-4 text-emerald-600" />
                {t('studiesWorkspace.scriptureRefs')}
              </div>
              <div className="flex flex-wrap gap-2">
                {note.scriptureRefs.map((ref) => (
                  <span
                    key={ref.id}
                    className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                  >
                    {searchQuery ? (
                      <HighlightedText text={formatRef(ref)} searchQuery={searchQuery} />
                    ) : (
                      formatRef(ref)
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {note.tags.length > 0 && (
            <div className="border-t border-gray-100 px-4 py-3 pl-4 dark:border-gray-700 sm:pl-12">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                🏷️ {t('studiesWorkspace.tags')}
              </div>
              <div className="flex flex-wrap gap-2">
                {note.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                  >
                    {searchQuery ? (
                      <HighlightedText text={tag} searchQuery={searchQuery} />
                    ) : (
                      tag
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-gray-100 px-4 py-3 pl-4 dark:border-gray-700 sm:pl-12">
            <div className="flex items-center justify-between">
              <button
                onClick={() => onEdit(note)}
                className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              >
                <PencilIcon className="h-3.5 w-3.5" />
                {t('common.edit')}
              </button>
              <span className="text-xs text-gray-400 dark:text-gray-500">{new Date(note.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
