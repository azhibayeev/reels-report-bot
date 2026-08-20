import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { requireEnv } from "../../../../lib/config";
import { renderCueList } from "../../../../lib/commands";
import { saveJob } from "../../../../lib/jobs";
import { probeMedia } from "../../../../lib/media";
import { runPipeline } from "../../../../lib/pipeline";
import { spawnRunner } from "../../../../lib/proc";
import { transcribe } from "../../../../lib/scribe";
import { startJob } from "../../../../lib/start";
import { downloadToTmp } from "../../../../lib/storage";
import { sendMessage } from "../../../../lib/telegram";
import { translateCues } from "../../../../lib/translate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Файл уже целиком лежит в Blob (страница загрузки закончила multipart-заливку
// до этого запроса) — здесь заводится задача и запускается остальной конвейер:
// распознавание речи → сборка реплик → перевод → статус "awaiting" с текстом
// в чате. startJob (lib/start.ts) уже проверяет токен и владение файлом —
// повторять эти проверки здесь незачем.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as { token: string; blobUrl: string; durationSec: number };

  let started: Awaited<ReturnType<typeof startJob>>;
  try {
    started = await startJob(body);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  // Ответ Telegram/браузеру уходит сразу же (202): дальше обработка идёт в
  // after() — конвейер может занимать десятки секунд (Scribe + перевод), а
  // клиент ждать это не должен.
  after(async () => {
    try {
      const done = await runPipeline(
        {
          probe: (path) => probeMedia(spawnRunner, path),
          download: downloadToTmp,
          transcribe: (sourceUrl) => transcribe(requireEnv("ELEVENLABS_API_KEY"), sourceUrl),
          translate: (cues) => translateCues(requireEnv("OPENAI_API_KEY"), cues),
          save: saveJob,
        },
        started.job
      );

      const botToken = requireEnv("TELEGRAM_SUB_BOT_TOKEN");
      await sendMessage(
        botToken,
        done.chatId,
        done.status === "failed" ? `Не вышло: ${done.error}` : renderCueList(done)
      );
    } catch (error) {
      // runPipeline сама ошибку не бросает (она заворачивает любой сбой в
      // статус "failed" и сохраняет задачу) — сюда долетит разве что
      // requireEnv на отсутствующей переменной или упавший sendMessage.
      // Ответ на POST уже отправлен, вернуть ошибку некому — логируем.
      console.error("sub/start: конвейер не отчитался в чат", started.jobId, error);
    }
  });

  return NextResponse.json({ ok: true, jobId: started.jobId }, { status: 202 });
}
