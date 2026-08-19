import { NextRequest, NextResponse } from "next/server";
import { liveDailyDeps, runDaily } from "../../../../lib/farm/daily";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runDaily(liveDailyDeps());
  return NextResponse.json(result);
}
