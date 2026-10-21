import { recordDiagnostic } from '@/utils/appDiagnostics';
import { deviceChoice } from '@/utils/deviceChoice';

/*
 * WHETHER THE PERSON'S OWN MATERIAL SHOWS ON THE TEXT (the owner, 2026-10-21, case 2026-10-12-block-diagram,
 * 2.2): a badge after a verse a note, sermon, group or service order of theirs points at, one after a
 * chapter's heading for what points at the whole chapter, and dots by a chapter's number on the minimap.
 * One record per device, like the cross references (`crossReferencePrefs.ts`): it is a choice of what
 * shows while reading, so it lives in Settings → Bible, not in the reader's "T", which is about the text
 * (the owner, 2026-10-20). The page holds it in memory (`utils/deviceChoice.ts`).
 */
export type MinePrefs = {
  /** The badges on the text and the dots on the minimap. */
  show: boolean;
};

export const DEFAULT_MINE_PREFS: MinePrefs = { show: true };

function parse(raw: string | null): MinePrefs {
  if (!raw) return DEFAULT_MINE_PREFS;
  try {
    const value = JSON.parse(raw) as Partial<MinePrefs>;
    return { show: typeof value.show === 'boolean' ? value.show : DEFAULT_MINE_PREFS.show };
  } catch {
    return DEFAULT_MINE_PREFS;
  }
}

const choice = deviceChoice({
  key: 'bible:mine',
  parse,
  fallback: DEFAULT_MINE_PREFS,
  onOtherTab: () => recordDiagnostic('setting', { source: 'other-tab', code: 'mine' }),
});

export function saveMinePrefs(change: Partial<MinePrefs>): void {
  const saved = choice.save(change);
  // Letters and hyphens only: the diagnostics keep nothing else (`appDiagnostics` `safeData`).
  Object.entries(change).forEach(([name, value]) => recordDiagnostic('setting', {
    source: 'settings', code: `mine-${name}`, result: saved === 'kept' ? (value ? 'on' : 'off') : `${value ? 'on' : 'off'}-${saved}`,
  }));
}

export function useMinePrefs(): MinePrefs {
  return choice.useChoice();
}

/** Forgets the copy kept in memory — for tests. */
export function resetMinePrefsForTests(): void {
  choice.resetForTests();
}
