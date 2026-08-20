import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { fontPath } from "../../../../lib/binaries";
import { requireEnv } from "../../../../lib/config";
import { blockingWarnings } from "../../../../lib/commands";
import { RenderDeps, runRender } from "../../../../lib/deliver";
import { Job, loadJob, saveJob } from "../../../../lib/jobs";
import { fontFamily as readFontFamily } from "../../../../lib/probe";
import { spawnRunner } from "../../../../lib/proc";
import { renderSubs } from "../../../../lib/render";
import { Download, downloadToTmp } from "../../../../lib/storage";
import { sendMessage, sendVideoByUrl, sendVideoUpload } from "../../../../lib/telegram";
import { tickKey } from "../../../../lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Дефолт 300 с на 61-секундном ролике с высоким битрейтом может не хватить —
// план Pro позволяет поднять потолок, память тоже поднята в vercel.json.
export const maxDuration = 800;

const DONE_CAPTION = "Готово! Индонезийские субтитры вшиты.";

function blobCaption(url: string): string {
  return [
    "Ролик готов, но весит больше 50 МБ — через бота такое не проходит.",
    `Ссылка на файл: ${url}`,
    "Ссылка живёт сутки: после суточной уборки файл удаляется, и ссылка перестанет открываться (вернёт 404).",
  ].join("\n");
}

// Вшивает субтитры в утверждённое видео и доставляет результат в Telegram.
// Ключ через tickKey(jobId, ...) — та же схема само-вызова, что у /api/probe:
// эндпоинт дёргает сам себя (webhook на /ok в Task 14), наружу не открыт.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const jobId = req.nextUrl.searchParams.get("jobId") ?? "";
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!jobId || key !== tickKey(jobId, requireEnv("SUB_TOKEN_SECRET"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const job = await loadJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "задача не найдена" }, { status: 404 });
  }

  // Задача уже не ждёт рендера — либо повторный /ok, либо обработка уже идёт
  // или закончилась. runRender сам защищён этой же проверкой, но здесь она
  // экономит холостой mkdtemp/скачивание исходника.
  if (job.status !== "awaiting") {
    return NextResponse.json({ ok: true, jobId, skipped: true }, { status: 202 });
  }

  // Ответ уходит сразу же (202): ffmpeg на минутном ролике с высоким
  // битрейтом может занимать минуты, клиент (наш же webhook) ждать это не
  // должен.
  after(async () => {
    let download: Download | null = null;
    // Путь к готовому файлу нужен и upload() (заливка в Blob), и deliver()
    // (прямая отправка байтов в Telegram веткой multipart) — deliver() из
    // контракта lib/deliver.ts получает только итоговую ссылку, не путь на
    // диске, поэтому путь ловится замыканием в момент upload().
    let localOutPath: string | null = null;

    const deps: RenderDeps = {
      download: async (url) => {
        download = await downloadToTmp(url);
        return download.path;
      },
      // Третий параметр (имя семейства шрифта) уже вплетён в текст .ass
      // функцией buildAss в lib/deliver.ts — здесь он не нужен повторно.
      render: async (srcPath, ass) => {
        const dir = dirname(srcPath);
        const assPath = join(dir, "cues.ass");
        writeFileSync(assPath, ass, "utf8");
        const outPath = join(dir, "out.mp4");
        await renderSubs(spawnRunner, {
          srcPath,
          assPath,
          fontsDir: dirname(fontPath()),
          outPath,
          preset: "veryfast",
        });
        // ffmpeg вернул управление, результат уже на диске рядом — исходник
        // удаляем сразу, не дожидаясь конца доставки: на /tmp всего 500 МБ
        // на функцию, и оба файла разом (исходник + результат) на минутном
        // ролике с высоким битрейтом рискуют этот потолок пробить.
        rmSync(srcPath, { force: true });
        return outPath;
      },
      upload: async (path, id) => {
        localOutPath = path;
        const bytes = readFileSync(path);
        const blob = await put(`sub/results/${id}.mp4`, bytes, {
          access: "public",
          contentType: "video/mp4",
          addRandomSuffix: false,
          allowOverwrite: true,
        });
        return blob.url;
      },
      size: async (path) => statSync(path).size,
      deliver: async (j, url, mode) => {
        const token = requireEnv("TELEGRAM_SUB_BOT_TOKEN");
        if (mode === "link") {
          await sendVideoByUrl(token, j.chatId, url, DONE_CAPTION);
        } else if (mode === "multipart") {
          if (!localOutPath) throw new Error("нет локального файла для отправки в Telegram");
          const bytes = readFileSync(localOutPath);
          await sendVideoUpload(token, j.chatId, bytes, `${j.jobId}.mp4`, DONE_CAPTION);
        } else {
          await sendMessage(token, j.chatId, blobCaption(url));
        }
      },
      save: saveJob,
      cleanup: async () => {
        download?.dispose();
      },
      fontFamily: readFontFamily(fontPath()),
    };

    let done: Job;
    try {
      done = await runRender(deps, job);
    } catch (error) {
      // runRender сама не бросает (любой сбой заворачивается в статус
      // "failed") — сюда долетит разве что ошибка до входа в try/catch
      // самого runRender (например, saveJob на переходе в "rendering").
      console.error("sub/render: runRender упал необработанным", jobId, error);
      return;
    }

    try {
      const token = requireEnv("TELEGRAM_SUB_BOT_TOKEN");
      if (done.status === "awaiting") {
        // Блокирующие предупреждения остановили рендер — сообщаем, что
        // именно поправить, тем же списком, что использует blockingWarnings.
        const blocking = blockingWarnings(done.cues);
        await sendMessage(
          token,
          done.chatId,
          `Сначала поправь реплики: ${blocking.join(", ")}. Пиши «номер новый текст», затем снова /ok.`
        );
      } else if (done.status === "failed") {
        // Падение ffmpeg (или любой другой шаг) — не молчать, в чат уходит
        // причина с хвостом stderr (см. lib/render.ts: renderSubs кладёт его
        // в текст исключения).
        await sendMessage(token, done.chatId, `Рендер сорвался: ${done.error}`);
      }
      // done.status === "done" уже уведомлён внутри deliver() выше — видео
      // или ссылка на него.
    } catch (error) {
      console.error("sub/render: не удалось отчитаться в чат", jobId, error);
    }
  });

  return NextResponse.json({ ok: true, jobId }, { status: 202 });
}
