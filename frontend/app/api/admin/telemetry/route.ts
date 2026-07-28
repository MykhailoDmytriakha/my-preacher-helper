import { NextResponse } from "next/server";

import { describePrompt, resolvePromptKey } from "@/api/clients/ai/promptRegistry";

import { checkTelemetryAdminAuth, TELEMETRY_COLLECTION } from "./telemetryAdmin";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type VersionAccumulator = {
  count: number;
  /**
   * Турникет: запись отмечена на входе, но не на выходе. Это вызов, который НЕ
   * вернулся — убит потолком maxDuration, упал процесс, оборвалась связь. Считается
   * отдельно и НЕ участвует в знаменателе долей: иначе успех «размывался» бы теми,
   * кто вообще не доехал, и обе цифры врали бы разом.
   */
  started: number;
  success: number;
  refusal: number;
  error: number;
  invalid_response: number;
  totalTokens: number;
  tokenSamples: number;
  totalLatencyMs: number;
  langMismatch: number;
  reviewed: number;
  unreviewed: number;
  good: number;
  bad: number;
  needs_review: number;
  examples: number;
  lastSeen: string;
};

// GET /api/admin/telemetry
// Returns summary grouped by promptName → promptVersion with computed metrics.
export async function GET(request: Request) {
  const admin = await checkTelemetryAdminAuth(request);
  if (!admin.ok) return admin.response;

  try {
    const { adminDb } = await import("@/config/firebaseAdminConfig");
    const snapshot = await adminDb.collection(TELEMETRY_COLLECTION).get();

    const summary: Record<string, { total: number; versions: Record<string, VersionAccumulator> }> = {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function processRecord(d: any) {
      // События, записанные до переименования, сводятся к текущему ключу — иначе
      // один и тот же промпт разъехался бы на две строки.
      const promptName = resolvePromptKey((d.promptName as string) ?? "unknown");
      const version = (d.promptVersion as string) ?? "unknown";

      if (!summary[promptName]) summary[promptName] = { total: 0, versions: {} };
      if (!summary[promptName].versions[version]) {
        summary[promptName].versions[version] = {
          count: 0, started: 0, success: 0, refusal: 0, error: 0, invalid_response: 0,
          totalTokens: 0, tokenSamples: 0, totalLatencyMs: 0, langMismatch: 0,
          reviewed: 0, unreviewed: 0, good: 0, bad: 0, needs_review: 0, examples: 0,
          lastSeen: "",
        };
      }

      const entry = summary[promptName].versions[version];
      summary[promptName].total++;
      entry.count++;

      if (d.phase === "started") entry.started++;

      const status = (d.jsonStructureStatus ?? d.status) as string;
      if (status === "success") entry.success++;
      else if (status === "refusal") entry.refusal++;
      else if (status === "error") entry.error++;
      else if (status === "invalid_response") entry.invalid_response++;

      const quality = d.qualityReview?.quality as string | undefined;
      if (quality === "good") {
        entry.reviewed++;
        entry.good++;
      } else if (quality === "bad") {
        entry.reviewed++;
        entry.bad++;
      } else if (quality === "needs_review") {
        entry.reviewed++;
        entry.needs_review++;
      } else {
        entry.unreviewed++;
      }

      if (d.qualityReview?.keepAsExample === true) {
        entry.examples++;
      }

      const tokens = d.usage?.totalTokens as number | undefined;
      if (typeof tokens === "number") {
        entry.totalTokens += tokens;
        entry.tokenSamples++;
      }

      if (typeof d.latencyMs === "number") {
        entry.totalLatencyMs += d.latencyMs;
      }

      const lang = d.language as { expected?: string | null; detectedOutput?: string | null } | undefined;
      if (lang?.expected && lang?.detectedOutput && lang.expected !== lang.detectedOutput) {
        entry.langMismatch++;
      }

      const ts = d.timestamp as string | undefined;
      if (ts && (!entry.lastSeen || ts > entry.lastSeen)) entry.lastSeen = ts;
    }

    snapshot.docs.forEach((doc) => processRecord(doc.data()));

    const result: Record<string, unknown> = {};
    for (const [promptName, data] of Object.entries(summary)) {
      const descriptor = describePrompt(promptName);
      result[promptName] = {
        // Человеческое имя рядом с ключом: по ключу видно «где», по имени — «что».
        display: descriptor?.display ?? promptName,
        area: descriptor?.areaLabel ?? null,
        stage: descriptor?.stageLabel ?? null,
        step: descriptor?.step ?? null,
        total: data.total,
        versions: Object.fromEntries(
          Object.entries(data.versions)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([version, s]) => {
              // Доли считаются от ВЕРНУВШИХСЯ, а не от начатых.
              const finished = Math.max(1, s.count - s.started);
              return [
              version,
              {
                count: s.count,
                unfinishedCount: s.started,
                unfinishedRate: round2(s.started / s.count),
                jsonStructureSuccessRate: round2(s.success / finished),
                successRate: round2(s.success / finished),
                refusalRate: round2(s.refusal / finished),
                errorRate: round2(s.error / finished),
                invalidResponseRate: round2(s.invalid_response / finished),
                langMismatchRate: round2(s.langMismatch / finished),
                reviewedCount: s.reviewed,
                unreviewedCount: s.unreviewed,
                goodCount: s.good,
                badCount: s.bad,
                needsReviewCount: s.needs_review,
                exampleCount: s.examples,
                goodRate: s.reviewed > 0 ? round2(s.good / s.reviewed) : null,
                badRate: s.reviewed > 0 ? round2(s.bad / s.reviewed) : null,
                avgTokens: s.tokenSamples > 0 ? Math.round(s.totalTokens / s.tokenSamples) : null,
                avgLatencyMs: Math.round(s.totalLatencyMs / finished),
                lastSeen: s.lastSeen || null,
              },
            ];
            })
        ),
      };
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/admin/telemetry
// Deletes ALL telemetry records. Returns count of deleted documents.
export async function DELETE(request: Request) {
  const admin = await checkTelemetryAdminAuth(request);
  if (!admin.ok) return admin.response;

  try {
    const { adminDb } = await import("@/config/firebaseAdminConfig");
    const snapshot = await adminDb.collection(TELEMETRY_COLLECTION).get();
    const total = snapshot.size;

    // Firestore batch limit is 500
    const chunks: typeof snapshot.docs[] = [];
    for (let i = 0; i < snapshot.docs.length; i += 500) {
      chunks.push(snapshot.docs.slice(i, i + 500));
    }
    for (const chunk of chunks) {
      const batch = adminDb.batch();
      chunk.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }

    return NextResponse.json({ deleted: total });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
