import { after, NextRequest, NextResponse } from "next/server";
import { handleUpdate } from "../../../../lib/dub/bot";
import { notifyStartFailed } from "../../../../lib/dub/deliver";
import { setWebhook, TgUpdate } from "../../../../lib/dub/telegram";

// Скачать ролик из Telegram и загрузить его в ElevenLabs — минуты при 20 МБ,
// поэтому работа уходит в after(), а Telegram получает 200 сразу и не ретраит.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // Свой секрет, а не CRON_SECRET: этот бот живёт рядом с ботом отчётов, и общий
  // секрет означал бы, что чужой вебхук способен дёргать кроны фермы.
  const secret = process.env.DUB_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Хост читаем здесь, а не в after(): к моменту фоновой работы запроса уже нет,
  // а боту он нужен — из него собирается ссылка на страницу загрузки.
  const baseUrl = `https://${req.headers.get("x-forwarded-host") ?? req.nextUrl.host}`;

  after(async () => {
    try {
      await handleUpdate(update, baseUrl);
    } catch (e) {
      console.error(`dub: обработка апдейта ${update.update_id} — ${e instanceof Error ? e.stack : e}`);
      if (update.message) await notifyStartFailed(update.message.chat.id, e);
    }
  });

  return NextResponse.json({ ok: true });
}

// Одноразовая настройка: GET /api/dub/telegram с Authorization: Bearer <DUB_WEBHOOK_SECRET>.
export async function GET(req: NextRequest) {
  const secret = process.env.DUB_WEBHOOK_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const host = req.headers.get("x-forwarded-host") ?? req.nextUrl.host;
  await setWebhook(`https://${host}/api/dub/telegram`, secret);
  return NextResponse.json({ ok: true, webhook: `https://${host}/api/dub/telegram` });
}
