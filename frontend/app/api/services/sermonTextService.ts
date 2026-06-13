import { getSortedThoughts } from '@/utils/sermonSorting';
import {
    getVisualOrderedThoughtsBySection,
    getVisualSectionOutlinePoints,
    type VisualOutlineSectionKey
} from '@/utils/sermonVisualOrder';

import type { Sermon, Thought } from '@/models/models';

export const SECTION_CONFIG = {
    introduction: { tag: 'introduction', title: 'Вступление' },
    mainPart: { tag: 'main', title: 'Основная часть' },
    conclusion: { tag: 'conclusion', title: 'Заключение' },
} as const;

export type SectionKey = keyof typeof SECTION_CONFIG;

const SECTION_TO_VISUAL_KEY: Record<SectionKey, VisualOutlineSectionKey> = {
    introduction: 'introduction',
    mainPart: 'main',
    conclusion: 'conclusion',
};

/**
 * Normalizes a `sections` request value ('all' | key | array of keys) into the
 * concrete list of valid section keys, in canonical order. Returns [] when an
 * array/string carries no valid keys — callers decide how to treat empty.
 */
export function resolveSections(input: unknown): SectionKey[] {
    const all = Object.keys(SECTION_CONFIG) as SectionKey[];
    if (input === 'all' || input == null) return all;
    const arr = Array.isArray(input) ? input : [input];
    return all.filter(k => (arr as unknown[]).includes(k));
}

export function getSectionThoughts(sermon: Sermon, sectionKey: SectionKey): Thought[] {
    const sectionMap: Record<SectionKey, 'introduction' | 'main' | 'conclusion'> = {
        introduction: 'introduction',
        mainPart: 'main',
        conclusion: 'conclusion'
    };

    // Use the shared visual-order utility via getSortedThoughts.
    return getSortedThoughts(sermon, sectionMap[sectionKey]);
}

export function getSectionOutlinePoints(sermon: Sermon, sectionKey: SectionKey) {
    return getVisualSectionOutlinePoints(sermon, SECTION_TO_VISUAL_KEY[sectionKey]);
}

/**
 * Returns thoughts in the same visible order as the Structure page:
 * section structure order -> outline point order -> sub-point/direct interleave by position.
 */
export function getSectionThoughtsInVisualOrder(sermon: Sermon, sectionKey: SectionKey): Thought[] {
    return getVisualOrderedThoughtsBySection(sermon, SECTION_TO_VISUAL_KEY[sectionKey]);
}

/**
 * Extracts plain text from sermon for TTS processing.
 */
export function extractSermonText(sermon: Sermon, targetSection?: SectionKey): string {
    const lines: string[] = [];

    // Only add title/verse if we are processing 'all' or specifically 'introduction'
    const isIntroOrAll = !targetSection || targetSection === 'introduction';

    if (isIntroOrAll) {
        if (sermon.title) lines.push(`Проповедь: ${sermon.title}`);
        if (sermon.verse) lines.push(`Текст Писания: ${sermon.verse}`);
        lines.push('');
    }

    // Determine which sections to process
    const sectionsToProcess = targetSection
        ? [targetSection]
        : (['introduction', 'mainPart', 'conclusion'] as SectionKey[]);

    for (const sectionKey of sectionsToProcess) {
        const sectionThoughts = getSectionThoughtsInVisualOrder(sermon, sectionKey);
        const config = SECTION_CONFIG[sectionKey];

        if (sectionThoughts.length > 0) {
            lines.push(`${config.title}:`);
            for (const thought of sectionThoughts) {
                lines.push(`- ${thought.text}`);
            }
            lines.push('');
        }
    }

    return lines.join('\n').trim();
}
