'use client';

import {
  closestCenter,
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useClickOutside } from '@/hooks/useClickOutside';
import { useWikilinkResolver } from '@/hooks/useWikilinkResolver';
import { createDebug } from '@/utils/debug';
import { makeId } from '@/utils/makeId';

import NodeView from './NodeView';
import {
  collectSubtreeIds,
  findLocation,
  findParentId,
  nodeContentEquals,
  selectAncestorIds,
  selectFlat,
  selectLocationMap,
  selectTree,
  useNodeTree,
} from './useNodeTree';

import type { FlatNode, NodeTreeState } from './useNodeTree';
import type { ContentNode } from '@/models/models';
import type { CSSProperties, HTMLAttributes, ReactElement } from 'react';

const debug = createDebug('studies/node/tree');

interface NodeTreeEditorProps {
  rootNode: ContentNode;
  onChange: (root: ContentNode) => void;
  autoFocusFirst?: boolean;
  currentNoteId?: string;
  /**
   * When true the tree renders as read-only: just headings + markdown text +
   * media tiles + chevron folds. No DnD, no keyboard handler, no edit UI.
   * Chevron toggles still dispatch `toggleCollapse` so folds work and persist
   * via the same autosave path.
   */
  readOnly?: boolean;
}

const createNodeId = (): string => makeId('node');

function hasTextValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function hasVisibleNodeContent(node: ContentNode | undefined): boolean {
  return Boolean(node?.header?.trim() || node?.text?.trim() || (node?.media?.length ?? 0) > 0);
}

// Read-mode dedup: hide root row when it visibly mirrors the first child.
// Uses the same equality helper the reducer's lift dedup applies so both
// modes stay consistent.
function rootContentMirrorsFirstChild(
  root: ContentNode | undefined,
  firstChild: ContentNode | undefined
): boolean {
  if (!root || !firstChild) return false;
  if (!hasVisibleNodeContent(root)) return false;
  return nodeContentEquals(root, firstChild);
}

function isEmptyLeaf(state: NodeTreeState, id: string | null): boolean {
  if (!id) return false;

  const node = state.nodes[id];
  if (!node) return false;

  return !hasTextValue(node.header)
    && !hasTextValue(node.text)
    && (node.media?.length ?? 0) === 0
    && (node.children?.length ?? 0) === 0;
}

function isInteractiveTextEditor(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return true;
  // Tiptap renders the text body as a contenteditable div, not a textarea —
  // missing this case lets Enter/Tab inside the rich editor bubble up to
  // the tree shortcut handler and mutate the node tree.
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}

const HORIZONTAL_DEPTH_THRESHOLD = 40;

type DropIndicator = 'before' | 'after' | 'inside';

interface DropProjection {
  parentId: string;
  index: number;
  depth: number;
  indicatorId: string;
  indicator: DropIndicator;
}

type ProjectableDragEvent = Pick<DragOverEvent, 'active' | 'over' | 'delta'>;

function getNodeChildIds(state: NodeTreeState, id: string): string[] {
  return state.nodes[id]?.children?.map((child) => child.id) ?? [];
}

function isInvalidDropTarget(state: NodeTreeState, draggedId: string, targetParentId: string): boolean {
  return targetParentId === draggedId || selectAncestorIds(state, targetParentId).includes(draggedId);
}

function computeSiblingProjection(
  state: NodeTreeState,
  flatNodes: FlatNode[],
  activeId: string,
  overId: string
): DropProjection | null {
  const overItem = flatNodes.find((item) => item.id === overId);
  if (!overItem) return null;

  const sourceLocation = findLocation(state, activeId);
  if (!sourceLocation) return null;

  if (overId === state.rootId) {
    if (isInvalidDropTarget(state, activeId, state.rootId)) return null;

    return {
      parentId: state.rootId,
      index: 0,
      depth: 1,
      indicatorId: state.rootId,
      indicator: 'after',
    };
  }

  const targetParentId = findParentId(state, overId);
  if (!targetParentId || isInvalidDropTarget(state, activeId, targetParentId)) return null;

  const activeFlatIndex = flatNodes.findIndex((item) => item.id === activeId);
  const overFlatIndex = flatNodes.findIndex((item) => item.id === overId);
  const indicator: DropIndicator = activeFlatIndex < overFlatIndex ? 'after' : 'before';
  const overSiblingIndex = getNodeChildIds(state, targetParentId).indexOf(overId);
  if (overSiblingIndex === -1) return null;

  const nextIndex = sourceLocation.parentId === targetParentId
    ? overSiblingIndex
    : overSiblingIndex + (indicator === 'after' ? 1 : 0);

  return {
    parentId: targetParentId,
    index: nextIndex,
    depth: overItem.depth,
    indicatorId: overId,
    indicator,
  };
}

function computeNestProjection(
  state: NodeTreeState,
  flatNodes: FlatNode[],
  activeId: string
): DropProjection | null {
  const activeItem = flatNodes.find((item) => item.id === activeId);
  const sourceLocation = findLocation(state, activeId);
  if (!activeItem || !sourceLocation || sourceLocation.index === 0 || activeItem.depth === 0) return null;

  const previousSiblingId = getNodeChildIds(state, sourceLocation.parentId)[sourceLocation.index - 1];
  if (!previousSiblingId || isInvalidDropTarget(state, activeId, previousSiblingId)) return null;

  return {
    parentId: previousSiblingId,
    index: getNodeChildIds(state, previousSiblingId).length,
    depth: activeItem.depth + 1,
    indicatorId: previousSiblingId,
    indicator: 'inside',
  };
}

function computeOutdentProjection(
  state: NodeTreeState,
  flatNodes: FlatNode[],
  activeId: string
): DropProjection | null {
  const activeItem = flatNodes.find((item) => item.id === activeId);
  const sourceLocation = findLocation(state, activeId);
  if (!activeItem || !sourceLocation || sourceLocation.parentId === state.rootId) return null;

  const grandParentId = findParentId(state, sourceLocation.parentId);
  if (!grandParentId || isInvalidDropTarget(state, activeId, grandParentId)) return null;

  const parentIndex = getNodeChildIds(state, grandParentId).indexOf(sourceLocation.parentId);
  if (parentIndex === -1) return null;

  return {
    parentId: grandParentId,
    index: parentIndex + 1,
    depth: Math.max(activeItem.depth - 1, 0),
    indicatorId: sourceLocation.parentId,
    indicator: 'after',
  };
}

function computeDropProjection(
  state: NodeTreeState,
  flatNodes: FlatNode[],
  activeId: string,
  overId: string,
  deltaX: number
): DropProjection | null {
  if (activeId === state.rootId || activeId === overId || !state.nodes[activeId] || !state.nodes[overId]) {
    return null;
  }

  const draggedSubtreeIds = new Set(collectSubtreeIds(state, activeId));
  if (draggedSubtreeIds.has(overId)) return null;

  if (deltaX > HORIZONTAL_DEPTH_THRESHOLD) {
    return computeNestProjection(state, flatNodes, activeId);
  }

  if (deltaX < -HORIZONTAL_DEPTH_THRESHOLD) {
    return computeOutdentProjection(state, flatNodes, activeId);
  }

  return computeSiblingProjection(state, flatNodes, activeId, overId);
}

interface SortableNodeRowProps {
  id: string;
  indicator: DropIndicator | null;
  children: (dragHandleProps: HTMLAttributes<HTMLElement>) => ReactElement;
}

function SortableNodeRow({ id, indicator, children }: SortableNodeRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    zIndex: isDragging ? 20 : 1,
  };
  const dragHandleProps: HTMLAttributes<HTMLElement> = {
    ...(attributes as HTMLAttributes<HTMLElement>),
    ...(listeners ?? {}),
  };
  const lineClass = 'pointer-events-none absolute left-2 right-2 z-10 border-t-2 border-emerald-500';

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {indicator === 'before' ? <div className={`${lineClass} -top-0.5`} /> : null}
      <div className={indicator === 'inside' ? 'rounded-md border border-dashed border-emerald-400' : undefined}>
        {children(dragHandleProps)}
      </div>
      {indicator === 'after' ? <div className={`${lineClass} -bottom-0.5`} /> : null}
    </div>
  );
}

export function NodeTreeEditor({
  rootNode,
  onChange,
  autoFocusFirst = false,
  currentNoteId,
  readOnly = false,
}: NodeTreeEditorProps) {
  const { t } = useTranslation();
  const { state, dispatch } = useNodeTree(rootNode);
  const containerRef = useRef<HTMLDivElement>(null);
  const wikilinkResolver = useWikilinkResolver();
  const [dropProjection, setDropProjection] = useState<DropProjection | null>(null);
  // Reference-based change detection. selectTree() returns the same cached
  // object ref while state hasn't changed (WeakMap-memoised in useNodeTree),
  // so `tree !== lastEmittedTreeRef.current` is true only after a real
  // mutation. Replaces the O(N) `JSON.stringify(tree)` signature we used to
  // recompute on every render. Initialised to the first-seen tree/prop so
  // the very first effect tick has the "no change since mount" baseline —
  // otherwise we'd see a phantom onChange before the user does anything.
  const lastEmittedTreeRef = useRef<ContentNode | null>(null);
  const lastSeenRootNodePropRef = useRef<ContentNode | null>(rootNode);
  const skippedInitialChangeRef = useRef(false);
  const didAutoFocusRef = useRef(false);
  // Editable view hides the root row — root is a structural wrapper around
  // the children list, not a node the user types into. Any content that used
  // to sit on root is migrated into a real first child via `liftRootContent`
  // below, so legacy data stays editable.
  const flatNodes = useMemo(() => selectFlat(state, { includeRoot: false }), [state]);
  const flatNodeIds = useMemo(() => flatNodes.map((node) => node.id), [flatNodes]);
  const rootStateNode = state.nodes[state.rootId];

  // Shared O(1) parent + sibling-index lookup. Selector caches by
  // `state.nodes` ref so this rebuilds only when the actual node graph
  // changes — focus/edit toggles don't invalidate it.
  const locationByIdMap = useMemo(() => selectLocationMap(state), [state]);
  // Read mode hides the root row when (a) it has no content at all (empty
  // structural wrapper), OR (b) its content is byte-identical to the first
  // child — a legacy lift artifact that would otherwise render a visible
  // duplicate. Edit mode applies the same dedup via `liftRootContent` in the
  // reducer; this keeps both views consistent.
  const readOnlyFlatNodes = useMemo(() => {
    const firstChildId = rootStateNode?.children?.[0]?.id;
    const firstChild = firstChildId ? state.nodes[firstChildId] : undefined;
    const mirrors = rootContentMirrorsFirstChild(rootStateNode, firstChild);
    const includeRoot = hasVisibleNodeContent(rootStateNode) && !mirrors;
    if (mirrors) {
      debug.warn('read-mode dedup — hiding root row that mirrors first child', {
        rootHeader: rootStateNode?.header,
        firstChildId,
      });
    }
    return selectFlat(state, { includeRoot });
  }, [rootStateNode, state]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );
  const tree = useMemo(() => selectTree(state), [state]);
  const isEmptyTree = isEmptyLeaf(state, state.rootId);

  useEffect(() => {
    if (readOnly) {
      lastSeenRootNodePropRef.current = rootNode;
      dispatch({ type: 'setRoot', root: rootNode });
      return;
    }

    // Prop rootNode is the same reference we just emitted — no foreign change
    // arrived from the parent. Skip the resetting setRoot dispatch.
    if (lastSeenRootNodePropRef.current === rootNode) return;
    lastSeenRootNodePropRef.current = rootNode;

    debug.log('prop rootNode changed — resetting state via setRoot', {
      rootHeader: rootNode.header,
      childCount: rootNode.children?.length ?? 0,
    });
    dispatch({ type: 'setRoot', root: rootNode });
  }, [dispatch, readOnly, rootNode]);

  // Migrate any legacy content that landed on the root node (header/text/media)
  // into a real first child. After this runs, root is always a pure wrapper —
  // matches the mental model "study title is the root, every note inside is
  // a sibling list of children". One-shot per loaded tree: a `didLift` ref
  // gates the dispatch so it doesn't re-fire if, later in the session, the
  // user deletes the last child (root would temporarily have content + no
  // children again, but the user did NOT mean to re-introduce a phantom row).
  const rootHasContent = Boolean(rootStateNode?.header || rootStateNode?.text || (rootStateNode?.media?.length ?? 0) > 0);
  // Gate: lift is checked exactly once per loaded tree. If the initial state
  // has content sitting on root (with or without existing children), lift it
  // into a new first child. After that, root staying empty (e.g. user deleted
  // the last visible child) is a legitimate state — never re-lift.
  // Single effect: reset the "have we checked lift for this loaded tree" flag
  // when a new root signature arrives AND run the check in the same tick.
  // Folding the previous two effects removes the temporal coupling — there's
  // no longer a "reset first, check second" ordering invariant for future
  // refactors to accidentally break.
  const liftCheckedForPropRef = useRef<ContentNode | null>(null);
  useEffect(() => {
    if (readOnly) return;
    if (!rootStateNode) return;
    // Reference compare — only re-run lift when a *new* rootNode prop arrives.
    if (liftCheckedForPropRef.current === rootNode) return;
    liftCheckedForPropRef.current = rootNode;

    debug.log('lift-check fired', {
      rootHasContent,
      rootHeader: rootStateNode.header,
      rootText: rootStateNode.text?.slice(0, 60),
      mediaCount: rootStateNode.media?.length ?? 0,
      childCount: rootStateNode.children?.length ?? 0,
    });
    if (rootHasContent) {
      dispatch({ type: 'liftRootContent', childId: createNodeId() });
    }
  }, [dispatch, readOnly, rootHasContent, rootStateNode, rootNode]);

  useEffect(() => {
    if (!skippedInitialChangeRef.current) {
      skippedInitialChangeRef.current = true;
      lastEmittedTreeRef.current = tree;
      return;
    }

    if (readOnly) {
      lastEmittedTreeRef.current = tree;
      return;
    }

    // `tree` is a stable ref while state hasn't changed (WeakMap-memoised in
    // selectTree). Pure reference compare — no full-tree JSON.stringify.
    if (tree === lastEmittedTreeRef.current) return;

    debug.log('tree mutated — emitting onChange to parent', {
      childCount: tree.children?.length ?? 0,
    });
    lastEmittedTreeRef.current = tree;
    // Mark the same tree as "what we last gave parent" so when the parent
    // hands it right back as the rootNode prop, the setRoot effect skips.
    lastSeenRootNodePropRef.current = tree;
    onChange(tree);
  }, [onChange, readOnly, tree]);

  useEffect(() => {
    if (!autoFocusFirst || didAutoFocusRef.current) return;

    didAutoFocusRef.current = true;
    dispatch({ type: 'setFocus', nodeId: state.rootId });
    containerRef.current?.focus();
  }, [autoFocusFirst, dispatch, state.rootId]);

  useClickOutside([containerRef], () => {
    dispatch({ type: 'stopEdit' });
    dispatch({ type: 'setFocus', nodeId: null });
  }, { enabled: state.isEditingText });

  const focusContainer = useCallback((): void => {
    containerRef.current?.focus();
  }, []);

  const focusNode = useCallback((nodeId: string): void => {
    dispatch({ type: 'setFocus', nodeId });
    focusContainer();
  }, [dispatch, focusContainer]);

  const startEditingNode = useCallback((nodeId: string): void => {
    dispatch({ type: 'setFocus', nodeId });
    dispatch({ type: 'startEdit' });
    focusContainer();
  }, [dispatch, focusContainer]);

  const insertSibling = useCallback((): void => {
    if (!state.focusedNodeId) return;

    dispatch({
      type: 'insertSibling',
      id: state.focusedNodeId,
      newId: createNodeId(),
    });
  }, [dispatch, state.focusedNodeId]);

  const insertChild = useCallback((): void => {
    if (!state.focusedNodeId) return;

    dispatch({
      type: 'insertChild',
      id: state.focusedNodeId,
      newId: createNodeId(),
    });
  }, [dispatch, state.focusedNodeId]);

  const dispatchFocusedAction = useCallback((
    type: 'promote' | 'demote' | 'moveUp' | 'moveDown' | 'deleteNode'
  ): void => {
    if (!state.focusedNodeId) return;
    dispatch({ type, id: state.focusedNodeId });
  }, [dispatch, state.focusedNodeId]);

  const handleEditModeKeyDown = useCallback((
    event: KeyboardEvent<HTMLDivElement>,
    isCommandKey: boolean
  ): boolean => {
    if (!state.isEditingText || !isInteractiveTextEditor()) return false;

    if (event.key === 'Escape') {
      event.preventDefault();
      dispatch({ type: 'stopEdit' });
      // Also drop focus — otherwise an empty focused node would auto-restart
      // edit via the NodeView "empty focused → startEdit" effect, looping
      // Escape into a no-op for the user.
      dispatch({ type: 'setFocus', nodeId: null });
      focusContainer();
      return true;
    }

    if (isCommandKey && event.key === 'Enter') {
      event.preventDefault();
      insertChild();
      return true;
    }

    // Empty leaf: let Backspace fall through to the node-delete branch in the
    // main handler. The textarea is empty so there's nothing to backspace
    // within — deleting the node is the only sensible thing.
    if (event.key === 'Backspace' && isEmptyLeaf(state, state.focusedNodeId)) {
      return false;
    }

    return true;
  }, [dispatch, focusContainer, insertChild, state]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    const isCommandKey = event.metaKey || event.ctrlKey;

    if (handleEditModeKeyDown(event, isCommandKey)) return;

    if (isCommandKey && event.key === 'Enter') {
      event.preventDefault();
      insertChild();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      insertSibling();
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      dispatchFocusedAction(event.shiftKey ? 'promote' : 'demote');
      return;
    }

    if (isCommandKey && event.key === 'ArrowUp') {
      event.preventDefault();
      dispatchFocusedAction('moveUp');
      return;
    }

    if (isCommandKey && event.key === 'ArrowDown') {
      event.preventDefault();
      dispatchFocusedAction('moveDown');
      return;
    }

    if (event.key === 'Backspace' && isEmptyLeaf(state, state.focusedNodeId)) {
      // Empty leaf: Backspace deletes the node even when the textarea is
      // technically open (we now auto-open it for empty focused nodes — the
      // textarea is itself empty so backspace has no character to remove).
      event.preventDefault();
      dispatchFocusedAction('deleteNode');
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      dispatch({ type: 'stopEdit' });
    }
  }, [
    dispatch,
    dispatchFocusedAction,
    handleEditModeKeyDown,
    insertChild,
    insertSibling,
    state,
  ]);

  const handleStartEmptyTree = (): void => {
    // Root is structural — the first user-visible node is its first child.
    // Create that child and start editing IT, so the user's first keystrokes
    // land in a real node (not in the invisible wrapper).
    dispatch({ type: 'insertChild', id: state.rootId, newId: createNodeId() });
    dispatch({ type: 'startEdit' });
    focusContainer();
  };

  const getProjectionFromDragEvent = useCallback((event: ProjectableDragEvent): DropProjection | null => {
    if (!event.over) return null;

    return computeDropProjection(
      state,
      flatNodes,
      String(event.active.id),
      String(event.over.id),
      event.delta.x
    );
  }, [flatNodes, state]);

  const handleDragOver = useCallback((event: DragOverEvent): void => {
    setDropProjection(getProjectionFromDragEvent(event));
  }, [getProjectionFromDragEvent]);

  const handleDragEnd = useCallback((event: DragEndEvent): void => {
    const projection = getProjectionFromDragEvent(event);
    setDropProjection(null);

    if (!projection) return;

    dispatch({
      type: 'moveNode',
      id: String(event.active.id),
      targetParentId: projection.parentId,
      targetIndex: projection.index,
    });
  }, [dispatch, getProjectionFromDragEvent]);

  const handleDragCancel = useCallback((): void => {
    setDropProjection(null);
  }, []);

  if (readOnly) {
    return (
      <div ref={containerRef} data-testid="node-tree-editor-readonly" className="space-y-1">
        {readOnlyFlatNodes.map((item) => {
          const node = state.nodes[item.id];
          if (!node) return null;
          return (
            <NodeView
              key={item.id}
              node={node}
              depth={item.depth}
              readOnly
              wikilinkResolver={wikilinkResolver}
              state={{
                isFocused: false,
                isEditing: false,
                showActions: false,
                isRoot: item.id === state.rootId,
                hasChildren: item.hasChildren,
                isCollapsed: item.isCollapsed,
              }}
              treeActions={{
                onFocus: () => undefined,
                onStartEdit: () => undefined,
                onHeaderChange: () => undefined,
                onTextChange: () => undefined,
                onToggleCollapse: () => dispatch({ type: 'toggleCollapse', id: item.id }),
                onMediaRemove: () => undefined,
                onMediaAdd: () => undefined,
                onAddChild: () => undefined,
                onAddSibling: () => undefined,
                onMoveUp: () => undefined,
                onMoveDown: () => undefined,
                onDemote: () => undefined,
                onPromote: () => undefined,
                onDeleteNode: () => undefined,
              }}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="node-tree-editor"
      tabIndex={0}
      className="rounded-lg border border-gray-200 bg-white/80 p-2 outline-none focus:ring-2 focus:ring-emerald-400 dark:border-gray-700 dark:bg-gray-950/60"
      onKeyDown={handleKeyDown}
    >
      {isEmptyTree && !state.isEditingText ? (
        <button
          type="button"
          className="w-full rounded-md border border-dashed border-emerald-200 px-4 py-6 text-left text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
          onClick={handleStartEmptyTree}
        >
          {t('studiesWorkspace.nodeTree.startPlaceholder')}
        </button>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={flatNodeIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {flatNodes.map((item) => {
                const node = state.nodes[item.id];
                if (!node) return null;

                const isRootItem = item.id === state.rootId;
                const location = locationByIdMap.get(item.id);
                const indexAmongSiblings = location?.index ?? -1;
                const siblingCount = location?.siblingCount ?? 0;
                const parentIsRoot = location?.parentId === state.rootId;
                const canMoveUp = !isRootItem && indexAmongSiblings > 0;
                const canMoveDown = !isRootItem && indexAmongSiblings >= 0 && indexAmongSiblings < siblingCount - 1;
                const canDemote = !isRootItem && indexAmongSiblings > 0;
                const canPromote = !isRootItem && !parentIsRoot;

                return (
                  <SortableNodeRow
                    key={item.id}
                    id={item.id}
                    indicator={dropProjection?.indicatorId === item.id ? dropProjection.indicator : null}
                  >
                    {(dragHandleProps) => (
                      <NodeView
                        node={node}
                        depth={item.depth}
                        currentNoteId={currentNoteId}
                        dragHandleProps={dragHandleProps}
                        wikilinkResolver={wikilinkResolver}
                        state={{
                          isFocused: state.focusedNodeId === item.id,
                          isEditing: state.isEditingText && state.focusedNodeId === item.id,
                          showActions: state.focusedNodeId === item.id,
                          isRoot: isRootItem,
                          hasChildren: item.hasChildren,
                          isCollapsed: item.isCollapsed,
                        }}
                        capabilities={{
                          canMoveUp,
                          canMoveDown,
                          canDemote,
                          canPromote,
                        }}
                        treeActions={{
                          onFocus: () => focusNode(item.id),
                          onStartEdit: () => startEditingNode(item.id),
                          onHeaderChange: (header) => dispatch({ type: 'updateHeader', id: item.id, header }),
                          onTextChange: (text) => dispatch({ type: 'updateText', id: item.id, text }),
                          onToggleCollapse: () => dispatch({ type: 'toggleCollapse', id: item.id }),
                          onMediaRemove: (mediaId) => dispatch({ type: 'removeMedia', id: item.id, mediaId }),
                          onMediaAdd: (media) => dispatch({ type: 'addMedia', id: item.id, media }),
                          onAddChild: () => dispatch({ type: 'insertChild', id: item.id, newId: createNodeId() }),
                          onAddSibling: () => dispatch({ type: 'insertSibling', id: item.id, newId: createNodeId() }),
                          onMoveUp: () => dispatch({ type: 'moveUp', id: item.id }),
                          onMoveDown: () => dispatch({ type: 'moveDown', id: item.id }),
                          onDemote: () => dispatch({ type: 'demote', id: item.id }),
                          onPromote: () => dispatch({ type: 'promote', id: item.id }),
                          onDeleteNode: () => dispatch({ type: 'deleteNode', id: item.id }),
                        }}
                      />
                    )}
                  </SortableNodeRow>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {!rootStateNode ? (
        <div className="px-3 py-2 text-sm text-rose-600 dark:text-rose-300">
          Unable to render node tree root.
        </div>
      ) : null}
    </div>
  );
}

export default NodeTreeEditor;
