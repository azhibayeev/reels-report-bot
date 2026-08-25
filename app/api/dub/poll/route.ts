import { NextRequest, NextResponse } from "next/server";
import { livePollDeps, pollJobs } from "../../../../lib/dub/deliver";

// Скачать готовый дубляж из ElevenLabs и выгрузить его в Telegram — до 50 МБ
// в обе стороны, поэтому проходу нужен полный бюджет вызова.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await pollJobs(livePollDeps());
  if (result.checked) console.log(`dub: проверено ${result.checked}, отдано ${result.delivered}, сбоев ${result.failed}`);
  return NextResponse.json({ ok: true, ...result });
}
