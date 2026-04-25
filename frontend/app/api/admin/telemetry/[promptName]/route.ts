import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  buildTelemetryQualityReview,
  checkTelemetryAdminAuth,
  TELEMETRY_COLLECTION,
  TelemetryReviewPatchSchema,
} from "../telemetryAdmin";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const REVIEW_QUALITIES = new Set(["unreviewed", "good", "bad", "needs_review"]);

type TelemetryRecordForAdmin = {
  documentId: string;
  timestamp?: string;
  status?: string;
  jsonStructureStatus?: string;
  qualityReview?: {
    quality?: string;
    keepAsExample?: boolean;
  };
  [key: string]: unknown;
};

// GET /api/admin/telemetry/[promptName]?limit=50&version=v2
// Returns full telemetry records for a specific promptName, sorted by timestamp desc.
// Optional: ?version=v2 to filter by promptVersion
// Optional: ?limit=N (default 50, max 500)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ promptName: string }> }
) {
  const authError = checkTelemetryAdminAuth(request);
  if (authError) return authError;

  const { promptName } = await params;
  const decoded = decodeURIComponent(promptName);
  const { searchParams } = new URL(request.url);

  const limitParam = parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = isNaN(limitParam) ? DEFAULT_LIMIT : Math.min(Math.max(1, limitParam), MAX_LIMIT);
  const versionFilter = searchParams.get("version");
  const qualityFilter = searchParams.get("quality");
  const statusFilter = searchParams.get("jsonStatus") ?? searchParams.get("status");
  const examplesOnly = searchParams.get("examples") === "true";

  if (qualityFilter && !REVIEW_QUALITIES.has(qualityFilter)) {
    return NextResponse.json({ error: "Invalid quality filter" }, { status: 400 });
  }

  try {
    const { adminDb } = await import("@/config/firebaseAdminConfig");

    // No orderBy to avoid requiring a composite Firestore index — sort in memory instead.
    let query = adminDb
      .collection(TELEMETRY_COLLECTION)
      .where("promptName", "==", decoded);

    if (versionFilter) {
      query = adminDb
        .collection(TELEMETRY_COLLECTION)
        .where("promptName", "==", decoded)
        .where("promptVersion", "==", versionFilter);
    }

    const snapshot = await query.get();
    const records = snapshot.docs
      .map((doc) => ({ documentId: doc.id, ...doc.data() } as TelemetryRecordForAdmin))
      .filter((record) => !qualityFilter || record.qualityReview?.quality === qualityFilter)
      .filter((record) => !statusFilter || (record.jsonStructureStatus ?? record.status) === statusFilter)
      .filter((record) => !examplesOnly || record.qualityReview?.keepAsExample === true)
      .sort((a, b) => ((b.timestamp as string) ?? "").localeCompare((a.timestamp as string) ?? ""))
      .slice(0, limit);

    return NextResponse.json({
      promptName: decoded,
      version: versionFilter ?? null,
      quality: qualityFilter ?? null,
      jsonStatus: statusFilter ?? null,
      examplesOnly,
      count: records.length,
      limit,
      records,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/admin/telemetry/[promptName]
// Marks one telemetry record as good/bad/needs_review/unreviewed for prompt iteration.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ promptName: string }> }
) {
  const authError = checkTelemetryAdminAuth(request);
  if (authError) return authError;

  const { promptName } = await params;
  const decoded = decodeURIComponent(promptName);

  try {
    const body = TelemetryReviewPatchSchema.parse(await request.json());
    const qualityReview = buildTelemetryQualityReview(body);
    const { adminDb, FieldValue } = await import("@/config/firebaseAdminConfig");
    const docRef = adminDb.collection(TELEMETRY_COLLECTION).doc(body.eventId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return NextResponse.json({ error: "Telemetry record not found" }, { status: 404 });
    }

    const data = docSnap.data();
    if (data?.promptName !== decoded) {
      return NextResponse.json({ error: "Telemetry record belongs to a different promptName" }, { status: 409 });
    }

    await docRef.update({
      qualityReview,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      promptName: decoded,
      eventId: body.eventId,
      qualityReview,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid review payload", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/admin/telemetry/[promptName]
// Deletes all records for a specific promptName. Returns count of deleted documents.
// Optional: ?version=v1 to delete only a specific version
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ promptName: string }> }
) {
  const authError = checkTelemetryAdminAuth(request);
  if (authError) return authError;

  const { promptName } = await params;
  const decoded = decodeURIComponent(promptName);
  const { searchParams } = new URL(request.url);
  const versionFilter = searchParams.get("version");

  try {
    const { adminDb } = await import("@/config/firebaseAdminConfig");

    let query = adminDb.collection(TELEMETRY_COLLECTION).where("promptName", "==", decoded);

    if (versionFilter) {
      query = adminDb
        .collection(TELEMETRY_COLLECTION)
        .where("promptName", "==", decoded)
        .where("promptVersion", "==", versionFilter);
    }

    const snapshot = await query.get();
    const total = snapshot.size;

    const chunks: typeof snapshot.docs[] = [];
    for (let i = 0; i < snapshot.docs.length; i += 500) {
      chunks.push(snapshot.docs.slice(i, i + 500));
    }
    for (const chunk of chunks) {
      const batch = adminDb.batch();
      chunk.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }

    return NextResponse.json({
      promptName: decoded,
      version: versionFilter ?? null,
      deleted: total,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
