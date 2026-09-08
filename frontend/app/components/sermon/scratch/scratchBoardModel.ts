import { newClientId } from '@/utils/clientId';
import { SECTION_KEYS } from '@/utils/outlineDnd';

import type { ComposedPlanOutline, ComposedPlanPoint } from '@/config/schemas/zod';
import type { OutlinePoint, ScratchNote, SermonOutline, SubPoint } from '@/models/models';
import type { ScratchPlacement } from '@/utils/scratchPlacementRemap';

const EMPTY_OUTLINE: SermonOutline = { introduction: [], main: [], conclusion: [] };
export const placementKey = (placement: ScratchPlacement | null | undefined): string =>
  !placement ? 'pool' : placement.subPointId ? `sub:${placement.subPointId}` : `point:${placement.pointId}`;

type StripScratchMetadataResult = {
  outline: SermonOutline;
  idMap: Map<string, string>;
};

function allComposedPoints(outline: ComposedPlanOutline): ComposedPlanPoint[] {
  return [...outline.introduction, ...outline.main, ...outline.conclusion];
}

export function getScratchSignature(notes: ScratchNote[]) {
  return notes.map((note) => [note.id, note.text, note.section ?? ""].join("\u0000")).join("\u0001");
}

export function getOutlineSignature(outline?: SermonOutline | null) {
  return JSON.stringify(outline ?? EMPTY_OUTLINE);
}

export function stripScratchMetadataWithIdMap(outline: ComposedPlanOutline): StripScratchMetadataResult {
  const idMap = new Map<string, string>();
  const cleanOutline = SECTION_KEYS.reduce<SermonOutline>((next, key) => {
    next[key] = outline[key].map(({ id, text, note, isReviewed, subPoints, scratchNoteId }) => {
      const pointId = scratchNoteId ? newClientId() : id;
      idMap.set(id, pointId);
      const cleanSubPoints = (subPoints ?? []).map((subPoint): SubPoint => {
        const subPointId = subPoint.scratchNoteId ? newClientId() : subPoint.id;
        idMap.set(subPoint.id, subPointId);
        const cleanSubPoint: SubPoint = {
          id: subPointId,
          text: subPoint.text,
          position: subPoint.position,
        };
        const cleanSubPointNote = subPoint.note?.trim();
        if (cleanSubPointNote) cleanSubPoint.note = cleanSubPointNote;
        return cleanSubPoint;
      });

      const point: OutlinePoint = {
        id: pointId,
        text,
      };
      const cleanNote = note?.trim();
      if (cleanNote) point.note = cleanNote;
      if (typeof isReviewed === "boolean") point.isReviewed = isReviewed;
      if (cleanSubPoints.length > 0) point.subPoints = cleanSubPoints;
      return point;
    });
    return next;
  }, { introduction: [], main: [], conclusion: [] });

  return { outline: cleanOutline, idMap };
}

export function stripScratchMetadata(outline: ComposedPlanOutline): SermonOutline {
  return stripScratchMetadataWithIdMap(outline).outline;
}

export function collectComposedScratchNoteIds(outline: ComposedPlanOutline | null): Set<string> {
  const noteIds = new Set<string>();
  if (!outline) return noteIds;

  allComposedPoints(outline).forEach((point) => {
    if (point.scratchNoteId) noteIds.add(point.scratchNoteId);
    (point.subPoints ?? []).forEach((subPoint) => {
      if (subPoint.scratchNoteId) noteIds.add(subPoint.scratchNoteId);
    });
  });

  return noteIds;
}

export function remapPlacement(
  placement: ScratchPlacement,
  idMap?: Map<string, string> | null
): ScratchPlacement {
  const pointId = idMap?.get(placement.pointId) ?? placement.pointId;
  const subPointId = placement.subPointId
    ? idMap?.get(placement.subPointId) ?? placement.subPointId
    : undefined;

  return subPointId ? { pointId, subPointId } : { pointId };
}

export function cloneSermonOutline(outline?: SermonOutline): SermonOutline {
  const current = outline ?? EMPTY_OUTLINE;
  return SECTION_KEYS.reduce<SermonOutline>((next, key) => {
    next[key] = (current[key] ?? []).map((point) => ({
      ...point,
      subPoints: point.subPoints?.map((subPoint) => ({ ...subPoint })),
    }));
    return next;
  }, { introduction: [], main: [], conclusion: [] });
}

function appendNoteText(existingNote: string | undefined, scratchText: string) {
  return [existingNote, scratchText]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

export function appendScratchPlacementToOutline(
  outline: SermonOutline,
  placement: ScratchPlacement,
  scratchText: string
) {
  const cleanText = scratchText.trim();
  if (!cleanText) return false;

  for (const key of SECTION_KEYS) {
    const point = (outline[key] ?? []).find((item) => item.id === placement.pointId);
    if (!point) continue;

    if (placement.subPointId) {
      const subPoint = (point.subPoints ?? []).find((item) => item.id === placement.subPointId);
      if (!subPoint) return false;
      subPoint.note = appendNoteText(subPoint.note, cleanText);
      return true;
    }

    point.note = appendNoteText(point.note, cleanText);
    return true;
  }

  return false;
}

export function getComposeNoticeKey(outline: ComposedPlanOutline) {
  const points = allComposedPoints(outline);
  const subPoints = points.flatMap((point) => point.subPoints ?? []);
  const composeItems = [...points, ...subPoints].filter((item) => item.source === "ai" || item.source === "manual");
  const aiCount = composeItems.filter((item) => item.source === "ai").length;
  const manualCount = composeItems.filter((item) => item.source === "manual").length;

  if (composeItems.length > 0 && aiCount === 0) return "scratch.board.composeSuccessAllManual";
  if (composeItems.length > 0 && manualCount === 0) return "scratch.board.composeSuccessAllAi";
  return "scratch.board.composeSuccessHybrid";
}

