import { normalizeStructureTag } from "@/utils/tagUtils";

import type { Sermon, Thought, ThoughtsBySection } from "@/models/models";

export type SectionKey = "introduction" | "main" | "conclusion" | "ambiguous";

export const SECTION_ORDER: SectionKey[] = [
  "introduction",
  "main",
  "conclusion",
  "ambiguous",
];

const CANONICAL_TO_SECTION: Record<string, SectionKey> = {
  intro: "introduction",
  main: "main",
  conclusion: "conclusion",
};

const ensureArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(Boolean) : [];

const dedupe = (ids: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  ids.forEach((id) => {
    if (seen.has(id)) return;
    seen.add(id);
    result.push(id);
  });
  return result;
};

export function normalizeStructure(
  structure?: ThoughtsBySection | string | null
): ThoughtsBySection {
  const parsed =
    typeof structure === "string" ? (JSON.parse(structure) as ThoughtsBySection) : structure;

  return {
    introduction: dedupe(ensureArray(parsed?.introduction)),
    main: dedupe(ensureArray(parsed?.main)),
    conclusion: dedupe(ensureArray(parsed?.conclusion)),
    ambiguous: dedupe(ensureArray(parsed?.ambiguous)),
  };
}

export function resolveSectionFromOutline(
  sermon: Pick<Sermon, "outline"> | null | undefined,
  outlinePointId?: string | null
): SectionKey | null {
  if (!outlinePointId || !sermon?.outline) return null;

  if (sermon.outline.introduction?.some((p) => p.id === outlinePointId)) {
    return "introduction";
  }
  if (sermon.outline.main?.some((p) => p.id === outlinePointId)) {
    return "main";
  }
  if (sermon.outline.conclusion?.some((p) => p.id === outlinePointId)) {
    return "conclusion";
  }

  return null;
}

export function resolveSectionFromTags(tags: string[] | undefined): SectionKey | null {
  if (!tags || tags.length === 0) return null;
  const canonicalTags = tags
    .map(normalizeStructureTag)
    .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
  const unique = Array.from(new Set(canonicalTags));
  if (unique.length !== 1) return null;
  return CANONICAL_TO_SECTION[unique[0]] ?? null;
}

export function resolveSectionForNewThought(params: {
  sermon: Pick<Sermon, "outline"> | null | undefined;
  outlinePointId?: string | null;
  tags?: string[];
}): SectionKey {
  const { sermon, outlinePointId, tags } = params;
  const outlineSection = resolveSectionFromOutline(sermon, outlinePointId);
  if (outlineSection) return outlineSection;
  const tagSection = resolveSectionFromTags(tags);
  return tagSection ?? "ambiguous";
}

export function findThoughtSectionInStructure(
  structure: ThoughtsBySection | string | null | undefined,
  thoughtId: string
): SectionKey | null {
  const normalized = normalizeStructure(structure);
  for (const section of SECTION_ORDER) {
    if ((normalized[section] ?? []).includes(thoughtId)) {
      return section;
    }
  }
  return null;
}

function belongsToSection(
  thought: Thought,
  section: SectionKey,
  sermon: Pick<Sermon, "outline">
): boolean {
  const outlineSection = resolveSectionFromOutline(sermon, thought.outlinePointId ?? null);
  if (outlineSection) return outlineSection === section;

  const tagSection = resolveSectionFromTags(thought.tags);
  if (tagSection) return tagSection === section;

  return section === "ambiguous";
}

type SermonOrderingInput = Pick<
  Sermon,
  "thoughts" | "structure" | "thoughtsBySection" | "outline"
>;

type ThoughtResolution = {
  section: SectionKey;
  outlinePointId: string | null;
  date: number;
};

const getDateValue = (value?: string): number => {
  const time = new Date(value ?? 0).getTime();
  return Number.isNaN(time) ? 0 : time;
};

const resolveThought = (
  thought: Thought,
  sermon: Pick<Sermon, "outline" | "structure" | "thoughtsBySection">
): ThoughtResolution => {
  const outlineSection = resolveSectionFromOutline(sermon, thought.outlinePointId ?? null);
  const structureSection =
    outlineSection
      ? null
      : findThoughtSectionInStructure(sermon.structure ?? sermon.thoughtsBySection, thought.id);
  const tagSection = resolveSectionFromTags(thought.tags);
  const section = outlineSection ?? structureSection ?? tagSection ?? "ambiguous";
  return {
    section,
    outlinePointId: outlineSection ? thought.outlinePointId ?? null : null,
    date: getDateValue(thought.date),
  };
};

export function canonicalizeStructure(sermon: SermonOrderingInput): ThoughtsBySection {
  const thoughts = sermon.thoughts ?? [];
  const normalized = normalizeStructure(sermon.structure ?? sermon.thoughtsBySection);
  const resolutionById = new Map<string, ThoughtResolution>();

  thoughts.forEach((thought) => {
    resolutionById.set(
      thought.id,
      resolveThought(thought, {
        outline: sermon.outline,
        structure: sermon.structure,
        thoughtsBySection: sermon.thoughtsBySection,
      })
    );
  });

  const pushUnique = (result: string[], used: Set<string>, id: string) => {
    if (used.has(id)) return;
    used.add(id);
    result.push(id);
  };

  const buildSectionOrder = (section: SectionKey): string[] => {
    const originalIds = normalized[section] ?? [];
    const result: string[] = [];
    const used = new Set<string>();

    if (section !== "ambiguous") {
      const outlinePoints = sermon.outline?.[section] ?? [];
      outlinePoints.forEach((point) => {
        originalIds.forEach((id) => {
          const meta = resolutionById.get(id);
          if (meta && meta.section === section && meta.outlinePointId === point.id) {
            pushUnique(result, used, id);
          }
        });

        const remaining = thoughts
          .filter((thought) => {
            const meta = resolutionById.get(thought.id);
            return (
              meta?.section === section &&
              meta.outlinePointId === point.id &&
              !used.has(thought.id)
            );
          })
          .sort((a, b) => {
            const metaA = resolutionById.get(a.id);
            const metaB = resolutionById.get(b.id);
            return (metaA?.date ?? 0) - (metaB?.date ?? 0);
          });

        remaining.forEach((thought) => pushUnique(result, used, thought.id));
      });
    }

    originalIds.forEach((id) => {
      if (used.has(id)) return;
      const meta = resolutionById.get(id);
      if (!meta) {
        pushUnique(result, used, id);
        return;
      }
      if (meta.section === section && !meta.outlinePointId) {
        pushUnique(result, used, id);
      }
    });

    const unassignedRemainder = thoughts
      .filter((thought) => {
        const meta = resolutionById.get(thought.id);
        return meta?.section === section && !meta.outlinePointId && !used.has(thought.id);
      })
      .sort((a, b) => {
        const metaA = resolutionById.get(a.id);
        const metaB = resolutionById.get(b.id);
        return (metaA?.date ?? 0) - (metaB?.date ?? 0);
      });

    unassignedRemainder.forEach((thought) => pushUnique(result, used, thought.id));

    return result;
  };

  return {
    introduction: buildSectionOrder("introduction"),
    main: buildSectionOrder("main"),
    conclusion: buildSectionOrder("conclusion"),
    ambiguous: buildSectionOrder("ambiguous"),
  };
}

export function getPreachOrderedThoughtsBySection(
  sermon: Pick<Sermon, "thoughts" | "structure" | "thoughtsBySection" | "outline">,
  section: SectionKey,
  options: { includeOrphans?: boolean } = {}
): Thought[] {
  const includeOrphans = options.includeOrphans ?? true;
  const structure = canonicalizeStructure(sermon);
  const thoughtMap = new Map((sermon.thoughts ?? []).map((t) => [t.id, t]));

  const ordered: Thought[] = [];
  const usedIds = new Set<string>();

  const sectionIds = structure[section] ?? [];
  sectionIds.forEach((id) => {
    const thought = thoughtMap.get(id);
    if (!thought) return;
    ordered.push(thought);
    usedIds.add(id);
  });

  if (!includeOrphans) return ordered;

  const outlinePoints =
    section !== "ambiguous" ? sermon.outline?.[section] ?? [] : [];
  if (outlinePoints.length > 0) {
    outlinePoints.forEach((point) => {
      const pointThoughts = (sermon.thoughts ?? [])
        .filter((thought) => thought.outlinePointId === point.id && !usedIds.has(thought.id))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      pointThoughts.forEach((thought) => {
        ordered.push(thought);
        usedIds.add(thought.id);
      });
    });
  }

  const orphans = (sermon.thoughts ?? []).filter((thought) => {
    if (usedIds.has(thought.id)) return false;
    return belongsToSection(thought, section, { outline: sermon.outline });
  });

  orphans.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return [...ordered, ...orphans];
}

export function getPreachOrderedThoughts(
  sermon: Pick<Sermon, "thoughts" | "structure" | "thoughtsBySection" | "outline">,
  options: { includeOrphans?: boolean } = {}
): Thought[] {
  const used = new Set<string>();
  const result: Thought[] = [];

  SECTION_ORDER.forEach((section) => {
    const sectionThoughts = getPreachOrderedThoughtsBySection(sermon, section, options);
    sectionThoughts.forEach((thought) => {
      if (used.has(thought.id)) return;
      used.add(thought.id);
      result.push(thought);
    });
  });

  return result;
}

export function getThoughtsForOutlinePoint(
  sermon: Pick<Sermon, "thoughts" | "structure" | "thoughtsBySection" | "outline">,
  outlinePointId: string
): Thought[] {
  const outlineSection = resolveSectionFromOutline(sermon, outlinePointId);
  const ordered = outlineSection
    ? getPreachOrderedThoughtsBySection(sermon, outlineSection, { includeOrphans: true })
    : getPreachOrderedThoughts(sermon, { includeOrphans: true });

  return ordered.filter((thought) => thought.outlinePointId === outlinePointId);
}

export function insertThoughtIdInStructure(params: {
  structure: ThoughtsBySection | string | null | undefined;
  section: SectionKey;
  thoughtId: string;
  outlinePointId?: string | null;
  thoughtsById?: Map<string, Thought>;
  thoughts?: Thought[];
  outline?: Sermon["outline"];
}): ThoughtsBySection {
  const { structure, section, thoughtId, outlinePointId, thoughtsById, thoughts, outline } = params;
  const normalized = normalizeStructure(structure);

  SECTION_ORDER.forEach((sec) => {
    normalized[sec] = (normalized[sec] ?? []).filter((id) => id !== thoughtId);
  });

  const target = [...(normalized[section] ?? [])];
  let insertIndex = target.length;

  if (outlinePointId && thoughtsById) {
    let lastMatchIndex = -1;
    target.forEach((id, index) => {
      const thought = thoughtsById.get(id);
      if (thought?.outlinePointId === outlinePointId) {
        lastMatchIndex = index;
      }
    });
    if (lastMatchIndex >= 0) {
      insertIndex = lastMatchIndex + 1;
    }
  }

  target.splice(insertIndex, 0, thoughtId);
  normalized[section] = target;

  if (thoughts) {
    return canonicalizeStructure({
      thoughts,
      structure: normalized,
      outline,
    });
  }

  return normalized;
}
