import { NextRequest, NextResponse } from "next/server";
import { computeReport } from "../../../lib/diff";
import { escapeHtml, formatInfoMessage, formatNowMessage } from "../../../lib/format";
import { fetchAllReels, fetchViews } from "../../../lib/instagram";
import { jakartaDateKey, loadPreviousSnapshot } from "../../../lib/storage";
import { sendMessage, SendOptions } from "../../../lib/telegram";
import { resolveToken } from "../../../lib/token";
import { Snapshot } from "../../../lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface TelegramUpdate {
  message?: {
    text?: string;
    message_thread_id?: number;
    chat?: { id?: number | string };
  };
}

const HELP =
  "Команды:\n" +
  "/now — отчёт с 12:30 вчера по текущий момент\n" +
  "/info — общая статистика по всем рилсам";

// Живой замер: список рилсов + актуальные просмотры. Снапшот НЕ сохраняем,
// чтобы не сдвигать базу ежедневного отчёта.
async function takeLiveSnapshot(): Promise<Snapshot> {
  const igUserId = process.env.IG_USER_ID;
  if (!igUserId) throw new Error("IG_USER_ID is not set");
  const token = await resolveToken();
  const media = await fetchAllReels(igUserId, token);
  const views = await fetchViews(token, media.map((m) => m.id));
  return {
    takenAt: new Date().toISOString(),
    reels: media.map((m) => ({
      id: m.id,
      permalink: m.permalink,
      publishedAt: m.timestamp,
      caption: m.caption,
      views: views.get(m.id) ?? 0,
    })),
  };
}

async function handleCommand(cmd: string, opts: SendOptions): Promise<void> {
  if (cmd === "/start" || cmd === "/help") {
    await sendMessage(HELP, opts);
    return;
  }
  if (cmd === "/info") {
    await sendMessage(formatInfoMessage(await takeLiveSnapshot()), opts);
    return;
  }
  if (cmd === "/now") {
    const current = await takeLiveSnapshot();
    const prev = await loadPreviousSnapshot(jakartaDateKey(new Date()));
    await sendMessage(formatNowMessage(computeReport(current, prev)), opts);
    return;
  }
}

// Одноразовая настройка: регистрирует webhook и меню команд у Telegram.
// Вызывается вручную с секретом крона: GET /api/telegram с Authorization: Bearer <CRON_SECRET>.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN is not set" }, { status: 500 });

  const host = req.headers.get("x-forwarded-host") ?? req.nextUrl.host;
  const webhook = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: `https://${host}/api/telegram`,
      secret_token: secret,
      allowed_updates: ["message"],
    }),
  });
  const commands = await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commands: [
        { command: "now", description: "Отчёт с 12:30 вчера по сейчас" },
        { command: "info", description: "Общая статистика по всем рилсам" },
      ],
    }),
  });
  return NextResponse.json({ webhook: await webhook.json(), commands: await commands.json() });
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const msg = update.message;
  const text = msg?.text?.trim() ?? "";
  // Реагируем только на команды из нашей группы; всё остальное молча подтверждаем,
  // чтобы Telegram не ретраил доставку.
  if (!text.startsWith("/") || String(msg?.chat?.id ?? "") !== process.env.TELEGRAM_CHAT_ID) {
    return NextResponse.json({ ok: true });
  }

  // "/now@bot_name arg" -> "/now"; отвечаем в ту же тему форума, откуда пришла команда.
  const cmd = text.split(/\s+/)[0].split("@")[0].toLowerCase();
  const opts: SendOptions = { thread: msg?.message_thread_id ?? null };

  try {
    await handleCommand(cmd, opts);
  } catch (e) {
    console.error(`${cmd} failed:`, e);
    const errMsg = e instanceof Error ? e.message : String(e);
    try {
      await sendMessage(`⚠️ Не удалось выполнить ${cmd}:\n<code>${escapeHtml(errMsg)}</code>`, opts);
    } catch {
      // Telegram тоже недоступен — остаётся лог Vercel.
    }
  }
  return NextResponse.json({ ok: true });
}
