import { NextRequest, NextResponse } from "next/server";
import { listItems } from "../../../../lib/farm/store";
import { runSweep } from "../../../../lib/farm/sweep";
import { triggerRender } from "../../../../lib/farm/tick";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Будильник только пинает: сам он ничего не рендерит и укладывается в секунды.
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runSweep({ now: () => Date.now(), listItems, triggerRender });
  // Отказавшие пачки отдаём в теле и в лог: молча проглоченный сбой будильника
  // означал бы, что последняя линия обороны сломана, а мы об этом не знаем.
  if (result.failed.length) console.error("farm sweep: пачки не пнулись", result.failed);
  return NextResponse.json(result);
}
