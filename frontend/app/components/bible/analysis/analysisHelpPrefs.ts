import { recordDiagnostic } from '@/utils/appDiagnostics';
import { deviceChoice } from '@/utils/deviceChoice';

/*
 * HOW MUCH OF THE ANALYSIS'S HELP THE SIDE PANEL SHOWS (the owner, 2026-10-31: «поначалу она нужна, а потом ты уже
 * выучиваешь, и она тебе не нужна»): every explanation in full, as at first, or each tool one line — its sign and a
 * short name — once the person has folded it. One record per device, held in memory (`utils/deviceChoice.ts`).
 */
export type AnalysisHelpPrefs = { short: boolean };

const DEFAULT_HELP: AnalysisHelpPrefs = { short: false };

function parse(raw: string | null): AnalysisHelpPrefs {
  if (!raw) return DEFAULT_HELP;
  try {
    const value = JSON.parse(raw) as Partial<AnalysisHelpPrefs>;
    return { short: typeof value.short === 'boolean' ? value.short : DEFAULT_HELP.short };
  } catch {
    return DEFAULT_HELP;
  }
}

const choice = deviceChoice({
  key: 'analysis:help',
  parse,
  fallback: DEFAULT_HELP,
  onOtherTab: () => recordDiagnostic('setting', { source: 'other-tab', code: 'analysis-help' }),
});

export function saveAnalysisHelpPrefs(change: Partial<AnalysisHelpPrefs>): void {
  const saved = choice.save(change);
  const word = change.short ? 'short' : 'full';
  // Letters and hyphens only: the diagnostics keep nothing else (`appDiagnostics` `safeData`).
  recordDiagnostic('setting', { source: 'analysis', code: 'analysis-help', result: saved === 'kept' ? word : `${word}-${saved}` });
}

export function useAnalysisHelpPrefs(): AnalysisHelpPrefs {
  return choice.useChoice();
}

/** Forgets the copy kept in memory — for tests. */
export function resetAnalysisHelpPrefsForTests(): void {
  choice.resetForTests();
}
