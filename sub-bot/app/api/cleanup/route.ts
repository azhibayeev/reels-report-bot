import { NextRequest, NextResponse } from "next/server";
import { cleanup } from "../../../lib/cleanup";
import { requireEnv } from "../../../lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Vercel подписывает вызовы cron этим заголовком. requireEnv, а не мягкая
  // проверка: эндпоинт удаляет файлы и закрывает задачи, поэтому без секрета он
  // должен падать, а не открываться наружу.
  if (req.headers.get("authorization") !== `Bearer ${requireEnv("CRON_SECRET")}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await cleanup(Date.now());
  return NextResponse.json({ ok: true, ...result });
}
