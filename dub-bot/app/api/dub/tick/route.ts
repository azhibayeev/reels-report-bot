import { after, NextRequest, NextResponse } from "next/server";
import { requireEnv } from "../../../../lib/config";
import { runTick } from "../../../../lib/tick";
import { tickKey } from "../../../../lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const jobId = req.nextUrl.searchParams.get("job") ?? "";
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!jobId || key !== tickKey(jobId, requireEnv("DUB_TOKEN_SECRET"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Отвечаем сразу, а опрос крутим после ответа: вызывающая сторона не должна
  // висеть все четыре минуты.
  after(() => runTick(jobId).catch((error) => console.error("tick failed", jobId, error)));
  return NextResponse.json({ ok: true }, { status: 202 });
}
