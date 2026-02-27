import type { Plan } from "@/models/models";
import type { TimerPhase } from "@/types/TimerState";

export type PlanViewMode = "overlay" | "immersive" | "preaching";

export type SermonSectionKey = "introduction" | "main" | "conclusion";

export type CopyStatus = "idle" | "copying" | "success" | "error";

export interface PlanPhaseProgressByPhase {
  introduction: number;
  main: number;
  conclusion: number;
}

export interface PlanTimerState {
  currentPhase: TimerPhase;
  phaseProgress: number;
  totalProgress: number;
  phaseProgressByPhase: PlanPhaseProgressByPhase;
  timeRemaining: number;
  isFinished: boolean;
}

type SermonSectionColorMap = typeof import("@/utils/themeColors").SERMON_SECTION_COLORS;
export type SectionColors = SermonSectionColorMap[keyof SermonSectionColorMap];

export type PlanSectionContent = Plan["introduction"];

export interface CombinedPlan {
  introduction: string;
  main: string;
  conclusion: string;
}
