import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

// Качает файл по ссылке из Blob во временный каталог и возвращает путь к
// локальной копии — ffprobe и ffmpeg работают с файлом на диске, а не со
// ссылкой. Каталог создаётся через mkdtemp в tmpdir(), тем же приёмом, что
// runProbe в lib/probe.ts: своя папка на каждый вызов, без коллизий имён
// между параллельными задачами и без ручной уборки — Vercel сам стирает
// /tmp между вызовами функции.
export async function downloadToTmp(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`не удалось скачать исходник (${res.status}): ${url}`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), "sub-src-"));
  // Расширение берём из ссылки, если оно есть, — ffprobe его не требует, но
  // так локальный файл легче узнать глазами при отладке. По умолчанию .mp4:
  // это самый частый формат экспорта с телефона.
  const ext = extname(new URL(url).pathname) || ".mp4";
  const path = join(dir, `source${ext}`);
  writeFileSync(path, bytes);
  return path;
}
