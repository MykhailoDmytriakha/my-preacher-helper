/**
 * THE SECTION IS AN ADDRESS, AND THIS IS THE ONE PLACE THAT SAYS SO.
 *
 * Route, navigation highlight and every incoming link read the same table, so a section
 * cannot be spelled one way in a link and another in the router. The legacy `?section=`
 * names are kept only as a translation on the way in: links written before the split —
 * the plan editor's "manage templates", a bookmark — still land where they meant to.
 */
export const SETTINGS_SECTIONS = ['user', 'limits', 'tags', 'templates'] as const;

export type SettingsSection = typeof SETTINGS_SECTIONS[number];

export const DEFAULT_SETTINGS_SECTION: SettingsSection = 'user';

export const settingsSectionHref = (section: SettingsSection): string => `/settings/${section}`;

export const isSettingsSection = (value: unknown): value is SettingsSection =>
  typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value);

/** Names the in-page switcher used before each section had a route of its own. */
const LEGACY_SECTION_NAMES: Record<string, SettingsSection> = {
  user: 'user',
  aiModels: 'limits',
  tags: 'tags',
  planTemplates: 'templates',
};

export const sectionFromLegacyName = (value: string | null | undefined): SettingsSection | null =>
  (value && LEGACY_SECTION_NAMES[value]) || null;

export const sectionFromPathname = (pathname: string | null | undefined): SettingsSection => {
  const last = (pathname ?? '').split('?')[0].split('/').filter(Boolean).pop();
  return isSettingsSection(last) ? last : DEFAULT_SETTINGS_SECTION;
};
