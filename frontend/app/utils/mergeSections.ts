import type { ThoughtsBySection } from '@/models/models';

const SECTION_KEYS: (keyof ThoughtsBySection)[] = [
  'introduction',
  'main',
  'conclusion',
  'ambiguous',
];

/**
 * Merge the section arrangement, keeping thoughts this screen has never heard of.
 *
 * WHY NO BASE IS NEEDED HERE. The arrangement is an assignment map: every thought id
 * appears in exactly one section. A screen that drags a thought sends the whole map
 * built from the sermon it loaded — so a thought CREATED on another device is simply
 * absent from it, and the whole-map write dropped that thought out of every section
 * (it stopped being shown anywhere until someone re-sorted it).
 *
 * An id the incoming map does not mention AT ALL is therefore not "unassigned here" —
 * this screen has no opinion about it, because it does not know it exists. Moving a
 * thought between sections still mentions it, and deleting a thought goes through the
 * thought writer, not this one. So preserving unmentioned ids in their stored section
 * is safe without asking the caller for anything, and it needs no new plumbing at the
 * five call sites — the kind of change that has repeatedly gone wrong tonight.
 *
 * WHY A BASE HELPS ANYWAY, WHEN THE CALLER HAS ONE. Without it this function cannot
 * tell "I moved this thought" from "I am merely holding where it used to be", so the
 * local placement always won — and a thought moved on the phone in the morning jumped
 * silently back when the laptop saved an unrelated drag at noon. Given the arrangement
 * the screen STARTED from, a move made only on the other device is taken instead. Two
 * different moves of one thought cannot both be true and neither is text: the local one
 * stands, and the freshness pill is what tells the person the arrangement changed.
 *
 * Like the other merges, this NEVER refuses.
 */
export function mergeSections(
  mine: ThoughtsBySection,
  stored: ThoughtsBySection | null | undefined,
  /** The arrangement this screen started from. Absent → behaviour is unchanged. */
  base?: ThoughtsBySection | null
): ThoughtsBySection {
  if (!stored) return mine;

  const sectionOf = (map: ThoughtsBySection | null | undefined, id: string) =>
    SECTION_KEYS.find((key) => (map?.[key] ?? []).includes(id));

  const mentioned = new Set<string>();
  SECTION_KEYS.forEach((key) => (mine[key] ?? []).forEach((id) => mentioned.add(id)));

  /**
   * Ids this screen mentions but did NOT move, while the other device did. Their
   * placement is somebody's work; keeping ours would revert it without a word.
   */
  const movedThereOnly = new Set<string>();
  if (base) {
    mentioned.forEach((id) => {
      const startedIn = sectionOf(base, id);
      if (!startedIn) return; // this screen never saw it in the base — no opinion
      const here = sectionOf(mine, id);
      const there = sectionOf(stored, id);
      if (!there || there === startedIn) return; // they did not move it
      if (here !== startedIn) return; // we moved it too: ours stands
      movedThereOnly.add(id);
    });
  }

  const merged: ThoughtsBySection = {
    introduction: (mine.introduction ?? []).filter((id) => !movedThereOnly.has(id)),
    main: (mine.main ?? []).filter((id) => !movedThereOnly.has(id)),
    conclusion: (mine.conclusion ?? []).filter((id) => !movedThereOnly.has(id)),
  };
  if (mine.ambiguous) merged.ambiguous = mine.ambiguous.filter((id) => !movedThereOnly.has(id));

  SECTION_KEYS.forEach((key) => {
    (stored[key] ?? []).forEach((id) => {
      if (mentioned.has(id) && !movedThereOnly.has(id)) return;
      const target = merged[key] ?? [];
      target.push(id);
      merged[key] = target;
    });
  });

  return merged;
}
