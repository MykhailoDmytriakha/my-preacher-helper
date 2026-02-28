"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, CheckCircleIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { CheckIcon, ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import React from "react";
import { useTranslation } from 'react-i18next';

import { Item } from "@/models/models";
import { LOCAL_THOUGHT_PREFIX } from '@/utils/pendingThoughtsStore';
import { SERMON_SECTION_COLORS } from '@/utils/themeColors';
import { EditIcon, TrashIcon } from '@components/Icons';

import CardContent from "./CardContent";

interface SortableItemProps {
  item: Item;
  containerId: string;
  onEdit?: (item: Item) => void;
  showDeleteIcon?: boolean;
  onDelete?: (itemId: string, containerId: string) => void;
  isDeleting?: boolean;
  isHighlighted?: boolean;
  highlightType?: 'assigned' | 'moved';
  onKeep?: (itemId: string, containerId: string) => void;
  onRevert?: (itemId: string, containerId: string) => void;
  activeId?: string | null;
  onMoveToAmbiguous?: (itemId: string, fromContainerId: string) => void;
  onRetrySync?: (itemId: string) => void;
  disabled?: boolean; // Whether the item is disabled for drag and drop
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

const stopEvent = (event: React.MouseEvent | React.PointerEvent) => {
  event.stopPropagation();
  event.preventDefault();
  if (event.nativeEvent.stopImmediatePropagation) {
    event.nativeEvent.stopImmediatePropagation();
  }
};

const getHighlightStyles = (isHighlighted: boolean, highlightType: 'assigned' | 'moved') => {
  if (!isHighlighted) return {};

  return highlightType === 'assigned'
    ? { borderColor: 'rgb(250, 204, 21)', backgroundColor: 'rgb(254, 249, 195)' }
    : { borderColor: 'rgb(59, 130, 246)', backgroundColor: 'rgb(219, 234, 254)' };
};

const getSectionIconClasses = (containerId: string) => {
  if (containerId === 'introduction') {
    return `${SERMON_SECTION_COLORS.introduction.text} dark:${SERMON_SECTION_COLORS.introduction.darkText}`;
  }
  if (containerId === 'main') {
    return `${SERMON_SECTION_COLORS.mainPart.text} dark:${SERMON_SECTION_COLORS.mainPart.darkText}`;
  }
  if (containerId === 'conclusion') {
    return `${SERMON_SECTION_COLORS.conclusion.text} dark:${SERMON_SECTION_COLORS.conclusion.darkText}`;
  }
  return 'text-gray-600 dark:text-gray-300';
};

const getSyncBorderClass = (isError: boolean, isPending: boolean, isSuccess: boolean) => {
  if (isError) return 'border-red-300 dark:border-red-600';
  if (isPending) return 'border-amber-300 dark:border-amber-500';
  if (isSuccess) return 'border-green-300 dark:border-green-600';
  return '';
};

const getSyncRingClass = (isError: boolean, isPending: boolean) => {
  if (isError) return 'ring-1 ring-red-300/60';
  if (isPending) return 'ring-1 ring-amber-300/60';
  return '';
};

const getRemainingTime = (syncExpiresAt: string | undefined, now: number) => {
  if (!syncExpiresAt) return null;
  const remainingMs = Math.max(0, new Date(syncExpiresAt).getTime() - now);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  return `${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`;
};

const getCardClassName = ({
  isHighlighted,
  highlightType,
  syncBorderClass,
  syncRingClass,
  hoverShadowClass,
  isDeleting,
  isDragDisabled,
  cursorClass,
}: {
  isHighlighted: boolean;
  highlightType: 'assigned' | 'moved';
  syncBorderClass: string;
  syncRingClass: string;
  hoverShadowClass: string;
  isDeleting: boolean;
  isDragDisabled: boolean;
  cursorClass: string;
}) => {
  const highlightClass = isHighlighted
    ? `border-2 shadow-lg ${highlightType === 'assigned'
      ? 'border-yellow-400 shadow-yellow-200'
      : 'border-blue-400 shadow-blue-200'}`
    : `border border-gray-200 dark:border-gray-700 shadow-md ${syncBorderClass}`;

  const dragStateClass = isDeleting ? 'pointer-events-none' : '';
  const dragOpacityClass = isDragDisabled ? `opacity-75 ${cursorClass}` : cursorClass;

  return `relative group flex items-start space-x-2 mb-6 p-5 bg-white dark:bg-gray-800 rounded-md ${highlightClass} ${hoverShadowClass} ${dragStateClass} ${dragOpacityClass} ${syncBorderClass} ${syncRingClass}`;
};

const HighlightBadge = ({
  isHighlighted,
  highlightType,
  t,
}: {
  isHighlighted: boolean;
  highlightType: 'assigned' | 'moved';
  t: TranslateFn;
}) => {
  if (!isHighlighted) return null;
  const icon = highlightType === 'assigned'
    ? <span className="ml-1 text-yellow-500">✨</span>
    : <span className="ml-1 text-blue-500">➡️</span>;

  return (
    <div className={`mt-2 py-1 px-2 text-sm font-medium rounded-md inline-flex items-center bg-white ${highlightType === 'assigned'
      ? 'text-yellow-800 border border-red-300'
      : 'text-blue-800 border border-red-300'
      }`}>
      {highlightType === 'assigned'
        ? t('structure.aiAssigned', { defaultValue: 'AI assigned to outline point' })
        : t('structure.aiMoved', { defaultValue: 'AI moved this item' })}
      {icon}
    </div>
  );
};

const SyncMeta = ({
  show,
  isError,
  remainingTime,
  t,
}: {
  show: boolean;
  isError: boolean;
  remainingTime: string | null;
  t: TranslateFn;
}) => {
  if (!show || !remainingTime) return null;
  return (
    <div className={`mt-2 text-xs font-medium ${isError ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
      {isError
        ? t('structure.localThoughtFailed', { time: remainingTime, defaultValue: `Not synced · ${remainingTime}` })
        : t('structure.localThoughtPending', { time: remainingTime, defaultValue: `Saving locally · ${remainingTime}` })
      }
    </div>
  );
};

const ReviewedBadge = ({ show, t }: { show: boolean; t: TranslateFn }) => {
  if (!show) return null;
  return (
    <div className="flex items-center mb-2 text-gray-500 dark:text-gray-400">
      <LockClosedIcon className="h-4 w-4 mr-1" />
      <span className="text-xs font-medium">{t('structure.reviewed', { defaultValue: 'Reviewed' })}</span>
    </div>
  );
};

const SortableItemActions = ({
  item,
  containerId,
  isHighlighted,
  isDragging,
  isDeleting,
  isPending,
  isError,
  isSuccess,
  isLocal,
  canEdit,
  disabled,
  showDeleteIcon,
  onDelete,
  onEdit,
  onMoveToAmbiguous,
  onKeep,
  onRevert,
  onRetrySync,
  sectionIconColorClasses,
  successOpacityClass,
  t,
}: {
  item: Item;
  containerId: string;
  isHighlighted: boolean;
  isDragging: boolean;
  isDeleting: boolean;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  isLocal: boolean;
  canEdit: boolean;
  disabled: boolean;
  showDeleteIcon: boolean;
  onDelete?: (itemId: string, containerId: string) => void;
  onEdit?: (item: Item) => void;
  onMoveToAmbiguous?: (itemId: string, fromContainerId: string) => void;
  onKeep?: (itemId: string, containerId: string) => void;
  onRevert?: (itemId: string, containerId: string) => void;
  onRetrySync?: (itemId: string) => void;
  sectionIconColorClasses: string;
  successOpacityClass: string;
  t: TranslateFn;
}) => (
  <div className={`flex flex-col space-y-1 ${isHighlighted ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity ${isDragging || isDeleting ? 'invisible' : ''}`}>
    {isPending && (
      <div className="rounded-full p-1.5 bg-amber-100 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-700">
        <ArrowPathIcon className="h-5 w-5 text-amber-600 dark:text-amber-400 animate-spin" />
      </div>
    )}
    {isError && onRetrySync && (
      <button
        onPointerDown={stopEvent}
        onMouseDown={stopEvent}
        onClick={(event) => {
          stopEvent(event);
          onRetrySync(item.id);
        }}
        className="focus:outline-none rounded-full p-1.5 border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/40 hover:bg-red-100 dark:hover:bg-red-900/60 shadow-sm hover:shadow-md"
        title={t('structure.localThoughtRetry', { defaultValue: 'Retry sync' })}
      >
        <ArrowPathIcon className="h-5 w-5 text-red-600 dark:text-red-400" />
      </button>
    )}
    {isSuccess && (
      <div className={`rounded-full p-1.5 bg-green-100 dark:bg-green-900/40 border border-green-200 dark:border-green-700 transition-opacity ${successOpacityClass}`}>
        <CheckCircleIcon className="h-5 w-5 text-green-600 dark:text-green-400" />
      </div>
    )}
    {canEdit && (
      <button
        onPointerDown={stopEvent}
        onMouseDown={stopEvent}
        onClick={(event) => {
          stopEvent(event);
          if (onEdit) onEdit(item);
        }}
        className="focus:outline-none rounded-full p-1.5 border border-transparent bg-white dark:bg-gray-700 hover:border-gray-200 dark:hover:border-gray-600 shadow-sm hover:shadow-md"
        title={t('structure.editThought', { defaultValue: 'Edit Thought' })}
        disabled={isDeleting}
      >
        <EditIcon className={`h-5 w-5 ${sectionIconColorClasses} hover:opacity-90`} />
      </button>
    )}
    {onMoveToAmbiguous && containerId !== 'ambiguous' && !isLocal && !isPending && !isError && !isSuccess && !disabled && (
      <button
        onPointerDown={stopEvent}
        onMouseDown={stopEvent}
        onClick={(event) => {
          stopEvent(event);
          onMoveToAmbiguous(item.id, containerId);
        }}
        className="focus:outline-none rounded-full p-1.5 border border-transparent bg-white dark:bg-gray-700 shadow-sm hover:shadow-md hover:border-gray-200 dark:hover:border-gray-600 transition-colors"
        title={t('structure.moveToUnderConsideration', { defaultValue: 'Move to Under Consideration' })}
        disabled={isDeleting}
      >
        <ArrowTopRightOnSquareIcon className={`h-5 w-5 ${sectionIconColorClasses}`} />
      </button>
    )}
    {showDeleteIcon && onDelete && !isLocal && !isPending && !isError && !isSuccess && !disabled && (
      <button
        onPointerDown={stopEvent}
        onMouseDown={stopEvent}
        onClick={(event) => {
          stopEvent(event);
          onDelete(item.id, containerId);
        }}
        className="focus:outline-none rounded-full p-1.5 border border-transparent bg-white dark:bg-gray-700 hover:border-gray-200 dark:hover:border-gray-600 shadow-sm hover:shadow-md"
        title={t('structure.removeFromStructure', { defaultValue: 'Remove from ThoughtsBySection' })}
        disabled={isDeleting}
      >
        <TrashIcon className="h-5 w-5 text-red-500 hover:text-red-600" />
      </button>
    )}
    {isHighlighted && onKeep && (
      <button
        onPointerDown={stopEvent}
        onMouseDown={stopEvent}
        onClick={(event) => {
          stopEvent(event);
          onKeep(item.id, containerId);
        }}
        className="focus:outline-none border-2 border-green-200 dark:border-green-700 rounded-full p-1 bg-white dark:bg-gray-700 hover:bg-green-50 dark:hover:bg-green-900/30 hover:shadow-md"
        title={t('structure.keepChanges', { defaultValue: 'Keep this change' })}
      >
        <CheckIcon className="h-5 w-5 text-green-500 hover:text-green-700" />
      </button>
    )}
    {isHighlighted && onRevert && (
      <button
        onPointerDown={stopEvent}
        onMouseDown={stopEvent}
        onClick={(event) => {
          stopEvent(event);
          onRevert(item.id, containerId);
        }}
        className="focus:outline-none border-2 border-orange-200 dark:border-orange-700 rounded-full p-1 bg-white dark:bg-gray-700 hover:bg-orange-50 dark:hover:bg-orange-900/30 hover:shadow-md"
        title={t('structure.revertChanges', { defaultValue: 'Revert to original' })}
      >
        <ArrowUturnLeftIcon className="h-5 w-5 text-orange-500 hover:text-orange-700" />
      </button>
    )}
  </div>
);

export default function SortableItem({
  item,
  containerId,
  onEdit,
  showDeleteIcon = false,
  onDelete,
  isDeleting = false,
  isHighlighted = false,
  highlightType = 'moved',
  onKeep,
  onRevert,
  activeId,
  onMoveToAmbiguous,
  onRetrySync,
  disabled = false
}: SortableItemProps) {
  const syncStatus = item.syncStatus;
  const isPending = syncStatus === 'pending';
  const isError = syncStatus === 'error';
  const isSuccess = syncStatus === 'success';
  const isSyncDeleting = item.syncOperation === 'delete' && isPending;
  const isLocal = item.id.startsWith(LOCAL_THOUGHT_PREFIX);
  const effectiveDeleting = isDeleting || isSyncDeleting;
  const isDragDisabled = effectiveDeleting || disabled;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: item.id,
      data: { container: containerId },
      disabled: isDragDisabled,
    });

  const { t } = useTranslation();
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    const needsTick = (item.syncExpiresAt && (isPending || isError)) || (item.syncSuccessAt && isSuccess);
    if (!needsTick) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isError, isPending, isSuccess, item.syncExpiresAt, item.syncSuccessAt]);

  // Determine if this item is actively being dragged
  const isActiveItem = activeId === item.id;

  const highlightStyles = getHighlightStyles(isHighlighted, highlightType);

  // Improved visibility for touch devices - show visual feedback instead of hiding completely
  const style = {
    transform: isActiveItem ? "none" : CSS.Transform.toString(transform),
    transition: isActiveItem ? "none" : (transition || "transform 250ms ease-in-out"),
    opacity: isActiveItem ? 0.3 : (isDragging || effectiveDeleting ? 0.5 : 1),  // Changed from 0 to 0.3 for touch feedback
    pointerEvents: (isActiveItem ? "none" : "auto") as React.CSSProperties['pointerEvents'],
    ...highlightStyles
  };

  const hoverShadowClass = isDragDisabled ? '' : 'hover:shadow-xl';
  const cursorClass = isDragDisabled ? 'cursor-default' : 'cursor-grab';
  const syncBorderClass = getSyncBorderClass(isError, isPending, isSuccess);
  const syncRingClass = getSyncRingClass(isError, isPending);

  // Icon color classes based on section color palette (project theme)
  const sectionIconColorClasses = getSectionIconClasses(containerId);

  const remainingTime = getRemainingTime(item.syncExpiresAt, now);
  const successFaded = Boolean(isSuccess && item.syncSuccessAt && (now - new Date(item.syncSuccessAt).getTime() > 1500));
  const successOpacityClass = successFaded ? 'opacity-50' : 'opacity-100';

  const showSyncMeta = Boolean(remainingTime && (isPending || isError));
  const canEdit = Boolean(onEdit) && !isPending && !isSuccess && !disabled;
  const cardClassName = getCardClassName({
    isHighlighted,
    highlightType,
    syncBorderClass,
    syncRingClass,
    hoverShadowClass,
    isDeleting: effectiveDeleting,
    isDragDisabled,
    cursorClass,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        willChange: "transform",
        backfaceVisibility: "hidden",
        touchAction: isDragDisabled ? "auto" : "none",  // Allow normal interactions when dragging is disabled
      }}
      {...attributes}
      {...(isDragDisabled ? {} : (listeners || {}))}
      aria-disabled={isDragDisabled}
      className={cardClassName}
    >
      <div className="flex-grow">
        <ReviewedBadge show={disabled && !isLocal && !syncStatus} t={t} />
        <CardContent item={item} />
        <SyncMeta show={showSyncMeta} isError={isError} remainingTime={remainingTime} t={t} />
        <HighlightBadge isHighlighted={isHighlighted} highlightType={highlightType} t={t} />
      </div>

      <SortableItemActions
        item={item}
        containerId={containerId}
        isHighlighted={isHighlighted}
        isDragging={isDragging}
        isDeleting={effectiveDeleting}
        isPending={isPending}
        isError={isError}
        isSuccess={isSuccess}
        isLocal={isLocal}
        canEdit={canEdit}
        disabled={disabled}
        showDeleteIcon={showDeleteIcon}
        onDelete={onDelete}
        onEdit={onEdit}
        onMoveToAmbiguous={onMoveToAmbiguous}
        onKeep={onKeep}
        onRevert={onRevert}
        onRetrySync={onRetrySync}
        sectionIconColorClasses={sectionIconColorClasses}
        successOpacityClass={successOpacityClass}
        t={t}
      />
    </div>
  );
}
