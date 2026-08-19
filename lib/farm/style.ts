import { list, put } from "@vercel/blob";
import { DEFAULT_POSITION, HookPosition, isHookPosition } from "./types";

export const STYLE_PATH = "farm/state/style.json";

export async function saveDefaultPosition(position: HookPosition): Promise<void> {
  await put(STYLE_PATH, JSON.stringify({ position }), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

// /style — чисто косметическая настройка позиции хука. Любой сбой (файла нет,
// list/fetch упали, JSON битый, значение неизвестное) должен тихо откатываться
// к DEFAULT_POSITION, а не ронять ферму: рендер пачек не должен зависеть от
// доступности этого файла в Blob.
export async function loadDefaultPosition(): Promise<HookPosition> {
  try {
    const { blobs } = await list({ prefix: STYLE_PATH });
    const blob = blobs.find((b) => b.pathname === STYLE_PATH);
    if (!blob) return DEFAULT_POSITION;

    // Blob кэшируется на CDN — без cache-busting команда показывала бы
    // устаревшее значение сразу после сохранения нового.
    const res = await fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return DEFAULT_POSITION;

    const data = (await res.json()) as { position?: unknown };
    return isHookPosition(data.position) ? data.position : DEFAULT_POSITION;
  } catch {
    return DEFAULT_POSITION;
  }
}
