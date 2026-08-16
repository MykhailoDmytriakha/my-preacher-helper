import type { Sermon, SermonPoint } from "@/models/models";

export type PlanSectionName = "introduction" | "main" | "conclusion";

/** A point the person has to go and find: which section, which position, what it is called. */
export interface PlanPointLocation {
  id: string;
  section: PlanSectionName;
  /** 1-based position within its section — the same number the plan screen prints. */
  position: number;
  title: string;
}

/**
 * IS THIS SERMON WHOLE ENOUGH TO GENERATE A CONSPECTUS FROM?
 *
 * Generation reads the thoughts sitting under one outline point and writes that point's
 * text (`api/sermons/[id]/plan/route.ts` — a point with no thoughts is answered 400). So
 * "ready" is not one condition but four, and any of them failing means the paired screen
 * would be built out of nothing:
 *
 *   - thoughts exist at all;
 *   - outline points exist to put them on;
 *   - every thought sits on a point that still exists;
 *   - every point holds at least one thought.
 *
 * Anything short of that is not a refusal — it is the door into writing by hand, and the
 * person walks through it knowing exactly what is missing. Which is why this returns the
 * REASONS, not a boolean: "not ready" without "here is what is absent" leaves someone
 * staring at a wall with no idea which way to go.
 */
export type PlanReadinessIssueKind =
  | "noThoughts"
  | "noPoints"
  | "unassignedThoughts"
  | "orphanThoughts"
  | "emptyPoints";

export interface PlanReadinessIssue {
  kind: PlanReadinessIssueKind;
  /** How many thoughts or points this issue covers. Absent for the two "nothing at all" kinds. */
  count?: number;
  /**
   * Where the affected points are, for issues a person has to go and find.
   *
   * Titles alone were not enough: a sermon can hold several points called the same thing,
   * and "Points with no thoughts: Intro Point, Intro Point" tells nobody which two. The
   * section and the position are what actually locate them on screen.
   */
  points?: PlanPointLocation[];
}

export interface PlanReadiness {
  ready: boolean;
  issues: PlanReadinessIssue[];
}

/** How many point titles to name before switching to "and N more". */
export const NAMED_POINTS_LIMIT = 3;

interface LocatedPoint {
  point: SermonPoint;
  location: PlanPointLocation;
}

function locatedPoints(sermon: Sermon | null | undefined): LocatedPoint[] {
  const outline = sermon?.outline;
  if (!outline) return [];

  const sections: PlanSectionName[] = ["introduction", "main", "conclusion"];
  return sections.flatMap((section) =>
    (outline[section] ?? []).map((point, index) => ({
      point,
      location: {
        id: point.id,
        section,
        position: index + 1,
        title: point.text?.trim() ?? "",
      },
    }))
  );
}

export function assessPlanReadiness(sermon: Sermon | null | undefined): PlanReadiness {
  /**
   * Whitespace is not material. A thought holding "   " passes every count-based check
   * and then reaches the model as nothing at all — the generation succeeds and returns
   * something invented. Counting only thoughts with actual text keeps the promise that
   * "ready" means there is something to generate FROM.
   */
  const thoughts = (sermon?.thoughts ?? []).filter((thought) => (thought.text ?? "").trim() !== "");
  const points = locatedPoints(sermon);
  const pointIds = new Set(points.map((entry) => entry.point.id));

  const issues: PlanReadinessIssue[] = [];

  if (thoughts.length === 0) {
    issues.push({ kind: "noThoughts" });
  }

  if (points.length === 0) {
    issues.push({ kind: "noPoints" });
  }

  const unassigned = thoughts.filter((thought) => !thought.outlinePointId);
  if (unassigned.length > 0) {
    issues.push({ kind: "unassignedThoughts", count: unassigned.length });
  }

  /**
   * A thought pointing at a point that no longer exists is the cruel case: it looks
   * sorted everywhere, so nobody goes looking for it, and it silently never reaches the
   * conspectus. Named apart from plain unsorted thoughts for that reason — the person
   * needs to know they are hunting for something invisible, not just unfinished.
   */
  const orphans = thoughts.filter(
    (thought) => thought.outlinePointId && !pointIds.has(thought.outlinePointId)
  );
  if (orphans.length > 0) {
    issues.push({ kind: "orphanThoughts", count: orphans.length });
  }

  // Only meaningful once points exist — with none, "every point is empty" is noise on
  // top of "there are no points".
  if (points.length > 0) {
    const filledPointIds = new Set(
      thoughts
        .map((thought) => thought.outlinePointId)
        .filter((id): id is string => Boolean(id) && pointIds.has(id as string))
    );
    const emptyPoints = points.filter((entry) => !filledPointIds.has(entry.point.id));
    if (emptyPoints.length > 0) {
      issues.push({
        kind: "emptyPoints",
        count: emptyPoints.length,
        points: emptyPoints.slice(0, NAMED_POINTS_LIMIT).map((entry) => entry.location),
      });
    }
  }

  return { ready: issues.length === 0, issues };
}
