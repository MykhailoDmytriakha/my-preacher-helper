import { NextResponse } from "next/server";

const TELEMETRY_COLLECTION = process.env.AI_TELEMETRY_COLLECTION || "ai_prompt_telemetry";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function checkAuth(request: Request): NextResponse | null {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "ADMIN_SECRET is not configured" }, { status: 503 });
  }
  if (request.headers.get("x-admin-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

// GET /api/admin/telemetry/[promptName]?limit=50&version=v2
// Returns full telemetry records for a specific promptName, sorted by timestamp desc.
// Optional: ?version=v2 to filter by promptVersion
// Optional: ?limit=N (default 50, max 500)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ promptName: string }> }
) {
  const authError = checkAuth(request);
  if (authError) return authError;

  const { promptName } = await params;
  const decoded = decodeURIComponent(promptName);
  const { searchParams } = new URL(request.url);

  const limitParam = parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = isNaN(limitParam) ? DEFAULT_LIMIT : Math.min(Math.max(1, limitParam), MAX_LIMIT);
  const versionFilter = searchParams.get("version");

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
      .map((doc) => doc.data())
      .sort((a, b) => ((b.timestamp as string) ?? "").localeCompare((a.timestamp as string) ?? ""))
      .slice(0, limit);

    return NextResponse.json({
      promptName: decoded,
      version: versionFilter ?? null,
      count: records.length,
      limit,
      records,
    });
  } catch (error) {
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
  const authError = checkAuth(request);
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
