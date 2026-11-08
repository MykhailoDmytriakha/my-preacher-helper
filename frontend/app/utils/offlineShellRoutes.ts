import { SETTINGS_SECTIONS, settingsSectionHref, type SettingsSection } from './settingsSections';

/** Addresses the precached private shell can render. Shared with its document deadline rule. */
const ROUTES = {
  dashboard: /^\/(?:dashboard)?$/,
  settings: /^\/settings$/,
  admin: /^\/admin$/,
  sermons: /^\/sermons$/,
  series: /^\/series$/,
  groups: /^\/groups$/,
  prayers: /^\/prayers$/,
  studies: /^\/studies$/,
  studyShares: /^\/studies\/share-links$/,
  bible: /^\/bible$/,
  calendar: /^\/calendar$/,
  care: /^\/care$/,
  councils: /^\/care\/council$/,
  orders: /^\/care\/orders$/,
  council: /^\/care\/council\/[^\/]+$/,
  councilConduct: /^\/care\/council\/[^\/]+\/conduct$/,
  order: /^\/care\/orders\/[^\/]+$/,
  groupConduct: /^\/groups\/[^\/]+\/conduct$/,
  prayer: /^\/prayers\/[^\/]+$/,
  sermon: /^\/sermons\/[^\/]+$/,
  seriesDetail: /^\/series\/[^\/]+$/,
  study: /^\/studies\/[^\/]+$/,
  group: /^\/groups\/[^\/]+$/,
  sermonPlan: /^\/sermons\/[^\/]+\/plan$/,
  sermonManualPlan: /^\/sermons\/[^\/]+\/plan\/manual$/,
  sermonStructure: /^\/sermons\/[^\/]+\/structure$/,
} as const;

export type OfflineShellRoute = keyof typeof ROUTES | `settings:${SettingsSection}`;

export function resolveOfflineShellRoute(pathname: string): OfflineShellRoute | null {
  const section = SETTINGS_SECTIONS.find(section => pathname === settingsSectionHref(section));
  if (section) return `settings:${section}`;
  for (const key of Object.keys(ROUTES) as (keyof typeof ROUTES)[]) {
    if (ROUTES[key].test(pathname)) return key;
  }
  return null;
}
