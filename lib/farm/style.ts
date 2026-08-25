import { list, put } from "@vercel/blob";
import { DEFAULT_POSITION, HookPosition, isHookPosition } from "./types";

export const STYLE_PATH = "farm/state/style.json";

// Темп выпуска живёт отдельно (lib/farm/pace.ts): его пишет машина после каждой
// публикации, а этот файл — человек. Общий файл означал бы read-modify-write
// гонку между заливкой и командой /style.
async function writeSettings(settings: { position: HookPosition }): Promise<void> {
  await put(STYLE_PATH, JSON.stringify(settings), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function saveDefaultPosition(position: HookPosition): Promise<void> {
  await put(STYLE_PATH, JSON.stringify({ position }), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

// Любой сбой чтения (файла нет, list/fetch упали, JSON битый) — это не повод
// ронять ферму: настройки косметические, рендер и заливка не должны зависеть от
// доступности этого файла в Blob.
async function readSettings(): Promise<{ position?: unknown } | null> {
  try {
    const { blobs } = await list({ prefix: STYLE_PATH });
    const blob = blobs.find((b) => b.pathname === STYLE_PATH);
    if (!blob) return null;

    // Blob кэшируется на CDN — без cache-busting команда показывала бы
    // устаревшее значение сразу после сохранения нового.
    const res = await fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as { position?: unknown };
  } catch {
    return null;
  }
}

export async function loadDefaultPosition(): Promise<HookPosition> {
  const data = await readSettings();
  return isHookPosition(data?.position) ? data.position : DEFAULT_POSITION;
}
