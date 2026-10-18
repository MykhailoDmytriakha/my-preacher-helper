import { recordDiagnostic } from '@/utils/appDiagnostics';
import { deviceChoice } from '@/utils/deviceChoice';

/*
 * HOW CROSS REFERENCES SHOW ON THIS DEVICE (the owner, 2026-10-15): shown while reading the Bible,
 * as a count beside a verse; in a passage window opened from a sermon, a note or a group only when
 * asked for; the main links or all of them; the rest of a verse's links in its window as verses with
 * their text, or only as references (the owner, 2026-10-16). One record per device, like the Bible chosen
 * (`translation.ts`): the reader and the settings in the "T" menu read and write the same one, and a
 * change shows at once in both. The page holds it in memory and storage is only written through
 * (`utils/deviceChoice.ts`): on the owner's iPad a re-read of storage took "on" back off.
 */
export type CrossReferenceMode = 'main' | 'all';

export type CrossReferencePrefs = {
  /** The count beside a verse while reading the Bible. */
  show: boolean;
  /** The same in a passage window opened from another screen. */
  inWindow: boolean;
  mode: CrossReferenceMode;
  /** The window's "others" as verses with their text, like the main links; off — only their references. */
  othersAsVerses: boolean;
};

export const DEFAULT_CROSS_REFERENCE_PREFS: CrossReferencePrefs = { show: true, inWindow: false, mode: 'main', othersAsVerses: false };

function parse(raw: string | null): CrossReferencePrefs {
  if (!raw) return DEFAULT_CROSS_REFERENCE_PREFS;
  try {
    const value = JSON.parse(raw) as Partial<CrossReferencePrefs>;
    return {
      show: typeof value.show === 'boolean' ? value.show : DEFAULT_CROSS_REFERENCE_PREFS.show,
      inWindow: typeof value.inWindow === 'boolean' ? value.inWindow : DEFAULT_CROSS_REFERENCE_PREFS.inWindow,
      mode: value.mode === 'all' || value.mode === 'main' ? value.mode : DEFAULT_CROSS_REFERENCE_PREFS.mode,
      othersAsVerses: typeof value.othersAsVerses === 'boolean' ? value.othersAsVerses : DEFAULT_CROSS_REFERENCE_PREFS.othersAsVerses,
    };
  } catch {
    return DEFAULT_CROSS_REFERENCE_PREFS;
  }
}

const choice = deviceChoice({
  key: 'bible:cross-references',
  parse,
  fallback: DEFAULT_CROSS_REFERENCE_PREFS,
  onOtherTab: () => recordDiagnostic('setting', { source: 'other-tab', code: 'crossRefs' }),
});

/** The choice on this device; the same object until it changes, so React re-renders only on a change. */
export function readCrossReferencePrefs(): CrossReferencePrefs {
  return choice.read();
}

/** Where a change came from, for the technical details a feedback report sends. */
export type CrossReferencePrefsSource = 'window' | 'menu';

const said = (value: unknown) => (typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value));

export function saveCrossReferencePrefs(change: Partial<CrossReferencePrefs>, from?: CrossReferencePrefsSource): void {
  const saved = choice.save(change);
  // Each change and where it came from: a setting the person saw flip by itself is then told apart from
  // their own taps (the owner's iPad, 2026-10-16: "on" in portrait read "off" after turning the screen),
  // and storage that refused it or read back something else says so.
  Object.entries(change).forEach(([name, value]) => recordDiagnostic('setting', {
    // Letters and hyphens only: the diagnostics keep nothing else (`appDiagnostics` `safeData`).
    source: from ?? 'code', code: `crossRefs-${name}`, result: saved === 'kept' ? said(value) : `${said(value)}-${saved}`,
  }));
}

export function useCrossReferencePrefs(): CrossReferencePrefs {
  return choice.useChoice();
}

/** Forgets the copy kept in memory — for tests. */
export function resetCrossReferencePrefsForTests(): void {
  choice.resetForTests();
}
