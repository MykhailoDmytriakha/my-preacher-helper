"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS, type Transform } from "@dnd-kit/utilities";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  LockClosedIcon,
  LockOpenIcon,
} from "@heroicons/react/24/outline";
import { CheckIcon, ArrowUturnLeftIcon } from "@heroicons/react/24/outline";
import React from "react";
import { useTranslation } from "react-i18next";

import { Item } from "@/models/models";
import { LOCAL_THOUGHT_PREFIX } from "@/utils/pendingThoughtsStore";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";
import { EditIcon, TrashIcon } from "@components/Icons";

import CardContent from "./CardContent";

const ACTION_BUTTON_BASE_CLASS = "flex h-8 w-8 items-center justify-center rounded-full shadow-sm transition-colors";
const ACTION_STATUS_BASE_CLASS = "flex h-8 w-8 items-center justify-center rounded-full";

const hasVisibleRailActions = ({
  canToggleLock,
  isPending,
  showRetrySync,
  isSuccess,
  canEdit,
  showMoveAction,
  showDeleteAction,
}: {
  canToggleLock: boolean;
  isPending: boolean;
  showRetrySync: boolean;
  isSuccess: boolean;
  canEdit: boolean;
  showMoveAction: boolean;
  showDeleteAction: boolean;
}) => (
  canToggleLock ||
  isPending ||
  showRetrySync ||
  isSuccess ||
  canEdit ||
  showMoveAction ||
  showDeleteAction
);

interface SortableItemProps {
  item: Item;
  containerId: string;
  locationContext?: {
    subPointText?: string | null;
  };
  onEdit?: (item: Item) => void;
  showDeleteIcon?: boolean;
  onDelete?: (itemId: string, containerId: string) => void;
  isDeleting?: boolean;
  isHighlighted?: boolean;
  highlightType?: "assigned" | "moved";
  onKeep?: (itemId: string, containerId: string) => void;
  onRevert?: (itemId: string, containerId: string) => void;
  activeId?: string | null;
  onMoveToAmbiguous?: (itemId: string, fromContainerId: string) => void;
  onRetrySync?: (itemId: string) => void;
  onToggleLock?: (itemId: string, isLocked: boolean) => void;
  disabled?: boolean;
  isLocked?: boolean;
}

export type SortableItemPreviewProps = Omit<SortableItemProps, "activeId">;

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

type SortableCardProps = SortableItemPreviewProps & {
  attributes?: React.HTMLAttributes<HTMLDivElement>;
  listeners?: Record<string, unknown>;
  setNodeRef?: (node: HTMLDivElement | null) => void;
  isDragging: boolean;
  isActiveItem?: boolean;
  isOverlay?: boolean;
  transform?: Transform | null;
  transition?: string | null;
};

const stopEvent = (event: React.MouseEvent | React.PointerEvent) => {
  event.stopPropagation();
  event.preventDefault();
  if (event.nativeEvent.stopImmediatePropagation) {
    event.nativeEvent.stopImmediatePropagation();
  }
};

export const getHighlightStyles = (isHighlighted: boolean, highlightType: "assigned" | "moved") => {
  if (!isHighlighted) return {};

  return highlightType === "assigned"
    ? { borderColor: "rgb(250, 204, 21)", backgroundColor: "rgb(254, 249, 195)" }
    : { borderColor: "rgb(59, 130, 246)", backgroundColor: "rgb(219, 234, 254)" };
};

export const getSectionIconClasses = (containerId: string) => {
  if (containerId === "introduction") {
    return `${SERMON_SECTION_COLORS.introduction.text} dark:${SERMON_SECTION_COLORS.introduction.darkText}`;
  }
  if (containerId === "main") {
    return `${SERMON_SECTION_COLORS.mainPart.text} dark:${SERMON_SECTION_COLORS.mainPart.darkText}`;
  }
  if (containerId === "conclusion") {
    return `${SERMON_SECTION_COLORS.conclusion.text} dark:${SERMON_SECTION_COLORS.conclusion.darkText}`;
  }
  return "text-gray-600 dark:text-gray-300";
};

export const getSyncBorderClass = (isError: boolean, isPending: boolean, isSuccess: boolean) => {
  if (isError) return "border-red-300 dark:border-red-600";
  if (isPending) return "border-amber-300 dark:border-amber-500";
  if (isSuccess) return "border-green-300 dark:border-green-600";
  return "";
};

export const getSyncRingClass = (isError: boolean, isPending: boolean) => {
  if (isError) return "ring-1 ring-red-300/60";
  if (isPending) return "ring-1 ring-amber-300/60";
  return "";
};

export const getRemainingTime = (syncExpiresAt: string | undefined, now: number) => {
  if (!syncExpiresAt) return null;
  const remainingMs = Math.max(0, new Date(syncExpiresAt).getTime() - now);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  return `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")}`;
};

export const getCardClassName = ({
  isHighlighted,
  highlightType,
  syncBorderClass,
  syncRingClass,
  hoverShadowClass,
  isDeleting,
  isDragDisabled,
  cursorClass,
  isOverlay,
  isLocked,
}: {
  isHighlighted: boolean;
  highlightType: "assigned" | "moved";
  syncBorderClass: string;
  syncRingClass: string;
  hoverShadowClass: string;
  isDeleting: boolean;
  isDragDisabled: boolean;
  cursorClass: string;
  isOverlay: boolean;
  isLocked: boolean;
}) => {
  const surfaceClass = isLocked
    ? "bg-slate-50 dark:bg-slate-900/40"
    : "bg-white dark:bg-gray-800";

  const highlightClass = isHighlighted
    ? `border-2 shadow-lg ${highlightType === "assigned"
      ? "border-yellow-400 shadow-yellow-200"
      : "border-blue-400 shadow-blue-200"}`
    : `border ${isLocked
      ? "border-slate-300 dark:border-slate-700 shadow-sm"
      : "border-gray-200 dark:border-gray-700 shadow-md"} ${syncBorderClass}`;

  const dragStateClass = isDeleting ? "pointer-events-none" : "";
  const dragOpacityClass = isDragDisabled && !isLocked ? `opacity-75 ${cursorClass}` : cursorClass;
  const marginClass = isOverlay ? "" : "mb-6";

  return `relative group min-h-[144px] rounded-lg p-5 ${surfaceClass} ${marginClass} ${highlightClass} ${hoverShadowClass} ${dragStateClass} ${dragOpacityClass} ${syncBorderClass} ${syncRingClass}`;
};

export const HighlightBadge = ({
  isHighlighted,
  highlightType,
  t,
}: {
  isHighlighted: boolean;
  highlightType: "assigned" | "moved";
  t: TranslateFn;
}) => {
  if (!isHighlighted) return null;
  const icon = highlightType === "assigned"
    ? <span className="ml-1 text-yellow-500">✨</span>
    : <span className="ml-1 text-blue-500">➡️</span>;

  return (
    <div className={`inline-flex max-w-full items-center rounded-md border bg-white px-2 py-1 text-xs font-medium shadow-sm ${highlightType === "assigned"
      ? "border-yellow-300 text-yellow-800"
      : "border-blue-300 text-blue-800"
      }`}>
      {highlightType === "assigned"
        ? t("structure.aiAssigned", { defaultValue: "AI assigned to outline point" })
        : t("structure.aiMoved", { defaultValue: "AI moved this item" })}
      {icon}
    </div>
  );
};

export const SyncMeta = ({
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
    <div className={`text-xs font-medium ${isError ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
      {isError
        ? t("structure.localThoughtFailed", { time: remainingTime, defaultValue: `Not synced · ${remainingTime}` })
        : t("structure.localThoughtPending", { time: remainingTime, defaultValue: `Saving locally · ${remainingTime}` })
      }
    </div>
  );
};

export const SortableItemActions = ({
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
  isLocked,
  mutationDisabled,
  canToggleLock,
  showDeleteIcon,
  onDelete,
  onEdit,
  onMoveToAmbiguous,
  onRetrySync,
  onToggleLock,
  sectionIconColorClasses,
  successOpacityClass,
  t,
  isOverlay,
  className,
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
  isLocked: boolean;
  mutationDisabled: boolean;
  canToggleLock: boolean;
  showDeleteIcon: boolean;
  onDelete?: (itemId: string, containerId: string) => void;
  onEdit?: (item: Item) => void;
  onMoveToAmbiguous?: (itemId: string, fromContainerId: string) => void;
  onRetrySync?: (itemId: string) => void;
  onToggleLock?: (itemId: string, isLocked: boolean) => void;
  sectionIconColorClasses: string;
  successOpacityClass: string;
  t: TranslateFn;
  isOverlay: boolean;
  className?: string;
}) => {
  const hoverActionsClass = isHighlighted || isOverlay
    ? "opacity-100 pointer-events-auto"
    : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto";
  const lockLabel = isLocked
    ? t("structure.unlockThought", { defaultValue: "Unlock thought" })
    : t("structure.lockThought", { defaultValue: "Lock thought" });
  const showRetrySync = Boolean(isError && onRetrySync);
  const showMoveAction = Boolean(onMoveToAmbiguous && containerId !== "ambiguous" && !isLocal && !isPending && !isError && !isSuccess && !mutationDisabled);
  const showDeleteAction = Boolean(showDeleteIcon && onDelete && !isLocal && !isPending && !isError && !isSuccess && !mutationDisabled);
  const hasAnyVisibleAction = hasVisibleRailActions({
    canToggleLock,
    isPending,
    showRetrySync,
    isSuccess,
    canEdit,
    showMoveAction,
    showDeleteAction,
  });

  if (!hasAnyVisibleAction) {
    return null;
  }

  return (
    <div
      data-testid={`sortable-item-actions-${item.id}`}
      className={`flex w-10 flex-col items-center gap-1.5 ${isDragging || isDeleting ? "invisible" : ""} ${className ?? ""}`}
    >
      {canToggleLock && (
        <button
          onPointerDown={stopEvent}
          onMouseDown={stopEvent}
          onClick={(event) => {
            stopEvent(event);
            onToggleLock?.(item.id, !isLocked);
          }}
          className={`focus:outline-none border ${ACTION_BUTTON_BASE_CLASS} ${isLocked
            ? "border-slate-300 bg-slate-200 text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 hover:bg-slate-300 dark:hover:bg-slate-600"
            : "border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-gray-800 dark:text-slate-300 hover:border-slate-300 hover:bg-slate-50 dark:hover:border-slate-600 dark:hover:bg-gray-700"}`}
          title={lockLabel}
          aria-label={lockLabel}
          aria-pressed={isLocked}
          data-state={isLocked ? "locked" : "unlocked"}
          disabled={isDeleting || isOverlay}
        >
          {isLocked ? (
            <LockClosedIcon className="h-5 w-5" />
          ) : (
            <LockOpenIcon className={`h-5 w-5 ${sectionIconColorClasses}`} />
          )}
        </button>
      )}

      {isPending && (
        <div className={`${ACTION_STATUS_BASE_CLASS} border border-amber-200 bg-amber-100 dark:border-amber-700 dark:bg-amber-900/40`}>
          <ArrowPathIcon className="h-5 w-5 animate-spin text-amber-600 dark:text-amber-400" />
        </div>
      )}
      {showRetrySync && (
        <button
          onPointerDown={stopEvent}
          onMouseDown={stopEvent}
          onClick={(event) => {
            stopEvent(event);
            onRetrySync?.(item.id);
          }}
          className={`focus:outline-none border border-red-200 bg-red-50 hover:bg-red-100 hover:shadow-md dark:border-red-700 dark:bg-red-900/40 dark:hover:bg-red-900/60 ${ACTION_BUTTON_BASE_CLASS}`}
          title={t("structure.localThoughtRetry", { defaultValue: "Retry sync" })}
          disabled={isOverlay}
        >
          <ArrowPathIcon className="h-5 w-5 text-red-600 dark:text-red-400" />
        </button>
      )}
      {isSuccess && (
        <div className={`${ACTION_STATUS_BASE_CLASS} border border-green-200 bg-green-100 transition-opacity dark:border-green-700 dark:bg-green-900/40 ${successOpacityClass}`}>
          <CheckCircleIcon className="h-5 w-5 text-green-600 dark:text-green-400" />
        </div>
      )}

      <div className={`flex flex-col items-center gap-1.5 transition-opacity ${hoverActionsClass}`}>
        {canEdit && (
          <button
            onPointerDown={stopEvent}
            onMouseDown={stopEvent}
            onClick={(event) => {
              stopEvent(event);
              onEdit?.(item);
            }}
            className={`focus:outline-none border border-transparent bg-white hover:border-gray-200 hover:shadow-md dark:bg-gray-700 dark:hover:border-gray-600 ${ACTION_BUTTON_BASE_CLASS}`}
            title={t("structure.editThought", { defaultValue: "Edit Thought" })}
            disabled={isDeleting || isOverlay}
          >
            <EditIcon className={`h-5 w-5 ${sectionIconColorClasses} hover:opacity-90`} />
          </button>
        )}
        {showMoveAction && (
          <button
            onPointerDown={stopEvent}
            onMouseDown={stopEvent}
            onClick={(event) => {
              stopEvent(event);
              onMoveToAmbiguous?.(item.id, containerId);
            }}
            className={`focus:outline-none border border-transparent bg-white transition-colors hover:border-gray-200 hover:shadow-md dark:bg-gray-700 dark:hover:border-gray-600 ${ACTION_BUTTON_BASE_CLASS}`}
            title={t("structure.moveToUnderConsideration", { defaultValue: "Move to Under Consideration" })}
            disabled={isDeleting || isOverlay}
          >
            <ArrowTopRightOnSquareIcon className={`h-5 w-5 ${sectionIconColorClasses}`} />
          </button>
        )}
        {showDeleteAction && (
          <button
            onPointerDown={stopEvent}
            onMouseDown={stopEvent}
            onClick={(event) => {
              stopEvent(event);
              onDelete?.(item.id, containerId);
            }}
            className={`focus:outline-none border border-transparent bg-white hover:border-gray-200 hover:shadow-md dark:bg-gray-700 dark:hover:border-gray-600 ${ACTION_BUTTON_BASE_CLASS}`}
            title={t("structure.removeFromStructure", { defaultValue: "Remove from ThoughtsBySection" })}
            disabled={isDeleting || isOverlay}
          >
            <TrashIcon className="h-5 w-5 text-red-500 hover:text-red-600" />
          </button>
        )}
      </div>
    </div>
  );
};

const SortableItemReviewFooter = ({
  item,
  containerId,
  isHighlighted,
  highlightType,
  onKeep,
  onRevert,
  t,
  isOverlay,
}: {
  item: Item;
  containerId: string;
  isHighlighted: boolean;
  highlightType: "assigned" | "moved";
  onKeep?: (itemId: string, containerId: string) => void;
  onRevert?: (itemId: string, containerId: string) => void;
  t: TranslateFn;
  isOverlay: boolean;
}) => {
  if (!isHighlighted) {
    return null;
  }

  return (
    <div
      data-testid={`sortable-item-footer-${item.id}`}
      className="mt-3 flex flex-wrap items-center gap-3"
    >
      <div className="min-w-0 flex-1">
        <HighlightBadge isHighlighted={isHighlighted} highlightType={highlightType} t={t} />
      </div>
      <div className="ml-auto inline-flex max-w-full items-center justify-end gap-1.5 rounded-full border border-slate-200/80 bg-white/90 p-1 shadow-sm backdrop-blur-sm dark:border-slate-700/70 dark:bg-slate-800/90">
        {onKeep && (
          <button
            onPointerDown={stopEvent}
            onMouseDown={stopEvent}
            onClick={(event) => {
              stopEvent(event);
              onKeep(item.id, containerId);
            }}
            className={`focus:outline-none border border-green-200 bg-green-50 hover:bg-green-100 dark:border-green-700 dark:bg-green-900/30 dark:hover:bg-green-900/50 ${ACTION_BUTTON_BASE_CLASS}`}
            title={t("structure.keepChanges", { defaultValue: "Keep this change" })}
            disabled={isOverlay}
          >
            <CheckIcon className="h-5 w-5 text-green-500 hover:text-green-700" />
          </button>
        )}
        {onRevert && (
          <button
            onPointerDown={stopEvent}
            onMouseDown={stopEvent}
            onClick={(event) => {
              stopEvent(event);
              onRevert(item.id, containerId);
            }}
            className={`focus:outline-none border border-orange-200 bg-orange-50 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-900/30 dark:hover:bg-orange-900/50 ${ACTION_BUTTON_BASE_CLASS}`}
            title={t("structure.revertChanges", { defaultValue: "Revert to original" })}
            disabled={isOverlay}
          >
            <ArrowUturnLeftIcon className="h-5 w-5 text-orange-500 hover:text-orange-700" />
          </button>
        )}
      </div>
    </div>
  );
};

function SortableItemCard({
  item,
  containerId,
  locationContext,
  onEdit,
  showDeleteIcon = false,
  onDelete,
  isDeleting = false,
  isHighlighted = false,
  highlightType = "moved",
  onKeep,
  onRevert,
  onMoveToAmbiguous,
  onRetrySync,
  onToggleLock,
  disabled = false,
  isLocked = false,
  attributes,
  listeners,
  setNodeRef,
  isDragging,
  isActiveItem = false,
  isOverlay = false,
  transform,
  transition,
}: SortableCardProps) {
  const syncStatus = item.syncStatus;
  const isPending = syncStatus === "pending";
  const isError = syncStatus === "error";
  const isSuccess = syncStatus === "success";
  const isSyncDeleting = item.syncOperation === "delete" && isPending;
  const isLocal = item.id.startsWith(LOCAL_THOUGHT_PREFIX);
  const effectiveDeleting = isDeleting || isSyncDeleting;
  const mutationDisabled = disabled || isLocked;
  const isDragDisabled = effectiveDeleting || mutationDisabled || isOverlay;
  const { t } = useTranslation();
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    const needsTick = (item.syncExpiresAt && (isPending || isError)) || (item.syncSuccessAt && isSuccess);
    if (!needsTick) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isError, isPending, isSuccess, item.syncExpiresAt, item.syncSuccessAt]);

  const highlightStyles = getHighlightStyles(isHighlighted, highlightType);
  const hoverShadowClass = isDragDisabled ? "" : "hover:shadow-xl";
  const cursorClass = isDragDisabled ? "cursor-default" : "cursor-grab";
  const syncBorderClass = getSyncBorderClass(isError, isPending, isSuccess);
  const syncRingClass = getSyncRingClass(isError, isPending);
  const sectionIconColorClasses = getSectionIconClasses(containerId);
  const remainingTime = getRemainingTime(item.syncExpiresAt, now);
  const successFaded = Boolean(isSuccess && item.syncSuccessAt && (now - new Date(item.syncSuccessAt).getTime() > 1500));
  const successOpacityClass = successFaded ? "opacity-50" : "opacity-100";
  const showSyncMeta = Boolean(remainingTime && (isPending || isError));
  const canEdit = Boolean(onEdit) && !isPending && !isSuccess && !mutationDisabled;
  const canToggleLock = Boolean(onToggleLock) && !isLocal && !isPending && !isError && !isSuccess;
  const showRetryAction = Boolean(isError && onRetrySync);
  const showMoveAction = Boolean(onMoveToAmbiguous && containerId !== "ambiguous" && !isLocal && !isPending && !isError && !isSuccess && !mutationDisabled);
  const showDeleteAction = Boolean(showDeleteIcon && onDelete && !isLocal && !isPending && !isError && !isSuccess && !mutationDisabled);
  const isSemanticallyDisabled = effectiveDeleting || disabled || isOverlay;
  const cardClassName = getCardClassName({
    isHighlighted,
    highlightType,
    syncBorderClass,
    syncRingClass,
    hoverShadowClass,
    isDeleting: effectiveDeleting,
    isDragDisabled,
    cursorClass,
    isOverlay,
    isLocked,
  });

  const style = {
    transform: isActiveItem ? "none" : CSS.Transform.toString(transform ?? null),
    transition: isActiveItem ? "none" : (transition || "transform 250ms ease-in-out"),
    opacity: isActiveItem ? 0.4 : (isDragging || effectiveDeleting ? 0.5 : 1),
    pointerEvents: (isActiveItem || isOverlay ? "none" : "auto") as React.CSSProperties["pointerEvents"],
    ...highlightStyles,
  } as React.CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        willChange: "transform",
        backfaceVisibility: "hidden",
        touchAction: isDragDisabled ? "auto" : "none",
      }}
      {...attributes}
      {...(isDragDisabled ? {} : (listeners as Record<string, unknown> | undefined))}
      aria-disabled={isSemanticallyDisabled || undefined}
        className={cardClassName}
    >
      <div className={`grid items-start gap-x-4 ${hasVisibleRailActions({
        canToggleLock,
        isPending,
        showRetrySync: showRetryAction,
        isSuccess,
        canEdit,
        showMoveAction,
        showDeleteAction,
      }) ? "grid-cols-[minmax(0,1fr)_2.5rem]" : "grid-cols-1"}`}>
        <div className="min-w-0">
          <CardContent item={item} locationContext={locationContext} />
          <div className="mt-2 flex min-h-[24px] flex-col justify-end gap-1">
            <SyncMeta show={showSyncMeta} isError={isError} remainingTime={remainingTime} t={t} />
          </div>
          <SortableItemReviewFooter
            item={item}
            containerId={containerId}
            isHighlighted={isHighlighted}
            highlightType={highlightType}
            onKeep={onKeep}
            onRevert={onRevert}
            t={t}
            isOverlay={isOverlay}
          />
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
          isLocked={isLocked}
          mutationDisabled={mutationDisabled}
          canToggleLock={canToggleLock}
          showDeleteIcon={showDeleteIcon}
          onDelete={onDelete}
          onEdit={onEdit}
          onMoveToAmbiguous={onMoveToAmbiguous}
          onRetrySync={onRetrySync}
          onToggleLock={onToggleLock}
          sectionIconColorClasses={sectionIconColorClasses}
          successOpacityClass={successOpacityClass}
          t={t}
          isOverlay={isOverlay}
          className="justify-self-end self-start"
        />
      </div>
    </div>
  );
}

export function SortableItemPreview(props: SortableItemPreviewProps) {
  return <SortableItemCard {...props} isDragging={false} isOverlay={true} />;
}

export default function SortableItem({
  item,
  containerId,
  locationContext,
  onEdit,
  showDeleteIcon = false,
  onDelete,
  isDeleting = false,
  isHighlighted = false,
  highlightType = "moved",
  onKeep,
  onRevert,
  activeId,
  onMoveToAmbiguous,
  onRetrySync,
  onToggleLock,
  disabled = false,
  isLocked = false,
}: SortableItemProps) {
  const isDragDisabled = isDeleting || disabled || isLocked;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: item.id,
      data: {
        container: containerId,
        outlinePointId: item.outlinePointId,
        subPointId: item.subPointId,
      },
      disabled: isDragDisabled,
    });

  const isActiveItem = activeId === item.id;

  return (
    <SortableItemCard
      item={item}
      containerId={containerId}
      locationContext={locationContext}
      onEdit={onEdit}
      showDeleteIcon={showDeleteIcon}
      onDelete={onDelete}
      isDeleting={isDeleting}
      isHighlighted={isHighlighted}
      highlightType={highlightType}
      onKeep={onKeep}
      onRevert={onRevert}
      onMoveToAmbiguous={onMoveToAmbiguous}
      onRetrySync={onRetrySync}
      onToggleLock={onToggleLock}
      disabled={disabled}
      isLocked={isLocked}
      attributes={attributes as React.HTMLAttributes<HTMLDivElement>}
      listeners={listeners}
      setNodeRef={setNodeRef as (node: HTMLDivElement | null) => void}
      isDragging={isDragging}
      isActiveItem={isActiveItem}
      transform={transform}
      transition={transition}
    />
  );
}
