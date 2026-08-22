import { NextRequest, NextResponse } from "next/server";
import { loadCooldown } from "../../../../lib/farm/cooldown";
import { listItems, saveItem } from "../../../../lib/farm/store";
import { nextFreeSlot, slotConfigFromEnv } from "../../../../lib/farm/slots";
import { loadRhythm } from "../../../../lib/farm/style";
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

  const rhythm = await loadRhythm();
  const cfg = { ...slotConfigFromEnv(), ...(rhythm ? { minutes: rhythm.minutes, perDay: rhythm.perDay } : {}) };
  const result = await runSweep({
    now: () => Date.now(),
    loadCooldown,
    listItems,
    saveItem,
    nextFreeSlot: (taken, nowMs) => nextFreeSlot(taken, nowMs, cfg),
    triggerRender,
  });
  // Отказавшие пачки отдаём в теле и в лог: молча проглоченный сбой будильника
  // означал бы, что последняя линия обороны сломана, а мы об этом не знаем.
  if (result.failed.length) console.error("farm sweep: пачки не пнулись", result.failed);
  return NextResponse.json(result);
}
