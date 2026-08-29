import { spawn } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { ffmpegPath, ffprobePath, fontPath } from "../../../../lib/binaries";
import { burnSubtitles, RunResult } from "../../../../lib/dub/burn";
import { livePollDeps, pollJobs } from "../../../../lib/dub/deliver";
import { getTranscript } from "../../../../lib/dub/elevenlabs";

// Скачать готовый дубляж из ElevenLabs, вжечь субтитры и выгрузить в Telegram —
// до 50 МБ в обе стороны плюс перекодирование, поэтому проходу нужен полный бюджет.
export const maxDuration = 300;

// Копим вывод с потолком: болтливый ffmpeg способен насыпать мегабайты,
// а для диагностики хватает хвоста.
const OUTPUT_CAP = 8000;

function run(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => {
      stdout = (stdout + c.toString()).slice(-OUTPUT_CAP);
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr = (stderr + c.toString()).slice(-OUTPUT_CAP);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await pollJobs({
    ...livePollDeps(),
    // Пути до бинарников ищем внутри вызова, а не при сборке зависимостей:
    // ненайденный ffmpeg должен стоить субтитров, а не всего прохода.
    burnSubtitles: (video, dubbingId) =>
      burnSubtitles(video, dubbingId, {
        run,
        ffmpegPath: ffmpegPath(),
        ffprobePath: ffprobePath(),
        fontPath: fontPath(),
        getTranscript,
      }),
  });

  if (result.checked) console.log(`dub: проверено ${result.checked}, отдано ${result.delivered}, сбоев ${result.failed}`);
  return NextResponse.json({ ok: true, ...result });
}
