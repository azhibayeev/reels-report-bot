import { NextRequest, NextResponse } from "next/server";
import { computeReport } from "../../../lib/diff";
import {
  escapeHtml,
  formatClicksMessage,
  formatCsv,
  formatInfoMessage,
  formatNowMessage,
  formatTargetMessage,
} from "../../../lib/format";
import { fetchAllReels, fetchFollowersCount, fetchViews } from "../../../lib/instagram";
import { getLeadLevels } from "../../../lib/leads";
import { getAdInsights } from "../../../lib/meta";
import { getClicksStats, lastSprintStart } from "../../../lib/posthog";
import { jakartaDateKey, loadPreviousSnapshot } from "../../../lib/storage";
import { sendDocument, sendMessage, SendOptions } from "../../../lib/telegram";
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
  "/otchet — таблица (CSV) по всем рилсам с приростом\n" +
  "/info — общая статистика по всем рилсам\n" +
  "/kliki — заходы по ссылкам за спринт (с 12:30)\n" +
  "/klikitotal — заходы по ссылкам за всё время\n" +
  "/target — таргет за сутки (реклама + уровни лидов)\n" +
  "/targettotal — таргет за всё время (тотал по всем показателям)";

// Живой замер: список рилсов + актуальные просмотры. Снапшот НЕ сохраняем,
// чтобы не сдвигать базу ежедневного отчёта.
async function takeLiveSnapshot(): Promise<Snapshot> {
  const igUserId = process.env.IG_USER_ID;
  if (!igUserId) throw new Error("IG_USER_ID is not set");
  const token = await resolveToken();
  const media = await fetchAllReels(igUserId, token);
  const views = await fetchViews(token, media.map((m) => m.id));
  const followersCount = await fetchFollowersCount(igUserId, token);
  return {
    takenAt: new Date().toISOString(),
    ...(followersCount != null ? { followersCount } : {}),
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
  if (cmd === "/id") {
    // Утилита: узнать id темы форума (выполнить в нужной теме, напр. «Аналитика»).
    const thread = "thread" in opts ? opts.thread : null;
    await sendMessage(
      thread
        ? `🧵 message_thread_id этой темы: <code>${thread}</code>\nchat_id: <code>${escapeHtml(process.env.TELEGRAM_CHAT_ID ?? "")}</code>`
        : `Это General (без темы форума).\nchat_id: <code>${escapeHtml(process.env.TELEGRAM_CHAT_ID ?? "")}</code>`,
      opts
    );
    return;
  }
  if (cmd === "/kliki") {
    const since = Math.floor(lastSprintStart().getTime() / 1000);
    await sendMessage(formatClicksMessage(await getClicksStats(since), "Заходы по ссылкам · спринт"), opts);
    return;
  }
  if (cmd === "/klikitotal") {
    await sendMessage(formatClicksMessage(await getClicksStats(0), "Заходы по ссылкам · за всё время"), opts);
    return;
  }
  if (cmd === "/target") {
    const ads = await getAdInsights("yesterday");
    const levels = await getLeadLevels(lastSprintStart().toISOString());
    await sendMessage(
      formatTargetMessage(ads, levels, "за сутки", "🗓 Реклама — вчерашние сутки · лиды — с 12:30 вчера"),
      opts
    );
    return;
  }
  if (cmd === "/targettotal") {
    const ads = await getAdInsights("maximum");
    const levels = await getLeadLevels(null);
    await sendMessage(formatTargetMessage(ads, levels, "за всё время", "За всё время"), opts);
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
  if (cmd === "/otchet") {
    const current = await takeLiveSnapshot();
    const key = jakartaDateKey(new Date());
    const prev = await loadPreviousSnapshot(key);
    const report = computeReport(current, prev);
    await sendDocument(
      `reels-${key}.csv`,
      formatCsv(report),
      "Таблица: все рилсы со ссылками, отсортированы по приросту. Строки 1–10 = ТОП-10 🏆",
      opts
    );
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
        { command: "otchet", description: "Таблица (CSV) по всем рилсам" },
        { command: "info", description: "Общая статистика по всем рилсам" },
        { command: "kliki", description: "Заходы по ссылкам за спринт (с 12:30)" },
        { command: "klikitotal", description: "Заходы по ссылкам за всё время" },
        { command: "target", description: "Таргет за сутки (реклама + уровни лидов)" },
        { command: "targettotal", description: "Таргет за всё время (тотал)" },
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
