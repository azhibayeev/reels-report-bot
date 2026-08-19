import { list, put } from "@vercel/blob";
import { DEFAULT_POSITION, HookPosition, isHookPosition } from "./types";

export const STYLE_PATH = "farm/state/style.json";

/** Регулярность выпуска: интервал между слотами и сколько роликов в день. */
export interface Rhythm {
  minutes: number;
  perDay: number;
}

export const RHYTHM_PRESETS: Record<string, Rhythm> = {
  // Плотно — для маленькой пачки: восемь роликов незачем растягивать на сутки.
  плотно: { minutes: 30, perDay: 20 },
  обычно: { minutes: 45, perDay: 15 },
  // Спокойно — когда аккаунт греется или пачка большая и спешить некуда.
  спокойно: { minutes: 90, perDay: 8 },
};

export const MIN_SLOT_MINUTES = 15;
export const MAX_PER_DAY = 40;

export function isRhythm(value: unknown): value is Rhythm {
  if (!value || typeof value !== "object") return false;
  const { minutes, perDay } = value as Partial<Rhythm>;
  return (
    typeof minutes === "number" &&
    Number.isFinite(minutes) &&
    minutes >= MIN_SLOT_MINUTES &&
    typeof perDay === "number" &&
    Number.isFinite(perDay) &&
    perDay >= 1 &&
    perDay <= MAX_PER_DAY
  );
}

// Пишем настройки целиком: файл общий для позиции и регулярности, и запись
// одного поля не должна стирать другое.
async function writeSettings(settings: { position: HookPosition; rhythm?: Rhythm }): Promise<void> {
  await put(STYLE_PATH, JSON.stringify(settings), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function saveRhythm(rhythm: Rhythm): Promise<void> {
  await writeSettings({ position: await loadDefaultPosition(), rhythm });
}

/** Регулярность из состояния; нет её — берём из переменных окружения. */
export async function loadRhythm(): Promise<Rhythm | null> {
  const data = await readSettings();
  return isRhythm(data?.rhythm) ? data.rhythm : null;
}

export async function saveDefaultPosition(position: HookPosition): Promise<void> {
  const current = await loadRhythm();
  await put(STYLE_PATH, JSON.stringify(current ? { position, rhythm: current } : { position }), {
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
async function readSettings(): Promise<{ position?: unknown; rhythm?: unknown } | null> {
  try {
    const { blobs } = await list({ prefix: STYLE_PATH });
    const blob = blobs.find((b) => b.pathname === STYLE_PATH);
    if (!blob) return null;

    // Blob кэшируется на CDN — без cache-busting команда показывала бы
    // устаревшее значение сразу после сохранения нового.
    const res = await fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as { position?: unknown; rhythm?: unknown };
  } catch {
    return null;
  }
}

export async function loadDefaultPosition(): Promise<HookPosition> {
  const data = await readSettings();
  return isHookPosition(data?.position) ? data.position : DEFAULT_POSITION;
}
