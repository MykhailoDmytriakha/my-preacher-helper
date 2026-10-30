import { ChevronRightIcon } from '@heroicons/react/24/outline';
import React, { createContext, useContext, useMemo } from 'react';

import { markdownProseClasses } from '@/components/MarkdownDisplay';
import { FOLDING_TAGS } from '@/utils/markdownFolding';
import { sectionDisplayLabel } from '@/utils/markdownSections';
import { useTranslation } from '@locales/useTranslation';

import { FOLD_ARROW_TONE, foldArrowOffset, headingTone, sectionAir } from './foldableHeadingStyle';

import type { MarkdownOutlineControl } from '@/hooks/useMarkdownOutline';
import type { MarkdownSection } from '@/utils/markdownSections';
import type { Components } from 'react-markdown';

interface PresentationProps {
    control: MarkdownOutlineControl;
    compact?: boolean;
    scrollMarginTop?: number;
    sectionBadge?: (section: MarkdownSection) => React.ReactNode;
    sectionExtra?: (section: MarkdownSection) => React.ReactNode;
    children: React.ReactNode;
}
type PresentationValue = Omit<PresentationProps, 'children'> & { sectionsById: Map<string, MarkdownSection> };
type SectionProps = { children?: React.ReactNode; 'data-section-id'?: string };
const PresentationContext = createContext<PresentationValue | null>(null);
const HEADING_RESET = '[&>*]:!my-0';

/** Stable component types keep host-owned cards/editors mounted when another section folds. */
export function FoldingPresentation({ children, ...props }: PresentationProps) {
    const sectionsById = useMemo(() => {
        const sections = new Map<string, MarkdownSection>();
        const collect = (nodes: MarkdownSection[]): void => {
            nodes.forEach(section => { sections.set(section.id, section); collect(section.children); });
        };
        collect(props.control.outline.sections);
        return sections;
    }, [props.control.outline.sections]);
    return <PresentationContext.Provider value={{ ...props, sectionsById }}>{children}</PresentationContext.Provider>;
}
function useSection(props: SectionProps) {
    const value = useContext(PresentationContext)!;
    return { ...value, section: value.sectionsById.get(props['data-section-id'] ?? '') };
}
const hasContent = (section: MarkdownSection) => Boolean(section.body) || section.children.length > 0;

export const FOLDING_COMPONENTS = {
        [FOLDING_TAGS.section]: function FoldSection(props: SectionProps) {
            const { section, scrollMarginTop } = useSection(props);
            return section ? (
                <section data-section-id={section.id} className={`${sectionAir(section.level)} first:mt-0`} style={{ scrollMarginTop }}>
                    {props.children}
                </section>
            ) : null;
        },
        [FOLDING_TAGS.heading]: function FoldHeading(props: SectionProps) {
            const { section, control, compact, sectionBadge } = useSection(props);
            const { t } = useTranslation();
            if (!section) return null;
            const collapsed = control.isCollapsed(section.id);
            const filled = hasContent(section);
            const label = sectionDisplayLabel(section, t('textOutline.untitledSection'));
            return (
                <div className="flex items-start gap-1">
                    {filled ? (
                        <button type="button" onClick={() => control.toggleSection(section.id)} aria-expanded={!collapsed}
                            aria-label={t('textOutline.toggleSection', { title: label })}
                            className={`${foldArrowOffset(section.level)} shrink-0 rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 sm:p-0.5 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200 ${FOLD_ARROW_TONE}`}>
                            <ChevronRightIcon className={`h-4 w-4 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
                        </button>
                    ) : <span className="shrink-0 w-7 sm:w-5" />}
                    <div onClick={filled ? event => {
                        if (event.target instanceof Element && event.target.closest('a, button')) return;
                        control.toggleSection(section.id);
                    } : undefined} className={`flex min-w-0 flex-1 items-start gap-2 ${filled ? 'cursor-pointer' : ''}`}>
                        <div className={`min-w-0 ${HEADING_RESET} ${headingTone(section.level)}`}>
                            <div className={markdownProseClasses('', compact)}>{props.children}</div>
                        </div>
                        {collapsed && filled && <span className="shrink-0 select-none self-center text-sm text-gray-400 dark:text-gray-500" aria-hidden="true">&hellip;</span>}
                        {sectionBadge?.(section)}
                    </div>
                </div>
            );
        },
        [FOLDING_TAGS.body]: function FoldBody(props: SectionProps) {
            const { section, control, sectionExtra } = useSection(props);
            return section && !control.isCollapsed(section.id) && hasContent(section) ? (
                <div className="ml-0 border-l border-gray-200 pl-2.5 sm:ml-2 sm:pl-4 dark:border-gray-700">
                    {sectionExtra?.(section)}{props.children}
                </div>
            ) : null;
        },
        [FOLDING_TAGS.content]: function FoldContent({ children }: SectionProps) {
            const { compact } = useContext(PresentationContext)!;
            const visible = React.Children.toArray(children).some(child => typeof child !== 'string' || Boolean(child.trim()));
            return visible ? <div className={markdownProseClasses('', compact)}>{children}</div> : <>{children}</>;
        },
    } as Components;
