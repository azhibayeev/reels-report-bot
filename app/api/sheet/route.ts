import { NextRequest, NextResponse } from "next/server";
import {
  buildRows,
  fetchAllReelsDetailed,
  fetchReelInsights,
  toSheetValues,
} from "../../../lib/reels-table";
import { syncSheet } from "../../../lib/sheets";
import { resolveToken } from "../../../lib/token";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Ручное обновление Google-таблицы со статистикой по всем Reels.
// ?dry=1 — только собрать данные и показать первые строки, в таблицу не писать.
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

    if (req.nextUrl.searchParams.get("dry") === "1") {
      return NextResponse.json({
        ok: true,
        reels: rows.length,
        withInsights: insights.size,
        sample: rows.slice(0, 3),
      });
    }

    const updatedAt = new Date();
    await syncSheet(toSheetValues(rows, updatedAt));
    return NextResponse.json({
      ok: true,
      reels: rows.length,
      withInsights: insights.size,
      updatedAt: updatedAt.toISOString(),
    });
  } catch (e) {
    console.error("sheet sync failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
