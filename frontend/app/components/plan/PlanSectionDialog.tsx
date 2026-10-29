'use client';

import { X } from 'lucide-react';
import React, { useId } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useMarkdownHtmlPlugins } from '@/hooks/useMarkdownHtmlPlugins';
import { useModalLayer } from '@/hooks/useModalLayer';
import { normalizePlanArrows, normalizePlanPointHeadings, sanitizeMarkdown } from '@/utils/markdownUtils';
import { SERMON_SECTION_COLORS } from '@/utils/themeColors';
import { useTranslation } from '@locales/useTranslation';

import { getPlanMarkdownStyles } from './markdownStyles';

export type PlanSection = 'introduction' | 'main' | 'conclusion';

interface PlanSectionDialogProps {
  section: PlanSection;
  markdown: string;
  onClose: () => void;
}

/** A read-only section stays in its owner's React tree and shares the app's modal rules. */
export default function PlanSectionDialog({ section, markdown, onClose }: PlanSectionDialogProps) {
  const { t } = useTranslation();
  const htmlPlugins = useMarkdownHtmlPlugins();
  const titleId = useId();
  const closeLabel = t('actions.close') || t('common.close');
  const layer = useModalLayer({ onClose });

  const colors = section === 'main' ? SERMON_SECTION_COLORS.mainPart : SERMON_SECTION_COLORS[section];
  const content = normalizePlanArrows(normalizePlanPointHeadings(sanitizeMarkdown(markdown || t('plan.noContent'))));

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div {...layer}
      className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4"
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="bg-white dark:bg-gray-800 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-auto p-6 shadow-lg">
        <div className="flex justify-between items-center gap-4 mb-4">
          <h2 id={titleId} className="text-xl font-bold">{t('plan.pageTitle')} - {t(`sections.${section}`)}</h2>
          <button type="button" onClick={onClose}
            title={closeLabel} aria-label={closeLabel}
            className="shrink-0 flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors bg-gray-600 text-white hover:bg-gray-700">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <style>{getPlanMarkdownStyles()}</style>
        <div className={`pl-2 border-l-4 ${colors.border.split(' ')[0]} dark:${colors.darkBorder} prose-${section}`}>
          <div className="prose dark:prose-invert max-w-none mb-4">
            <div className={`prose prose-sm md:prose-base dark:prose-invert max-w-none markdown-content prose-${section} ${section}-section`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={htmlPlugins}>{content}</ReactMarkdown>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
