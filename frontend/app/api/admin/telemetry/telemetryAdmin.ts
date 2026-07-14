import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminEmail } from "@/api/admin/adminAuth";
import {
  captureTelemetryText,
} from "@/api/clients/aiTelemetry";

import type { TelemetryQualityReview } from "@/api/clients/aiTelemetry";

export const TELEMETRY_COLLECTION = process.env.AI_TELEMETRY_COLLECTION || "ai_prompt_telemetry";

export async function checkTelemetryAdminAuth(request: Request) {
  const admin = await requireAdminEmail(request);
  if (!admin.ok) return admin;

  const allowProductionAccess = process.env.ALLOW_ADMIN_TELEMETRY_IN_PRODUCTION === "true";
  if (process.env.NODE_ENV === "production" && !allowProductionAccess) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Not available in production" }, { status: 403 }),
    };
  }

  return admin;
}

export const TelemetryReviewPatchSchema = z.object({
  eventId: z.string().trim().min(1),
  quality: z.enum(["unreviewed", "good", "bad", "needs_review"]),
  reviewedBy: z.string().trim().min(1).max(120).optional().nullable(),
  issueTypes: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  notes: z.string().trim().max(5000).optional().nullable(),
  expectedOutput: z.string().max(20000).optional().nullable(),
  keepAsExample: z.boolean().optional(),
  resolutionStatus: z.enum(["open", "fixed", "wont_fix"]).optional().nullable(),
  fixedInPromptVersion: z.string().trim().min(1).max(40).optional().nullable(),
});

export type TelemetryReviewPatchInput = z.infer<typeof TelemetryReviewPatchSchema>;

export function buildTelemetryQualityReview(input: TelemetryReviewPatchInput): TelemetryQualityReview {
  const reviewedAt = input.quality === "unreviewed" ? null : new Date().toISOString();
  return {
    quality: input.quality,
    reviewedAt,
    reviewedBy: input.quality === "unreviewed" ? null : input.reviewedBy ?? "admin",
    issueTypes: input.quality === "unreviewed" ? [] : input.issueTypes ?? [],
    notes: input.quality === "unreviewed" ? null : input.notes ?? null,
    expectedOutput: input.expectedOutput ? captureTelemetryText(input.expectedOutput) : null,
    keepAsExample: input.keepAsExample ?? (input.quality === "good"),
    resolutionStatus: input.quality === "bad" ? input.resolutionStatus ?? "open" : input.resolutionStatus ?? null,
    fixedInPromptVersion: input.fixedInPromptVersion ?? null,
  };
}
