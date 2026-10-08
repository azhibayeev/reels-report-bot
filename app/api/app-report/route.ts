import { NextRequest, NextResponse } from "next/server";
import { notifyAppReportFailure, sendAppReport } from "../../../lib/app-report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Сводка по приложению — свой ежедневный крон (vercel.json, 12:40 Джакарты — после
 * дневного отчёта). Отдельно от /api/report, чтобы её можно было перезапустить одну:
 * `vercel crons run /api/app-report` — без повтора рилсов и без защиты от дублей
 * дневного отчёта, которая молча пропустила бы второй запуск за день.
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
    await notifyAppReportFailure(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
