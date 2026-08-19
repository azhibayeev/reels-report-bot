import { NextRequest, NextResponse } from "next/server";
import { accountByKey, accountUserId, DARISTEPPE } from "../../../lib/accounts";
import { syncAccountSheets } from "../../../lib/sheet-sync";
import { resolveToken } from "../../../lib/token";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Ручное обновление Google-таблицы: вкладка со статистикой по всем Reels
// и вкладка истории (прирост просмотров по дням из снапшотов бота).
// ?account=<ключ> — по какому аккаунту (по умолчанию daristeppe).
// ?dry=1 — только собрать данные и показать сводку, в таблицу не писать.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const key = req.nextUrl.searchParams.get("account");
    const acc = key ? accountByKey(key) : DARISTEPPE;
    if (!acc) return NextResponse.json({ ok: false, error: `неизвестный аккаунт «${key}»` }, { status: 400 });

    const igUserId = accountUserId(acc);
    const token = await resolveToken(acc);
    const result = await syncAccountSheets(acc, igUserId, token, {
      dry: req.nextUrl.searchParams.get("dry") === "1",
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("sheet sync failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
