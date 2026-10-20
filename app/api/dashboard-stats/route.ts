import { NextRequest, NextResponse } from "next/server";
import { DARISTEPPE } from "../../../lib/accounts";
import { bearerMatches, toDashboardStats } from "../../../lib/dashboard-stats";
import { loadRecentSnapshots } from "../../../lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Данные для ТВ-дашборда: подписчики и просмотры по дням @daristeppe за 30 дней.
 * Воркер дашборда ходит сюда раз в час с Bearer DASHBOARD_STATS_TOKEN.
 * Без заданного токена закрыто для всех.
 */
export async function GET(req: NextRequest) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.DASHBOARD_STATS_TOKEN)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const snaps = await loadRecentSnapshots(30, DARISTEPPE);
    return NextResponse.json(toDashboardStats(snaps));
  } catch (e) {
    console.error("dashboard stats failed:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
