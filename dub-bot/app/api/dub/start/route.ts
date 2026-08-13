import { NextRequest, NextResponse } from "next/server";
import { startDub } from "../../../../lib/start";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as { token?: string; blobUrl?: string; durationSec?: number };
  if (!body.token || !body.blobUrl) {
    return NextResponse.json({ error: "token и blobUrl обязательны" }, { status: 400 });
  }

  try {
    const result = await startDub({
      token: body.token,
      blobUrl: body.blobUrl,
      durationSec: Number(body.durationSec) || 0,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
