import { NextRequest, NextResponse } from "next/server";
import { allowedChatIds, baseUrl, requireEnv } from "../../../lib/config";
import { handleCommand, parseCommand } from "../../../lib/commands";
import { listJobs } from "../../../lib/jobs";
import { sendMessage } from "../../../lib/telegram";
import { signToken, UPLOAD_TOKEN_TTL_MS } from "../../../lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id?: number };
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Секрет проверяем до разбора тела: вебхук открыт наружу.
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== requireEnv("TELEGRAM_WEBHOOK_SECRET")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const update = (await req.json()) as TelegramUpdate;
  const chatId = update.message?.chat?.id;
  const text = update.message?.text;
  if (typeof chatId !== "number" || !text) return NextResponse.json({ ok: true });

  const botToken = requireEnv("TELEGRAM_SUB_BOT_TOKEN");
  if (!allowedChatIds().includes(chatId)) {
    await sendMessage(botToken, chatId, "Этот бот приватный.");
    return NextResponse.json({ ok: true });
  }

  const command = parseCommand(text);
  if (!command) {
    await sendMessage(botToken, chatId, "Не понял. Отправь /sub или /help.");
    return NextResponse.json({ ok: true });
  }

  try {
    const reply = await handleCommand(command, chatId, {
      uploadUrl: (id) => {
        const token = signToken(id, Date.now() + UPLOAD_TOKEN_TTL_MS, requireEnv("SUB_TOKEN_SECRET"));
        return `${baseUrl()}/u/${token}`;
      },
      listJobs,
    });
    await sendMessage(botToken, chatId, reply);
  } catch (error) {
    console.error("command failed", command, error);
    // Telegram ретраит вебхук, если тот не вернул 200. Само сообщение об ошибке
    // тоже может не уйти (например, sendMessage упадёт на сетевой ошибке) —
    // это нельзя дать всплыть наружу и утащить ответ вебхука за собой.
    try {
      await sendMessage(botToken, chatId, `Сломалось: ${(error as Error).message}`);
    } catch (sendError) {
      console.error("failed to report error to chat", chatId, sendError);
    }
  }

  return NextResponse.json({ ok: true });
}
