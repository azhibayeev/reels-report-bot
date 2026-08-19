import crypto from "node:crypto";
import { head } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import {
  assignSources,
  HookGroup,
  interleave,
  MAX_FILES,
  startBatch,
  UploadedFile,
  validateGroups,
} from "../../../../lib/farm/start";
import { deleteBlobQuiet, saveBatch, saveItem, SOURCES_PREFIX } from "../../../../lib/farm/store";
import { triggerRender } from "../../../../lib/farm/tick";
import { verifyBatchToken } from "../../../../lib/farm/tokens";
import { DEFAULT_POSITION, HookPosition, isHookPosition } from "../../../../lib/farm/types";
import { sendMessage } from "../../../../lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function requireSecret(): string {
  const secret = process.env.FARM_TOKEN_SECRET;
  if (!secret) throw new Error("FARM_TOKEN_SECRET is not set");
  return secret;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    token?: string;
    files?: { url: string; bytes: number }[];
    groups?: { hooks?: string[]; caption?: string; musicUrl?: string | null }[];
    position?: string;
  };
  if (!body.token || !Array.isArray(body.files)) {
    return NextResponse.json({ error: "token и files обязательны" }, { status: 400 });
  }

  // Клиенту верить нельзя ровно так же, как в размере файла: значение уедет в
  // имя фильтра ffmpeg, так что любая строка кроме трёх известных — дефолт.
  const position: HookPosition = isHookPosition(body.position) ? body.position : DEFAULT_POSITION;

  // До этой проверки ничего в хранилище не удаляем: удаление по ссылке из
  // неавторизованного запроса — дыра.
  const claim = verifyBatchToken(body.token, requireSecret(), Date.now());
  if (!claim) {
    return NextResponse.json(
      { error: "Ссылка просрочена — запроси новую через /batch" },
      { status: 400 }
    );
  }

  // Отсечка до первого head(): без неё тысяча url в запросе превращается в
  // тысячу сетевых вызовов и упирается в maxDuration = 60.
  if (body.files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `файлов ${body.files.length}, лимит ${MAX_FILES}` },
      { status: 400 }
    );
  }

  const checked: UploadedFile[] = [];
  // Удаляем только то, что уже прошло проверку хоста/head()/префикса и попало
  // в checked — непроверенный url из тела запроса удалять нельзя, это дыра.
  const cleanup = async () => {
    for (const f of checked) await deleteBlobQuiet(f.url);
  };
  for (const file of body.files) {
    if (!/^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//.test(file.url)) {
      await cleanup();
      return NextResponse.json({ error: "Ссылка на файл не из нашего хранилища" }, { status: 400 });
    }
    let info;
    try {
      info = await head(file.url);
    } catch {
      await cleanup();
      return NextResponse.json({ error: "Файл не найден в хранилище" }, { status: 400 });
    }
    if (!info.pathname.startsWith(SOURCES_PREFIX)) {
      await cleanup();
      return NextResponse.json({ error: "Файл не в farm/sources/" }, { status: 400 });
    }
    // Размер берём из head, а не из клиентского bytes: клиенту в этом вопросе
    // верить нельзя, лимит 60 МБ иначе обходится подделкой числа.
    checked.push({ url: file.url, bytes: info.size });
  }

  let chainFailed = false;
  let total: number;
  try {
    const groups: HookGroup[] = (body.groups ?? []).map((g) => ({
      hooks: (g.hooks ?? []).map((h) => h.trim()).filter(Boolean),
      caption: (g.caption ?? "").trim(),
      // Дорожку принимаем только из нашего хранилища: ссылка уедет в ffmpeg,
      // и чужой url означал бы скачивание произвольного файла нашей функцией.
      musicUrl:
        g.musicUrl && /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//.test(g.musicUrl)
          ? g.musicUrl
          : null,
    }));
    const errors = validateGroups(groups, checked);
    if (errors.length) throw new Error(errors.join("; "));

    // Раздаём подложки по кругу, затем перемешиваем порядок публикации: иначе
    // все ролики одной группы ушли бы в ленту подряд.
    const { pairs, sources } = interleave(assignSources(groups, checked));

    ({ total } = await startBatch(
      { chatId: claim.chatId, threadId: claim.threadId, pairs, files: sources, position },
      {
        saveItem,
        saveBatch,
        deleteBlobQuiet,
        now: () => new Date(),
        newId: () => crypto.randomUUID(),
        triggerRender: async (id: string) => {
          try {
            await triggerRender(id);
          } catch (error) {
            // Пачка уже создана: ронять запрос из-за неудавшегося пинка нельзя, цепочку
            // добьёт /reels.
            console.error("triggerRender failed", id, error);
            chainFailed = true;
          }
        },
      }
    ));
  } catch (error) {
    await cleanup();
    return NextResponse.json(
      {
        error: `${(error as Error).message}. Файлы удалены, загрузите пачку заново.`,
      },
      { status: 400 }
    );
  }

  const chainNote = chainFailed
    ? "\nЦепочка рендера не стартовала — пни её командой /reels."
    : "";
  try {
    await sendMessage(`Взял пачку: ${total} роликов. Пришлю по одному с кнопками.${chainNote}`, {
      thread: claim.threadId,
    });
  } catch (error) {
    // Пачка уже создана и рендерится: молчание в чате — не повод удалять исходники.
    console.error("farm start notify failed", error);
  }
  return NextResponse.json({ ok: true, total });
}
