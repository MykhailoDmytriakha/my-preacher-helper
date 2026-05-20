'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import NodeTreeEditor from '@/components/studies/node/NodeTreeEditor';
import { ContentNode } from '@/models/models';
import { markdownToNodeTree } from '@/utils/nodeTreeMigration';

interface ConvertToNodesModalProps {
  open: boolean;
  sourceContent: string;
  onConfirm: (rootNode: ContentNode) => void;
  onCancel: () => void;
}

interface TreeStats {
  nodeCount: number;
  maxDepth: number;
}

function hasVisibleContent(node: ContentNode): boolean {
  return Boolean(node.header?.trim() || node.text?.trim() || (node.media?.length ?? 0) > 0);
}

function collectTreeStats(node: ContentNode, depth: number, forceVisible: boolean): TreeStats {
  const isVisible = forceVisible || hasVisibleContent(node);
  const childDepth = isVisible ? depth + 1 : depth;
  const childStats = node.children?.map((child) => collectTreeStats(child, childDepth, false)) ?? [];

  return childStats.reduce<TreeStats>(
    (acc, stats) => ({
      nodeCount: acc.nodeCount + stats.nodeCount,
      maxDepth: Math.max(acc.maxDepth, stats.maxDepth),
    }),
    {
      nodeCount: isVisible ? 1 : 0,
      maxDepth: isVisible ? depth : 0,
    }
  );
}

function getTreeStats(rootNode: ContentNode): TreeStats {
  const rootVisible = hasVisibleContent(rootNode) || (rootNode.children?.length ?? 0) === 0;
  const stats = collectTreeStats(rootNode, 1, rootVisible);

  return {
    nodeCount: Math.max(stats.nodeCount, 1),
    maxDepth: Math.max(stats.maxDepth, 1),
  };
}

export default function ConvertToNodesModal({
  open,
  sourceContent,
  onConfirm,
  onCancel,
}: ConvertToNodesModalProps) {
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const rootNode = useMemo(() => (open ? markdownToNodeTree(sourceContent) : null), [open, sourceContent]);
  const stats = useMemo(() => (rootNode ? getTreeStats(rootNode) : { nodeCount: 0, maxDepth: 0 }), [rootNode]);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !open || !rootNode) return null;

  const modalContent = (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label={t('common.close')}
        className="absolute inset-0 h-full w-full bg-black/40"
        onClick={onCancel}
      />
      <div
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl dark:bg-gray-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('studiesWorkspace.convertModal.title')}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('studiesWorkspace.convertModal.nodeCountStat', {
              nodes: stats.nodeCount,
              levels: stats.maxDepth,
            })}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t('studiesWorkspace.convertModal.preview')}
          </p>
          <NodeTreeEditor rootNode={rootNode} onChange={() => undefined} readOnly />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {t('studiesWorkspace.convertModal.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(rootNode)}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            {t('studiesWorkspace.convertModal.apply')}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
