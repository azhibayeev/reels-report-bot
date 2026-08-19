import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, constants, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { put } from "@vercel/blob";
import ffmpegStatic from "ffmpeg-static";
import { after, NextRequest, NextResponse } from "next/server";
import { deleteBlobQuiet, listItems, OUT_PREFIX, saveItem } from "../../../../lib/farm/store";
import { escapeHtml } from "../../../../lib/format";
import { sendMessage } from "../../../../lib/telegram";
import { sendVideoWithButtons } from "../../../../lib/farm/telegram";
import { requireEnv, runRenderTick, triggerRender } from "../../../../lib/farm/tick";
import { tickKey } from "../../../../lib/farm/tokens";
import { DEFAULT_POSITION, Item } from "../../../../lib/farm/types";
import { renderHook, Runner } from "../../../../lib/farm/render";
import { fitHook, HOOK_MAX_LINES } from "../../../../lib/farm/wrap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// ffmpeg-static отдаёт путь, посчитанный на сборке (в проде это /ROOT/...), а в
// собранной функции файл лежит относительно process.cwd(). Поэтому перебираем
// кандидатов и берём существующий; в сообщении об ошибке — весь список, иначе
// ENOENT не говорит вообще ничего.
function firstExisting(candidates: (string | undefined | null)[], what: string): string {
  const tried: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    tried.push(candidate);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`${what} не найден. Проверены пути: ${tried.join(", ")}`);
}

function ffmpegPath(): string {
  return firstExisting(
    [
      process.env.FARM_FFMPEG_PATH,
      join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
      ffmpegStatic,
    ],
    "бинарник ffmpeg"
  );
}

// ffprobe-static не типизирован (нет .d.ts и @types), поэтому путь до бинарника
// собираем сами, а не через `import ffprobeStatic from "ffprobe-static"" — иначе
// tsc падает на самом импорте. Каталог уже включён в трассировку в next.config.ts.
function ffprobePath(): string {
  return firstExisting(
    [
      process.env.FARM_FFPROBE_PATH,
      join(process.cwd(), "node_modules", "ffprobe-static", "bin", process.platform, process.arch, "ffprobe"),
    ],
    "бинарник ffprobe"
  );
}

function fontPath(): string {
  return firstExisting(
    [process.env.FARM_FONT_PATH, join(process.cwd(), "assets", "hook.ttf")],
    "шрифт хука"
  );
}

// Копим stderr с потолком: болтливый ffmpeg способен насыпать мегабайты,
// а нам для диагностики хватает хвоста.
const STDERR_CAP = 8000;

const runner: Runner = (bin, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_CAP);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });

async function probeHasAudio(sourcePath: string, ffprobeBin: string): Promise<boolean> {
  try {
    const { code, stdout } = await new Promise<{ code: number; stdout: string }>((resolve, reject) => {
      const child = spawn(
        ffprobeBin,
        ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", sourcePath],
        { stdio: ["ignore", "pipe", "ignore"] }
      );
      let stdout = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? -1, stdout }));
    });
    // Ложный false подмешал бы тишину вторым входом и вырезал настоящий звук —
    // безопаснее ошибиться в сторону «звук есть» и просто не получить дорожку.
    if (code !== 0) return true;
    return stdout.includes("audio");
  } catch {
    return true;
  }
}

async function renderItem(item: Item): Promise<string> {
  // Инструменты проверяем ДО скачивания исходника. Иначе каждая пачка при
  // сломанной сборке качает по сотне мегабайт на ролик и падает уже после —
  // шестьдесят таких провалов сожгли пять гигабайт трафика Blob за минуты и
  // довели хранилище до приостановки. Проверка стоит миллисекунды.
  const ffmpeg = ffmpegPath();
  const ffprobe = ffprobePath();
  const font = fontPath();

  const dir = await mkdtemp(join(tmpdir(), "farm-"));
  try {
    const sourcePath = join(dir, "src.mp4");
    const res = await fetch(item.sourceUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`Исходник не скачался (${res.status}): ${item.sourceUrl}`);
    await writeFile(sourcePath, Buffer.from(await res.arrayBuffer()));

    const fitted = fitHook(item.hook);
    if (!fitted) throw new Error(`хук слишком длинный: не помещается в ${HOOK_MAX_LINES} строки`);
    const lines = fitted.lines;

    const hasAudio = await probeHasAudio(sourcePath, ffprobe);

    // Дорожку тянем тем же способом, что подложку. Не скачалась — не повод
    // терять ролик: соберём его со звуком подложки и скажем об этом в логах.
    let musicPath: string | null = null;
    if (item.musicUrl) {
      try {
        const music = await fetch(item.musicUrl, { cache: "no-store" });
        if (!music.ok) throw new Error(`статус ${music.status}`);
        musicPath = join(dir, "music.m4a");
        await writeFile(musicPath, Buffer.from(await music.arrayBuffer()));
      } catch (error) {
        console.error("farm music download failed", item.itemId, error);
        musicPath = null;
      }
    }
    const outPath = join(dir, "out.mp4");
    const textPaths = lines.map((_, i) => join(dir, `hook-${i}.txt`));

    await renderHook(
      {
        sourcePath,
        textPaths,
        outPath,
        fontPath: font,
        hookLines: lines,
        hasAudio,
        position: item.position ?? DEFAULT_POSITION,
        musicPath,
        seconds: item.seconds,
        fontSize: fitted.fontSize,
      },
      {
        runner,
        writeText: (p, t) => writeFile(p, t, "utf8"),
        ffmpegPath: ffmpeg,
        fontReadable: async (p) => {
          try {
            await access(p, constants.R_OK);
            return true;
          } catch {
            return false;
          }
        },
      }
    );

    const blob = await put(`${OUT_PREFIX}${item.itemId}.mp4`, await readFile(outPath), {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return blob.url;
  } finally {
    // Иначе /tmp функции забьётся между вызовами одной цепочки.
    await rm(dir, { recursive: true, force: true });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const batchId = req.nextUrl.searchParams.get("batch") ?? "";
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!batchId || key !== tickKey(`render:${batchId}`, requireEnv("FARM_TOKEN_SECRET"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const deps = {
    now: () => Date.now(),
    listItems,
    saveItem,
    renderItem,
    sendVideoWithButtons,
    deleteBlobQuiet,
    notify: (text: string, threadId: number | null, chatId?: number) =>
      // Чат берём из задачи: пачку могли завести в личке, и сыпать ошибками в
      // общую группу — это шум для всех и молчание для того, кто её загрузил.
      sendMessage(escapeHtml(text), { thread: threadId, ...(chatId ? { chat: chatId } : {}) }),
    triggerRender,
  };

  // Отвечаем сразу, а рендер крутим после ответа: вызывающая сторона не должна
  // висеть все четыре минуты.
  after(() => runRenderTick(batchId, deps).catch((error) => console.error("render tick failed", batchId, error)));
  return NextResponse.json({ ok: true }, { status: 202 });
}
