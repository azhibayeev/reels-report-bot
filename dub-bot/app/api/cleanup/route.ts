import { NextRequest, NextResponse } from "next/server";
import { cleanup } from "../../../lib/cleanup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Vercel подписывает вызовы cron этим заголовком.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const removed = await cleanup(Date.now());
  return NextResponse.json({ ok: true, removed });
}
