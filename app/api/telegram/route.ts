import { NextRequest, NextResponse } from "next/server";
import { AccountConfig, accountUserId, DARISTEPPE, QURANY_APP } from "../../../lib/accounts";
import { computeReport } from "../../../lib/diff";
import {
  escapeHtml,
  formatClicksMessage,
  formatCsv,
  formatInfoMessage,
  formatNowMessage,
  formatTargetMessage,
} from "../../../lib/format";
import { handleCallback, handleEditReply, liveApproveDeps } from "../../../lib/farm/approve";
import {
  batchesToKick,
  formatQueue,
  parseFarmCommand,
  parseStylePosition,
  positionName,
} from "../../../lib/farm/commands";
import { listItems } from "../../../lib/farm/store";
import { loadDefaultPosition, saveDefaultPosition } from "../../../lib/farm/style";
import { answerCallback } from "../../../lib/farm/telegram";
import { requireEnv, triggerRender } from "../../../lib/farm/tick";
import { BATCH_TOKEN_TTL_MS, signBatchToken } from "../../../lib/farm/tokens";
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
    chat?: { id?: number | string; type?: string };
    from?: { id?: number };
    reply_to_message?: { message_id?: number };
  };
  callback_query?: {
    id: string;
    data?: string;
    from?: { id?: number };
    message?: { message_id?: number; chat?: { id?: number | string; type?: string } };
  };
}

const HELP =
  "Команды:\n" +
  "/now — отчёт с 12:30 вчера по текущий момент (@daristeppe)\n" +
  "/otchet — таблица (CSV) по всем рилсам с приростом (@daristeppe)\n" +
  "/info — общая статистика по всем рилсам (@daristeppe)\n" +
  "/nowapp — отчёт с 12:30 вчера по текущий момент (@qurany_app)\n" +
  "/infoapp — общая статистика по всем рилсам (@qurany_app)\n" +
  "/kliki — заходы по ссылкам за спринт (с 12:30)\n" +
  "/klikitotal — заходы по ссылкам за всё время\n" +
  "/target — таргет за сутки (реклама + уровни лидов)\n" +
  "/targettotal — таргет за всё время (тотал по всем показателям)\n" +
  "/batch — загрузить пачку роликов фермы (ссылка на 30 минут)\n" +
  "/reels — сводка по ферме: апрув, очередь, сбои\n" +
  "/style верх|центр|низ — дефолтная позиция хука для будущих пачек (без аргумента — показать текущую)";

// Живой замер: список рилсов + актуальные просмотры. Снапшот НЕ сохраняем,
// чтобы не сдвигать базу ежедневного отчёта.
async function takeLiveSnapshot(acc: AccountConfig): Promise<Snapshot> {
  const igUserId = accountUserId(acc);
  const token = await resolveToken(acc);
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

async function handleReportCommand(cmd: string, opts: SendOptions): Promise<void> {
  if (cmd === "/start" || cmd === "/help") {
    await sendMessage(HELP, opts);
    return;
  }
  if (cmd === "/id") {
    // Утилита: узнать id темы форума (выполнить в нужной теме, напр. «Аналитика»).
    const thread = "thread" in opts ? opts.thread : null;
    const here = String(opts.chat ?? process.env.TELEGRAM_CHAT_ID ?? "");
    await sendMessage(
      thread
        ? `🧵 message_thread_id этой темы: <code>${thread}</code>\nchat_id: <code>${escapeHtml(here)}</code>`
        : `Без темы форума (General или личка).\nchat_id: <code>${escapeHtml(here)}</code>`,
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
  // Пары команд: базовая — по @daristeppe, с суффиксом app — по @qurany_app.
  if (cmd === "/info" || cmd === "/infoapp") {
    const acc = cmd === "/infoapp" ? QURANY_APP : DARISTEPPE;
    await sendMessage(formatInfoMessage(await takeLiveSnapshot(acc), acc.label), opts);
    return;
  }
  if (cmd === "/now" || cmd === "/nowapp") {
    const acc = cmd === "/nowapp" ? QURANY_APP : DARISTEPPE;
    const current = await takeLiveSnapshot(acc);
    const prev = await loadPreviousSnapshot(jakartaDateKey(new Date()), acc);
    await sendMessage(formatNowMessage(computeReport(current, prev), acc.label), opts);
    return;
  }
  if (cmd === "/otchet") {
    const current = await takeLiveSnapshot(DARISTEPPE);
    const key = jakartaDateKey(new Date());
    const prev = await loadPreviousSnapshot(key, DARISTEPPE);
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

// Команды фермы. Возвращает true, если справилась сама — тогда handleReportCommand
// вызывать не нужно. Принимает полный текст сообщения (не только первый токен),
// потому что /style читает аргумент позиции из текста.
async function handleFarmCommand(cmd: string, text: string, opts: SendOptions, req: NextRequest): Promise<boolean> {
  if (cmd === "/batch") {
    // Чат берём из опций, а не из env: команду можно дать и в личке, и карточки
    // роликов должны прийти туда же, откуда её отправили.
    const chatId = Number(opts.chat ?? process.env.TELEGRAM_CHAT_ID);
    const threadId = opts.thread ?? null;
    const token = signBatchToken(chatId, threadId, Date.now() + BATCH_TOKEN_TTL_MS, requireEnv("FARM_TOKEN_SECRET"));
    const explicitBase = process.env.FARM_BASE_URL;
    const base = explicitBase
      ? explicitBase.replace(/\/+$/, "")
      : `https://${req.headers.get("x-forwarded-host") ?? req.nextUrl.host}`;
    await sendMessage(`📥 Загрузка пачки роликов:\n${base}/farm/${token}\n\nСсылка живёт 30 минут.`, opts);
    return true;
  }
  if (cmd === "/reels") {
    const items = await listItems();
    await sendMessage(formatQueue(items, Date.now()), opts);
    for (const batchId of batchesToKick(items, Date.now())) {
      try {
        await triggerRender(batchId);
      } catch (error) {
        // Упавший пинок не должен ронять ответ на команду — цепочка рендера
        // подхватится сама на следующем /reels или очередном тике.
        console.error("farm /reels triggerRender failed", batchId, error);
      }
    }
    return true;
  }
  if (cmd === "/style") {
    const arg = parseStylePosition(text);
    if (arg === "show") {
      const current = await loadDefaultPosition();
      await sendMessage(`Дефолтная позиция хука: <b>${positionName(current)}</b>`, opts);
      return true;
    }
    if (arg === null) {
      await sendMessage("Использование: /style верх|центр|низ (или top|center|bottom)", opts);
      return true;
    }
    await saveDefaultPosition(arg);
    await sendMessage(`✅ Дефолтная позиция хука: <b>${positionName(arg)}</b>\nПрименится к следующим пачкам.`, opts);
    return true;
  }
  return false;
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
      // Без callback_query нажатия инлайн-кнопок апрува до бота не доедут вообще.
      allowed_updates: ["message", "callback_query"],
    }),
  });
  const commands = await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commands: [
        { command: "now", description: "Отчёт с 12:30 вчера по сейчас (@daristeppe)" },
        { command: "otchet", description: "Таблица (CSV) по всем рилсам (@daristeppe)" },
        { command: "info", description: "Общая статистика по всем рилсам (@daristeppe)" },
        { command: "nowapp", description: "Отчёт с 12:30 вчера по сейчас (@qurany_app)" },
        { command: "infoapp", description: "Общая статистика по всем рилсам (@qurany_app)" },
        { command: "kliki", description: "Заходы по ссылкам за спринт (с 12:30)" },
        { command: "klikitotal", description: "Заходы по ссылкам за всё время" },
        { command: "target", description: "Таргет за сутки (реклама + уровни лидов)" },
        { command: "targettotal", description: "Таргет за всё время (тотал)" },
        { command: "batch", description: "Загрузить пачку роликов фермы" },
        { command: "reels", description: "Сводка по ферме: апрув, очередь, сбои" },
        { command: "style", description: "Дефолтная позиция хука для будущих пачек" },
      ],
    }),
  });
  return NextResponse.json({ webhook: await webhook.json(), commands: await commands.json() });
}

// Личку принимаем от тех, кто состоит в рабочей группе: бот открыт по адресу, и
// без проверки любой нашедший его мог бы заливать пачки и публиковать в наш
// Instagram. Членство спрашиваем у Telegram, а не ведём список руками — доступ
// тогда сам следует за составом команды.
const MEMBER_STATUSES = ["creator", "administrator", "member", "restricted"];

async function isTeamMember(userId: number | undefined): Promise<boolean> {
  const groupId = process.env.TELEGRAM_CHAT_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!userId || !groupId || !botToken) return false;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(groupId)}&user_id=${userId}`,
      { cache: "no-store" }
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean; result?: { status?: string } };
    return Boolean(data.ok) && MEMBER_STATUSES.includes(data.result?.status ?? "");
  } catch (error) {
    // Сеть отвалилась — молча отказываем: пустить чужого хуже, чем не пустить своего.
    console.error("getChatMember failed:", error);
    return false;
  }
}

// Групповой чат узнаём по id, личку — по членству отправителя в группе.
async function isAllowedSource(chat: { id?: number | string; type?: string } | undefined, fromId: number | undefined): Promise<boolean> {
  if (String(chat?.id ?? "") === process.env.TELEGRAM_CHAT_ID) return true;
  if (chat?.type !== "private") return false;
  return isTeamMember(fromId);
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

  const cb = update.callback_query;
  if (cb) {
    const cbChatId = cb.message?.chat?.id;
    if (!(await isAllowedSource(cb.message?.chat, cb.from?.id))) {
      return NextResponse.json({ ok: true });
    }
    try {
      await handleCallback({ id: cb.id, data: cb.data ?? "", chatId: Number(cbChatId) }, liveApproveDeps());
    } catch (e) {
      console.error("callback_query failed:", e);
      try {
        // Без ответа на callback у человека в клиенте крутится вечный спиннер.
        await answerCallback(cb.id, "Ошибка, попробуйте ещё раз");
      } catch {
        // Telegram тоже недоступен — остаётся лог Vercel.
      }
    }
    return NextResponse.json({ ok: true });
  }

  const msg = update.message;
  const fromOurChat = await isAllowedSource(msg?.chat, msg?.from?.id);

  if (fromOurChat && msg?.reply_to_message?.message_id) {
    try {
      const handled = await handleEditReply(
        {
          chatId: Number(msg.chat?.id),
          threadId: msg.message_thread_id ?? null,
          text: msg.text ?? "",
          replyToMessageId: msg.reply_to_message.message_id,
        },
        liveApproveDeps()
      );
      if (handled) return NextResponse.json({ ok: true });
    } catch (e) {
      console.error("farm edit reply failed:", e);
      // handleEditReply уже сохранил новое описание и status: "review" до
      // попытки переотправить карточку (см. lib/farm/approve.ts) — раз она
      // упала, ролик остался без карточки в чате, а повторный ответ на старый
      // промпт его больше не найдёт (editPromptId обнулён). Молчать нельзя:
      // человек должен узнать, что текст цел, а кнопки апрува пропали.
      try {
        await sendMessage(
          escapeHtml(`Новое описание сохранено, но карточку переотправить не удалось: ${(e as Error).message}. Ролик остался ждать апрува без карточки.`),
          { thread: msg.message_thread_id ?? null, chat: msg.chat?.id }
        );
      } catch (notifyError) {
        console.error("farm edit reply notify failed:", notifyError);
      }
      // Не прерываем обработку — провалимся к разбору обычных команд ниже.
    }
  }

  const text = msg?.text?.trim() ?? "";
  // Реагируем только на команды из нашей группы; всё остальное молча подтверждаем,
  // чтобы Telegram не ретраил доставку.
  if (!text.startsWith("/") || !fromOurChat) {
    return NextResponse.json({ ok: true });
  }

  // "/now@bot_name arg" -> "/now"; отвечаем в ту же тему форума, откуда пришла команда.
  const cmd = text.split(/\s+/)[0].split("@")[0].toLowerCase();
  const opts: SendOptions = { thread: msg?.message_thread_id ?? null, chat: msg?.chat?.id };

  try {
    const handledByFarm = parseFarmCommand(text) ? await handleFarmCommand(cmd, text, opts, req) : false;
    if (!handledByFarm) await handleReportCommand(cmd, opts);
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
