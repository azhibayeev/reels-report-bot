import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { MAX_FILE_BYTES } from "../../../../lib/farm/start";
import { SOURCES_PREFIX } from "../../../../lib/farm/store";
import { verifyBatchToken } from "../../../../lib/farm/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requireSecret(): string {
  const secret = process.env.FARM_TOKEN_SECRET;
  if (!secret) throw new Error("FARM_TOKEN_SECRET is not set");
  return secret;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Без этой проверки в наш Blob мог бы залить кто угодно.
        const claim = verifyBatchToken(clientPayload ?? "", requireSecret(), Date.now());
        if (!claim) throw new Error("Ссылка просрочена — запроси новую через /batch");

        // Иначе по валидной ссылке можно затирать чужие пути в хранилище.
        if (!pathname.startsWith(SOURCES_PREFIX)) {
          throw new Error("Файл должен грузиться в farm/sources/");
        }

        return {
          allowedContentTypes: ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm"],
          addRandomSuffix: true,
          maximumSizeInBytes: MAX_FILE_BYTES,
        };
      },
      onUploadCompleted: async () => {
        // Задачи создаёт страница через /api/farm/start — здесь делать нечего.
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
