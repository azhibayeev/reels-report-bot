import { NextRequest, NextResponse } from "next/server";
import { loadAppLinkStats } from "../../../lib/applink-store";

export const dynamic = "force-dynamic";

// Сводка переходов по ссылкам установки: сколько людей ушло в стор по каждому
// амбассадору, с разбивкой по дням и платформам. Установки считаются в консолях
// Play и App Store — здесь только переходы, зато сразу, без суточной задержки.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, clicks: await loadAppLinkStats() });
  } catch (e) {
    console.error("applink stats failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
