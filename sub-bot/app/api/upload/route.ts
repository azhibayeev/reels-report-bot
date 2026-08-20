import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { requireEnv } from "../../../lib/config";
import { verifyToken } from "../../../lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // Без этой проверки в наш Blob мог бы залить кто угодно.
        const claim = verifyToken(
          clientPayload ?? "",
          requireEnv("SUB_TOKEN_SECRET"),
          Date.now()
        );
        if (!claim) throw new Error("Ссылка просрочена — запроси новую через /sub");

        return {
          allowedContentTypes: ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm"],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ chatId: claim.chatId }),
        };
      },
      onUploadCompleted: async () => {
        // Задачу запускает страница через /api/sub/start — здесь делать нечего.
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
