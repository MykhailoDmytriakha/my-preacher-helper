import { buildExportSections } from '@/utils/exportContentModel';
import { renderPlanExport, renderThoughtExport } from '@/utils/exportContentRenderer';
import { i18n } from '@locales/i18n';

import type { Sermon } from '@/models/models';
import type { ExportLabels, ExportTextOptions } from '@/utils/exportContentRenderer';

type ExportOptions = Partial<ExportTextOptions> & { type?: 'thoughts' | 'plan' };

/** Resolve translations when exporting, so language changes do not require a page reload. */
function getLabels(): ExportLabels {
  return {
    multipleTagsThoughts: i18n.t('export.multipleTagsThoughts', 'Thoughts with Multiple Tags'),
    unassignedThoughts: i18n.t('export.unassignedThoughts', 'Unassigned Thoughts'),
    noEntries: i18n.t('export.noEntries', 'No entries'),
    sermonTitle: i18n.t('export.sermonTitle', 'Sermon: '),
    scriptureText: i18n.t('export.scriptureText', 'Scripture Text: '),
    tagsLabel: i18n.t('export.tagsLabel', 'Tags: '),
    introduction: i18n.t('tags.introduction', 'Introduction'),
    main: i18n.t('tags.mainPart', 'Main Part'),
    conclusion: i18n.t('tags.conclusion', 'Conclusion'),
    ambiguous: i18n.t('export.otherThoughts', 'Other Thoughts'),
  };
}

/** Public API: organize canonical content once, then render the requested document. */
export function getExportContent(sermon: Sermon, focusedSection?: string, options: ExportOptions = {}): Promise<string> {
  const { type = 'thoughts', format = 'plain', includeTags = false, includeMetadata = true } = options;
  const textOptions = { format, includeTags, includeMetadata };
  if (type === 'plan') {
    if (!sermon.plan && !sermon.draft) return Promise.resolve(i18n.t('export.noPlanAvailable', 'No plan available for export'));
    return Promise.resolve(renderPlanExport(sermon, textOptions, getLabels()));
  }
  return Promise.resolve(renderThoughtExport(sermon, buildExportSections(sermon, focusedSection), textOptions, getLabels()));
}
