import { after, NextRequest, NextResponse } from "next/server";
import { livePostTickDeps, runPostTick } from "../../../../lib/farm/post";
import { requireEnv } from "../../../../lib/farm/tick";
import { tickKey } from "../../../../lib/farm/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function checkKey(req: NextRequest): boolean {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  return key === tickKey("post", requireEnv("FARM_TOKEN_SECRET"));
}

// Отвечаем 202 сразу, а сам постинг крутим после ответа: опрос готовности
// контейнера в waitForContainer занимает минуты, а внешний таймер cron-job.org
// столько ждать не должен. Один ролик за тик — слоты разнесены на 45 минут,
// просрочилось два — второй уедет следующим тиком.
function handle(req: NextRequest): NextResponse {
  if (!checkKey(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  after(() => runPostTick(livePostTickDeps(), 1).catch((error) => console.error("post tick failed", error)));
  return NextResponse.json({ ok: true }, { status: 202 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}
