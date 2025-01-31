import { NextResponse } from "next/server";
import { Sermon } from "@/services/sermon.service";
import { mockSermons } from "../route";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id } = await params;
  const sermon = mockSermons.find((s) => s.id === id);

  return sermon
    ? NextResponse.json(sermon)
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}
