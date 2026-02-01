import { Sermon, Thought } from '@/models/models';
import { getSortedThoughts } from '@/utils/sermonSorting';

export const SECTION_CONFIG = {
    introduction: { tag: 'introduction', title: 'Вступление' },
    mainPart: { tag: 'main', title: 'Основная часть' },
    conclusion: { tag: 'conclusion', title: 'Заключение' },
} as const;

export type SectionKey = keyof typeof SECTION_CONFIG;

export function getSectionThoughts(sermon: Sermon, sectionKey: SectionKey): Thought[] {
    const sectionMap: Record<SectionKey, 'introduction' | 'main' | 'conclusion'> = {
        introduction: 'introduction',
        mainPart: 'main',
        conclusion: 'conclusion'
    };

    // Use the shared 'Structure First' sorting utility
    return getSortedThoughts(sermon, sectionMap[sectionKey]);
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
        const sectionThoughts = getSectionThoughts(sermon, sectionKey);
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
