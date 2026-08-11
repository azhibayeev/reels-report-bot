import { NextRequest, NextResponse } from "next/server";
import {
  buildRows,
  fetchAllReelsDetailed,
  fetchReelInsights,
  toSheetValues,
} from "../../../lib/reels-table";
import { buildHistory, MAX_DAYS, toHistoryValues } from "../../../lib/reels-history";
import { historyTab, reelsTab, syncSheet } from "../../../lib/sheets";
import { loadRecentSnapshots } from "../../../lib/storage";
import { resolveToken } from "../../../lib/token";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Ручное обновление Google-таблицы: вкладка со статистикой по всем Reels
// и вкладка истории (прирост просмотров по дням из снапшотов бота).
// ?dry=1 — только собрать данные и показать сводку, в таблицу не писать.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    if (!process.env.IG_USER_ID) throw new Error("IG_USER_ID is not set");

    const token = await resolveToken();
    const media = await fetchAllReelsDetailed(process.env.IG_USER_ID, token);
    const insights = await fetchReelInsights(token, media.map((m) => m.id));
    const rows = buildRows(media, insights);

    // MAX_DAYS приростов требует MAX_DAYS+1 снапшотов (прирост считается между парами).
    const history = buildHistory(await loadRecentSnapshots(MAX_DAYS + 1));

    if (req.nextUrl.searchParams.get("dry") === "1") {
      return NextResponse.json({
        ok: true,
        reels: rows.length,
        withInsights: insights.size,
        historyDays: history.dates.length,
        historyRows: history.rows.length,
        sample: rows.slice(0, 3),
      });
    }

    const updatedAt = new Date();
    await syncSheet(toSheetValues(rows, updatedAt), reelsTab());
    await syncSheet(toHistoryValues(history, updatedAt), historyTab(), 4);

    return NextResponse.json({
      ok: true,
      reels: rows.length,
      withInsights: insights.size,
      historyDays: history.dates.length,
      historyRows: history.rows.length,
      updatedAt: updatedAt.toISOString(),
    });
  } catch (e) {
    console.error("sheet sync failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
