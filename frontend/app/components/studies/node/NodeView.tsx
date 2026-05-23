'use client';

import {
  ArrowDownIcon,
  ArrowDownRightIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  Bars3Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  DocumentIcon,
  LinkIcon,
  PhotoIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { makeId } from '@/utils/makeId';
import MarkdownDisplay from '@components/MarkdownDisplay';

import NodeTextEditor from './NodeTextEditor';

import type { ContentNode, ContentNodeMedia } from '@/models/models';
import type { HTMLAttributes, MouseEvent, ReactElement } from 'react';

interface NodeViewProps {
  node: ContentNode;
  depth: number;
  dragHandleProps?: HTMLAttributes<HTMLElement>;
  currentNoteId?: string;
  readOnly?: boolean;
  /** `(id) => title` for rendering `[[noteId]]` chips as note titles. */
  wikilinkResolver?: (id: string) => string | undefined;

  state: {
    isFocused: boolean;
    isEditing: boolean;
    showActions: boolean;
    isRoot: boolean;
    hasChildren: boolean;
    isCollapsed: boolean;
  };

  capabilities?: {
    canMoveUp?: boolean;
    canMoveDown?: boolean;
    canDemote?: boolean;
    canPromote?: boolean;
  };

  treeActions: {
    onFocus: () => void;
    onStartEdit: () => void;
    onHeaderChange: (v: string) => void;
    onTextChange: (v: string) => void;
    onToggleCollapse: () => void;
    onMediaRemove: (mediaId: string) => void;
    onMediaAdd: (media: ContentNodeMedia) => void;
    onAddChild: () => void;
    onAddSibling: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onDemote: () => void;
    onPromote: () => void;
    onDeleteNode: () => void;
  };
}

const YOUTUBE_DETECT = /(?:youtu\.be\/|youtube\.com)/;
const IMAGE_EXT_DETECT = /\.(png|jpe?g|gif|webp|svg)(\?|$)/i;

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

// Study page already renders study.title as the visual H1 — node headers
// therefore start at H2 (depth=0 → H2, depth=1 → H3, ...). This preserves
// document outline semantics (one H1 per page) and gives node headers a
// visible hierarchy that always sits below the study title.
const HEADING_TAGS: HeadingTag[] = ['h2', 'h3', 'h4', 'h5', 'h6', 'h6'];
const HEADING_CLASSES = [
  'text-2xl',
  'text-xl',
  'text-lg',
  'text-base',
  'text-sm',
  'text-sm',
];
const YOUTUBE_VIDEO_ID_PATTERN = /(?:youtu\.be\/|v=)([\w-]{11})/;
const ICON_BUTTON_CLASS = 'rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200';
const MOVE_BUTTON_CLASS = 'inline-flex h-7 w-7 items-center justify-center rounded-md bg-gray-50 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100';
const MEDIA_TILE_CLASS = 'group relative flex w-36 flex-col overflow-hidden rounded-md border border-gray-200 bg-white text-xs shadow-sm dark:border-gray-700 dark:bg-gray-900';

function clampHeadingLevel(depth: number): number {
  return Math.min(Math.max(depth + 1, 1), 6);
}

function stopRowClick(event: MouseEvent<HTMLElement>): void {
  event.stopPropagation();
}

function getMediaLabel(media: ContentNodeMedia): string {
  return media.caption?.trim() || media.url;
}

function getYoutubeVideoId(url: string): string | null {
  return YOUTUBE_VIDEO_ID_PATTERN.exec(url)?.[1] ?? null;
}

function renderMediaPreview(media: ContentNodeMedia): ReactElement {
  const label = getMediaLabel(media);

  if (media.type === 'image') {
    return (
      <div className="h-20 bg-gray-100 dark:bg-gray-800">
        {/* eslint-disable-next-line @next/next/no-img-element -- User-provided media URLs are not configured Next image assets. */}
        <img src={media.url} alt={label} className="h-20 w-full object-cover" />
      </div>
    );
  }

  if (media.type === 'youtube') {
    const videoId = getYoutubeVideoId(media.url);
    const thumbnailUrl = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';

    return (
      <div className="h-20 bg-gray-100 dark:bg-gray-800">
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- YouTube thumbnails are remote previews, not app-owned images.
          <img src={thumbnailUrl} alt={label} className="h-20 w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center px-2 text-center text-gray-500 dark:text-gray-400">
            YouTube
          </div>
        )}
      </div>
    );
  }

  const Icon = media.type === 'file' ? DocumentIcon : LinkIcon;

  return (
    <div className="flex h-20 items-center justify-center bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-300">
      <Icon className="h-8 w-8" aria-hidden="true" />
    </div>
  );
}

function detectMediaType(url: string): ContentNodeMedia['type'] {
  if (YOUTUBE_DETECT.test(url)) return 'youtube';
  if (IMAGE_EXT_DETECT.test(url)) return 'image';
  return 'url';
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- Node view owns read/edit UI branches for one row.
export function NodeView({
  node,
  depth,
  dragHandleProps,
  currentNoteId,
  readOnly = false,
  wikilinkResolver,
  state,
  capabilities,
  treeActions,
}: NodeViewProps) {
  const { isFocused, isEditing, showActions, isRoot, hasChildren, isCollapsed } = state;
  const { canMoveUp = true, canMoveDown = true, canDemote = true, canPromote = true } = capabilities ?? {};
  const {
    onFocus,
    onStartEdit,
    onHeaderChange,
    onTextChange,
    onToggleCollapse,
    onMediaRemove,
    onMediaAdd,
    onAddChild,
    onAddSibling,
    onMoveUp,
    onMoveDown,
    onDemote,
    onPromote,
    onDeleteNode,
  } = treeActions;
  const { t } = useTranslation();
  const [isAddingMedia, setIsAddingMedia] = useState(false);
  const [mediaDraft, setMediaDraft] = useState({ url: '', caption: '' });
  const headerRef = useRef<HTMLTextAreaElement>(null);
  const headingLevel = clampHeadingLevel(depth);
  const HeadingTag = HEADING_TAGS[headingLevel - 1];
  const headerValue = node.header ?? '';
  const textValue = node.text ?? '';
  const hasHeader = Boolean(node.header);
  const hasText = Boolean(node.text);
  const hasMedia = Boolean(node.media?.length);
  const isEmptyNode = !hasHeader && !hasText && !hasMedia;
  const hasNodeContent = Boolean(node.header?.trim() || node.text?.trim() || hasMedia);
  const shouldShowActions = showActions || isEditing;

  // Auto-resize the single-line header textarea (text body is handled by
  // RichMarkdownEditor which manages its own height).
  useLayoutEffect(() => {
    if (!isEditing) return;
    const el = headerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [headerValue, isEditing]);

  // When edit mode opens on the focused node, move keyboard focus into the
  // header textarea so the first keystroke lands there.
  useEffect(() => {
    if (!isEditing || !isFocused) return;
    const target = headerRef.current;
    if (!target) return;
    target.focus();
    const length = target.value.length;
    target.setSelectionRange(length, length);
  }, [isEditing, isFocused]);

  // Empty focused node: there's nothing to read, so jump straight into
  // text-editing instead of forcing a second click to reveal the textarea.
  // Without this the user sees only the action row and no obvious "where do I
  // type?" affordance.
  useEffect(() => {
    if (showActions && isEmptyNode && !isEditing) {
      onStartEdit();
    }
  }, [showActions, isEmptyNode, isEditing, onStartEdit]);

  // Read-only render: just the structure with chevron folds and rendered
  // markdown. No focus ring, no drag handle, no edit textareas, no buttons,
  // no double-click → edit. This is the "режим просмотра" path.
  //
  // Collapse semantics (TRIZ/IFR — "one gesture hides everything inside"):
  // when `node.collapsed` is true, hide BOTH the text/media body of this
  // node AND its descendant children (descendant hiding is handled in
  // `selectFlat`). The header always stays visible — it's the user's
  // anchor for "this node exists, click chevron to re-open". Chevron
  // therefore shows whenever there's anything to hide: text OR media OR
  // children — previously only `hasChildren` qualified.
  const hasFoldableContent = hasText || hasMedia || hasChildren;
  if (readOnly) {
    const showBody = !isCollapsed;
    return (
      <div
        data-testid={`node-view-${node.id}`}
        className="flex w-full gap-2 px-2 py-1.5"
        style={{ paddingLeft: depth * 20 }}
      >
        <div className="flex shrink-0 items-start pt-1 text-gray-400 dark:text-gray-500">
          {hasFoldableContent ? (
            <button
              type="button"
              aria-label={isCollapsed ? t('studiesWorkspace.nodeTree.ariaExpand') : t('studiesWorkspace.nodeTree.ariaCollapse')}
              className={ICON_BUTTON_CLASS}
              onClick={onToggleCollapse}
            >
              {isCollapsed ? (
                <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronDownIcon className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          ) : (
            <span className="h-6 w-6" aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          {hasHeader && (
            <HeadingTag
              className={[
                HEADING_CLASSES[headingLevel - 1],
                'font-bold leading-tight text-gray-900 dark:text-gray-50',
              ].join(' ')}
            >
              {node.header}
            </HeadingTag>
          )}

          {showBody && hasText && (
            <MarkdownDisplay content={node.text ?? ''} compact enableWikiLinks wikilinkResolver={wikilinkResolver} />
          )}

          {showBody && hasMedia && (
            <div className="flex flex-wrap gap-2">
              {node.media?.map((media) => {
                const label = getMediaLabel(media);
                return (
                  <div key={media.id} className={MEDIA_TILE_CLASS}>
                    {renderMediaPreview(media)}
                    <div className="min-w-0 px-2 py-1.5">
                      {media.type === 'url' ? (
                        <a
                          href={media.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate font-medium text-emerald-700 hover:underline dark:text-emerald-300"
                        >
                          {label}
                        </a>
                      ) : (
                        <span className="block truncate font-medium text-gray-700 dark:text-gray-200">
                          {label}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  const handleRowClick = (): void => {
    if (isFocused && isEmptyNode) {
      onStartEdit();
      return;
    }

    onFocus();
  };

  const handleEditableRegionClick = (): void => {
    if (!isFocused) onFocus();
    if (!isEditing) onStartEdit();
  };

  const handleDeleteClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (!hasNodeContent && !hasChildren) {
      onDeleteNode();
      return;
    }

    const message = hasChildren
      ? t('studiesWorkspace.nodeTree.confirmDeleteNodeWithChildren')
      : t('studiesWorkspace.nodeTree.confirmDeleteNode');

    if (window.confirm(message)) {
      onDeleteNode();
    }
  };

  const handleAddMediaSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const url = mediaDraft.url.trim();
    if (!url) return;
    onMediaAdd({
      id: makeId('media'),
      type: detectMediaType(url),
      url,
      ...(mediaDraft.caption.trim() ? { caption: mediaDraft.caption.trim() } : {}),
    });
    setMediaDraft({ url: '', caption: '' });
    setIsAddingMedia(false);
  };

  return (
    <div
      data-testid={`node-view-${node.id}`}
      className={[
        'group flex min-h-12 w-full gap-2 rounded-md border border-transparent px-2 py-2 transition',
        'hover:border-emerald-200 hover:bg-emerald-50/60 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/20',
        isFocused ? 'ring-2 ring-emerald-400 bg-white dark:bg-gray-900' : 'bg-transparent',
      ].join(' ')}
      style={{ paddingLeft: depth * 20 }}
      onClick={handleRowClick}
    >
      <div className="flex shrink-0 items-start gap-1 pt-1 text-gray-400 dark:text-gray-500">
        <button
          type="button"
          aria-label={t('studiesWorkspace.nodeTree.ariaDrag')}
          data-testid={`drag-handle-${node.id}`}
          title="Перетащить ноду"
          {...dragHandleProps}
          className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 active:cursor-grabbing dark:hover:bg-gray-800 dark:hover:text-gray-200"
          onClick={stopRowClick}
        >
          <Bars3Icon className="h-4 w-4 cursor-grab" aria-hidden="true" />
        </button>
        {hasFoldableContent ? (
          <button
            type="button"
            aria-label={isCollapsed ? t('studiesWorkspace.nodeTree.ariaExpand') : t('studiesWorkspace.nodeTree.ariaCollapse')}
            className={ICON_BUTTON_CLASS}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse();
            }}
          >
            {isCollapsed ? (
              <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronDownIcon className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="h-6 w-6" aria-hidden="true" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        {isEditing ? (
          // Edit mode: always show BOTH textareas with placeholders, regardless
          // of whether the node currently has a header or text. Without this,
          // a node that only has text has no way to gain a header, and vice
          // versa — a node that only has a header has no text field, and the
          // user wonders "where do I type?" (same root cause as the
          // empty-node case, just spread across all asymmetric content shapes).
          <>
            <textarea
              ref={headerRef}
              aria-label="Заголовок ноды"
              placeholder={t('studiesWorkspace.nodeTree.headerPlaceholder') || 'Заголовок (опционально)'}
              className="w-full resize-none overflow-hidden rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-emerald-400 dark:border-emerald-800 dark:bg-gray-900 dark:text-gray-100"
              value={headerValue}
              onChange={(event) => onHeaderChange(event.target.value.replace(/\n/g, ' '))}
              onKeyDown={(event) => {
                // Header is one logical line — Enter must not insert a newline.
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              onPaste={(event) => {
                const pasted = event.clipboardData.getData('text/plain');
                if (!/\n/.test(pasted)) return;
                event.preventDefault();
                const sanitized = pasted.replace(/\s*\n+\s*/g, ' ');
                const textarea = event.currentTarget;
                const start = textarea.selectionStart ?? headerValue.length;
                const end = textarea.selectionEnd ?? headerValue.length;
                onHeaderChange(`${headerValue.slice(0, start)}${sanitized}${headerValue.slice(end)}`);
              }}
              onClick={stopRowClick}
              rows={1}
            />
            <div onClick={stopRowClick}>
              <NodeTextEditor
                value={textValue}
                onChange={onTextChange}
                placeholder={t('studiesWorkspace.nodeTree.textPlaceholder') || 'Текст ноды'}
                minHeight="120px"
                currentNoteId={currentNoteId}
              />
            </div>
          </>
        ) : (
          <>
            {hasHeader && (
              <div onClick={handleEditableRegionClick} onDoubleClick={onStartEdit}>
                <HeadingTag
                  className={[
                    HEADING_CLASSES[headingLevel - 1],
                    'font-bold leading-tight text-gray-900 dark:text-gray-50',
                  ].join(' ')}
                >
                  {node.header}
                </HeadingTag>
              </div>
            )}
            {hasText && !isCollapsed && (
              <div onClick={handleEditableRegionClick} onDoubleClick={onStartEdit}>
                <MarkdownDisplay content={node.text ?? ''} compact enableWikiLinks wikilinkResolver={wikilinkResolver} />
              </div>
            )}
          </>
        )}

        {shouldShowActions && (
          <div className="flex flex-wrap items-center gap-2 text-xs" onClick={stopRowClick}>
            <button
              type="button"
              onClick={onAddSibling}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 font-medium text-emerald-700 transition hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
              title="Enter (вне текста) — соседняя нода"
            >
              <ArrowDownIcon className="h-3.5 w-3.5" /> Соседняя
            </button>
            <button
              type="button"
              onClick={onAddChild}
              className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 font-medium text-amber-700 transition hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/60"
              title="Cmd+Enter — добавить дочернюю ноду"
            >
              <ArrowDownRightIcon className="h-3.5 w-3.5" /> Дочерняя
            </button>
            <button
              type="button"
              onClick={() => setIsAddingMedia((open) => !open)}
              className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1 font-medium text-gray-700 transition hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <PhotoIcon className="h-3.5 w-3.5" /> Медиа
            </button>
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                aria-label="Переместить вверх"
                title="Cmd+ArrowUp — переместить вверх"
                onClick={onMoveUp}
                disabled={!canMoveUp}
                className={`${MOVE_BUTTON_CLASS} disabled:cursor-not-allowed disabled:bg-transparent disabled:text-gray-300 disabled:hover:bg-transparent disabled:hover:text-gray-300 dark:disabled:text-gray-600 dark:disabled:hover:text-gray-600`}
              >
                <ArrowUpIcon className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Переместить вниз"
                title="Cmd+ArrowDown — переместить вниз"
                onClick={onMoveDown}
                disabled={!canMoveDown}
                className={`${MOVE_BUTTON_CLASS} disabled:cursor-not-allowed disabled:bg-transparent disabled:text-gray-300 disabled:hover:bg-transparent disabled:hover:text-gray-300 dark:disabled:text-gray-600 dark:disabled:hover:text-gray-600`}
              >
                <ArrowDownIcon className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Сделать дочерней"
                title="Tab — сделать дочерней"
                onClick={onDemote}
                disabled={!canDemote}
                className={`${MOVE_BUTTON_CLASS} disabled:cursor-not-allowed disabled:bg-transparent disabled:text-gray-300 disabled:hover:bg-transparent disabled:hover:text-gray-300 dark:disabled:text-gray-600 dark:disabled:hover:text-gray-600`}
              >
                <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Повысить уровень"
                title="Shift+Tab — повысить уровень"
                onClick={onPromote}
                disabled={!canPromote}
                className={`${MOVE_BUTTON_CLASS} disabled:cursor-not-allowed disabled:bg-transparent disabled:text-gray-300 disabled:hover:bg-transparent disabled:hover:text-gray-300 dark:disabled:text-gray-600 dark:disabled:hover:text-gray-600`}
              >
                <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {!isRoot && (
              <button
                type="button"
                aria-label={t('studiesWorkspace.nodeTree.deleteNode')}
                onClick={handleDeleteClick}
                className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition hover:bg-rose-50 hover:text-rose-600 dark:text-gray-500 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                title={t('studiesWorkspace.nodeTree.deleteNode')}
              >
                <TrashIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {isAddingMedia && (
          <form
            onSubmit={handleAddMediaSubmit}
            className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-100 bg-emerald-50/40 px-3 py-2 dark:border-emerald-900/40 dark:bg-emerald-950/20"
            onClick={stopRowClick}
          >
            <input
              type="url"
              required
              placeholder="https://… (картинка, YouTube или ссылка)"
              value={mediaDraft.url}
              onChange={(e) => setMediaDraft((d) => ({ ...d, url: e.target.value }))}
              className="flex-1 min-w-[200px] rounded-md border border-gray-200 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
            <input
              type="text"
              placeholder="Подпись (опционально)"
              value={mediaDraft.caption}
              onChange={(e) => setMediaDraft((d) => ({ ...d, caption: e.target.value }))}
              className="w-40 rounded-md border border-gray-200 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
            <button
              type="submit"
              className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Добавить
            </button>
            <button
              type="button"
              onClick={() => { setIsAddingMedia(false); setMediaDraft({ url: '', caption: '' }); }}
              className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Отмена
            </button>
          </form>
        )}

        {hasMedia && !isCollapsed ? (
          <div className="flex flex-wrap gap-2" onClick={stopRowClick}>
            {node.media?.map((media) => {
              const label = getMediaLabel(media);

              return (
                <div key={media.id} className={MEDIA_TILE_CLASS}>
                  {renderMediaPreview(media)}
                  <div className="min-w-0 px-2 py-1.5">
                    {media.type === 'url' ? (
                      <a
                        href={media.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate font-medium text-emerald-700 hover:underline dark:text-emerald-300"
                        onClick={stopRowClick}
                      >
                        {label}
                      </a>
                    ) : (
                      <span className="block truncate font-medium text-gray-700 dark:text-gray-200">
                        {label}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={`${t('studiesWorkspace.nodeTree.ariaRemoveMedia')}: ${label}`}
                    className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-gray-500 shadow-sm transition hover:bg-rose-50 hover:text-rose-600 dark:bg-gray-950/90 dark:text-gray-300 dark:hover:bg-rose-950"
                    onClick={(event) => {
                      event.stopPropagation();
                      onMediaRemove(media.id);
                    }}
                  >
                    <XMarkIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

      </div>
    </div>
  );
}

export default NodeView;
