import { NextRequest, NextResponse } from "next/server";
import { sendAppReport } from "../../../lib/app-report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ручной прогон сводки по приложению — только она, без рилсов и прочих блоков: проверить
 * цифры после настройки, не засыпая чат повтором всего дневного отчёта. Ежедневно та же
 * сводка уходит из /api/report.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json({ ok: true, ...(await sendAppReport(new Date())) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("app report failed:", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
