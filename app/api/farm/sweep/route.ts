import { NextRequest, NextResponse } from "next/server";
import { loadCooldown } from "../../../../lib/farm/cooldown";
import { listItems, saveItem } from "../../../../lib/farm/store";
import { loadPace, paceSlotConfig } from "../../../../lib/farm/pace";
import { isOnGrid, nextFreeSlot } from "../../../../lib/farm/slots";
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

  // Сетку собираем один раз на проход: и выдача свободного слота, и проверка
  // «а на сетке ли очередь» обязаны говорить об одном и том же темпе.
  const cfg = paceSlotConfig(await loadPace());
  const result = await runSweep({
    now: () => Date.now(),
    loadCooldown,
    onGrid: (iso) => isOnGrid(iso, cfg),
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
