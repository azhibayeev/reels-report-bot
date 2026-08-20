import { NextRequest, NextResponse } from "next/server";
import { runProbe } from "../../../lib/probe";
import { tickKey } from "../../../lib/tokens";
import { requireEnv } from "../../../lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Проверка среды перед первым настоящим роликом: жив ли libass, нашёлся ли
// шрифт, тот ли ffmpeg. Ключ через tickKey("probe", ...) — та же схема
// само-вызова, что и у обработки задачи: эндпоинт не должен быть открыт
// анонимному запросу, но и отдельный секрет под него заводить незачем.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (key !== tickKey("probe", requireEnv("SUB_TOKEN_SECRET"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Кадр в base64 распухает ответ — отдаём только когда его явно просят.
  const wantFrame = req.nextUrl.searchParams.get("frame") === "1";
  const report = await runProbe();
  return NextResponse.json(wantFrame ? report : { ...report, frameBase64: null });
}
