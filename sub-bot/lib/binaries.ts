import { createHash } from "node:crypto";
import { existsSync, createReadStream } from "node:fs";
import { join } from "node:path";

// SHA256 ассета ffmpeg-linux-x64 из релиза b6.1.1. Тег версию НЕ отражает:
// внутри ffmpeg 7.0.2 от johnvansickle. Именно от версии зависит набор
// фильтров (в 7.0 drawtext потребовал HarfBuzz и не собрался), поэтому
// сверяем файл по хешу, а не доверяем тегу.
export const FFMPEG_SHA256 =
  "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99";

// Имя семейства из name-таблицы (nameID 1) статического
// PlusJakartaSans-ExtraBold.ttf — ровно "Plus Jakarta Sans ExtraBold".
// Это же значение обязано стоять в поле Fontname стиля файла .ass (Task 5),
// иначе libass не найдёт начертание и молча отрисует Regular.
// Переменная окружения — явное переопределение оператора: возвращаем её как
// есть, даже если файл по этому пути ещё не существует (например, в тестах).
// Существование дефолтных кандидатов, наоборот, обязано подтверждаться —
// иначе firstExisting должен искать дальше и в итоге кинуть понятную ошибку.
function resolvePath(name: string, override: string | undefined, candidates: string[]): string {
  if (override) return override;
  for (const c of candidates) if (c && existsSync(c)) return c;
  throw new Error(`${name} не найден. Искал: ${candidates.filter(Boolean).join(", ")}`);
}

export function ffmpegPath(): string {
  let bundled = "";
  try {
    bundled = (require("ffmpeg-static") as string) || "";
  } catch {
    bundled = "";
  }
  // Дефолтный экспорт ffmpeg-static посчитан на сборке и в проде указывает
  // не туда — поэтому он последний кандидат, а не первый.
  return resolvePath("ffmpeg", process.env.SUB_FFMPEG_PATH, [
    join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
    bundled,
  ]);
}

export function ffprobePath(): string {
  // ffprobe-static не импортируем: у пакета нет типов, tsc падает на импорте.
  return resolvePath("ffprobe", process.env.SUB_FFPROBE_PATH, [
    join(
      process.cwd(),
      "node_modules",
      "ffprobe-static",
      "bin",
      process.platform,
      process.arch,
      "ffprobe"
    ),
  ]);
}

export function fontPath(): string {
  return resolvePath("шрифт", process.env.SUB_FONT_PATH, [
    join(process.cwd(), "assets", "PlusJakartaSans-ExtraBold.ttf"),
  ]);
}

export async function ffmpegHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

// Сверка хеша выполняется только на проде (линуксовый бинарник из
// ffmpeg-static). Локально на macOS сборка другая, и хеш намеренно не
// совпадёт с FFMPEG_SHA256 — это не повод его пересчитывать.
export async function assertFfmpegHash(path: string): Promise<void> {
  const actual = await ffmpegHash(path);
  if (actual !== FFMPEG_SHA256) {
    throw new Error(
      `ffmpeg по пути ${path} не прошёл проверку хеша: ожидали ${FFMPEG_SHA256}, получили ${actual}`
    );
  }
}
