import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { ask } from "../../../../lib/dub/bot";
import { uploadSecret, verifyUploadToken } from "../../../../lib/dub/tokens";
import { ALLOWED_CONTENT_TYPES, MAX_UPLOAD_BYTES, SOURCES_PREFIX } from "../../../../lib/dub/uploads";
import { deleteBlobQuiet } from "../../../../lib/dub/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Обход лимита Telegram в 20 МБ: файл идёт из браузера прямо в Blob, а сюда
// приходят только два коротких запроса — за токеном и с уведомлением о заливке.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Без этой проверки в наш Blob мог бы залить кто угодно.
        const claim = verifyUploadToken(clientPayload ?? "", uploadSecret(), Date.now());
        if (!claim) throw new Error("Ссылка просрочена — пришли ролик боту ещё раз, он выдаст новую");

        // Иначе по валидной ссылке можно затирать чужие пути в хранилище.
        if (!pathname.startsWith(SOURCES_PREFIX)) {
          throw new Error(`Файл должен грузиться в ${SOURCES_PREFIX}`);
        }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          addRandomSuffix: true,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          // Чат едет в подписанном токене Blob: onUploadCompleted зовёт сам Vercel
          // своим запросом, и другого способа узнать, кому отвечать, у него нет.
          tokenPayload: JSON.stringify(claim),
        };
      },

      // Локально не сработает: Vercel Blob стучится сюда извне и до localhost не
      // достучится. На проде это единственная точка, где заводится задача.
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const claim = verifyPayload(tokenPayload);
        if (!claim) {
          console.error(`dub: заливка ${blob.pathname} без разбираемого tokenPayload`);
          await deleteBlobQuiet(blob.url);
          return;
        }

        const filename = blob.pathname.split("/").pop() || "video.mp4";
        try {
          // Тот же вопрос про субтитры, что и на лёгком ролике: путь до бота
          // разный, а дальше конвейер один.
          await ask(claim.chatId, claim.messageId, {
            filename,
            sourceUrl: blob.url,
            blobUrl: blob.url,
          });
        } catch (e) {
          // Спросить не вышло — значит за файлом больше некому прийти, и сотня
          // мегабайт осталась бы в Blob навсегда.
          console.error(`dub: заливка ${blob.pathname} — ${e instanceof Error ? e.stack : e}`);
          await deleteBlobQuiet(blob.url);
        }
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

function verifyPayload(tokenPayload: string | null | undefined): { chatId: number; messageId: number } | null {
  if (!tokenPayload) return null;
  try {
    const parsed = JSON.parse(tokenPayload) as { chatId?: unknown; messageId?: unknown };
    if (typeof parsed.chatId !== "number" || typeof parsed.messageId !== "number") return null;
    return { chatId: parsed.chatId, messageId: parsed.messageId };
  } catch {
    return null;
  }
}
