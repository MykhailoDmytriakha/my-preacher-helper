import { useRouter, usePathname } from "next/navigation";
import { useState, useEffect, useCallback } from "react";

// Section visibility model. The three structure sections can each be shown or
// hidden, and that single axis subsumes the old "focus mode":
//   1 visible  -> focus mode (rich single-section layout, with the side panel)
//   2 visible  -> a pair side by side
//   3 visible  -> the whole plan
// "Focus mode" is no longer a separate concept — it's just "one section left".
const CANON = ['introduction', 'main', 'conclusion'] as const;
export type SectionId = typeof CANON[number];

const isSectionId = (v: string): v is SectionId => (CANON as readonly string[]).includes(v);

// Visible set from URL. New scheme: ?sections=a,b. Legacy (still honoured so old
// deep-links / bookmarks from SermonOutline & StructureStats keep working):
// ?mode=focus&section=X -> [X].
const parseVisible = (
  sections: string | null,
  mode: string | null,
  section: string | null
): SectionId[] => {
  if (sections) {
    const set = sections.split(',').map((s) => s.trim()).filter(isSectionId);
    const ordered = CANON.filter((c) => set.includes(c));
    if (ordered.length > 0) return ordered;
  }
  if (mode === 'focus' && section && isSectionId(section)) return [section];
  return [...CANON];
};

interface UseFocusModeProps {
  searchParams: URLSearchParams | null;
  sermonId: string | null;
}

export const useFocusMode = ({ searchParams }: UseFocusModeProps) => {
  const router = useRouter();
  const pathname = usePathname();

  const sectionsParam = searchParams?.get('sections') ?? null;
  const modeParam = searchParams?.get('mode') ?? null;
  const sectionParam = searchParams?.get('section') ?? null;

  const [visibleSections, setVisibleSections] = useState<SectionId[]>(() =>
    parseVisible(sectionsParam, modeParam, sectionParam)
  );

  // Re-sync when the URL changes (browser back/forward, external deep-link).
  useEffect(() => {
    setVisibleSections(parseVisible(sectionsParam, modeParam, sectionParam));
  }, [sectionsParam, modeParam, sectionParam]);

  const buildUrl = useCallback((next: SectionId[]) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.delete('mode');
    params.delete('section');
    params.delete('sermonId');
    if (next.length === CANON.length) {
      params.delete('sections'); // all visible == default == clean URL
    } else {
      params.set('sections', next.join(','));
    }
    const q = params.toString();
    return q ? `${pathname}?${q}` : pathname;
  }, [searchParams, pathname]);

  // Closure-based (not a functional updater) so router.push never runs inside a
  // setState updater — safe under StrictMode's double-invoke.
  const apply = useCallback((next: SectionId[]) => {
    const ordered = CANON.filter((c) => next.includes(c));
    const safe = ordered.length > 0 ? ordered : [...CANON];
    setVisibleSections(safe);
    router.push(buildUrl(safe));
  }, [buildUrl, router]);

  const toggleSection = useCallback((id: string) => {
    if (!isSectionId(id)) return;
    const has = visibleSections.includes(id);
    if (has && visibleSections.length === 1) return; // keep at least one visible
    const next = has
      ? visibleSections.filter((c) => c !== id)
      : CANON.filter((c) => visibleSections.includes(c) || c === id);
    apply(next);
  }, [visibleSections, apply]);

  // Show only this section (= enter focus on it). Used by the per-column ⛶ button.
  const soloSection = useCallback((id: string) => {
    if (isSectionId(id)) apply([id]);
  }, [apply]);

  const showAll = useCallback(() => apply([...CANON]), [apply]);

  // ⛶ toggle: if already focused on this one, exit to the whole plan; else solo it.
  const handleToggleFocusMode = useCallback((id: string) => {
    if (!isSectionId(id)) return;
    if (visibleSections.length === 1 && visibleSections[0] === id) showAll();
    else soloSection(id);
  }, [visibleSections, showAll, soloSection]);

  // FocusNav-style "go to this section" — solos it.
  const navigateToSection = useCallback((id: string) => soloSection(id), [soloSection]);

  const isSectionVisible = useCallback((id: string) => visibleSections.includes(id as SectionId), [visibleSections]);

  const isFocusMode = visibleSections.length === 1;
  const focusedColumn = isFocusMode ? visibleSections[0] : null;

  return {
    visibleSections,
    isFocusMode,
    focusedColumn,
    isSectionVisible,
    toggleSection,
    soloSection,
    showAll,
    handleToggleFocusMode,
    navigateToSection,
  };
};
