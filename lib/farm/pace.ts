import { list, put } from "@vercel/blob";
import { SlotConfig, slotConfigFromEnv, slotsPerDay } from "./slots";

/**
 * Темп заливки — единственный руль расписания.
 *
 * До 25.08.2026 темп задавали три связанных числа: час старта, зазор и «сколько
 * в сутки». Независимыми они не были, и лишнее число мешало: сменить зазор, не
 * пересчитав его, значило получить сетку, которая не совпадает ни с чем. Здесь
 * остаётся зазор, а число в сутки выводится из окна.
 *
 * Крутит руль сама ферма. Instagram отвечает на слишком частые публикации
 * блоком «User is performing too many actions», и единственный способ узнать
 * потолок аккаунта — подходить к нему снизу: блок сбавляет темп сразу, чистая
 * серия прибавляет понемногу.
 */
export const PACE_PATH = "farm/state/pace.json";

// Быстрее 90 минут (14 в сутки) аккаунт не выдерживал никогда. Медленнее 240
// (5 в сутки) сбавлять бессмысленно: если и там блок, дело не в частоте, и
// разбираться должен человек.
export const PACE_MIN_MINUTES = 90;
export const PACE_MAX_MINUTES = 240;

// Двенадцать публикаций — это около двух суток на стартовом зазоре, поэтому
// отдельная выдержка по времени не нужна: счётчик публикаций сам и есть время.
// Считаем именно публикации, а не календарь: пустая очередь двое суток ничего
// не доказывает про безопасность темпа.
export const CLEAN_RUN = 12;

export const MIN_SLOT_MINUTES = 15;
export const MAX_PER_DAY = 40;

// Пресеты — это стартовые зазоры, от которых ферма пляшет дальше сама. Прежние
// (30/45/90 минут) на этом аккаунте гарантированно приводят к блоку, поэтому
// имена сохранены, а числа переопределены.
export const RHYTHM_PRESETS: Record<string, number> = {
  плотно: 120,
  обычно: 180,
  спокойно: 240,
};

export type PaceReason = "manual" | "block" | "clean";

const REASONS = new Set<string>(["manual", "block", "clean"]);

export interface Pace {
  /** Зазор между публикациями в минутах. */
  minutes: number;
  /** Когда темп менялся в последний раз. */
  changedAt: string;
  /** Успешных публикаций с последней смены — на нём растёт скорость. */
  publishedSince: number;
  /** Кто крутил руль: человек, блок или чистая серия. */
  reason: PaceReason;
}

export function isPace(value: unknown): value is Pace {
  if (!value || typeof value !== "object") return false;
  const { minutes, changedAt, publishedSince, reason } = value as Partial<Pace>;
  return (
    typeof minutes === "number" &&
    Number.isFinite(minutes) &&
    minutes >= MIN_SLOT_MINUTES &&
    typeof changedAt === "string" &&
    typeof publishedSince === "number" &&
    Number.isFinite(publishedSince) &&
    publishedSince >= 0 &&
    typeof reason === "string" &&
    REASONS.has(reason)
  );
}

/** Зазор в 163 минуты человек не прочитает, поэтому держим шаг в пять минут. */
export function roundTo5(minutes: number): number {
  return Math.max(5, Math.round(minutes / 5) * 5);
}

export function manualPace(minutes: number, nowMs: number): Pace {
  return {
    minutes,
    changedAt: new Date(nowMs).toISOString(),
    publishedSince: 0,
    reason: "manual",
  };
}

export function defaultPace(nowMs: number): Pace {
  return manualPace(slotConfigFromEnv().minutes, nowMs);
}

/**
 * Блок — дорогой сигнал, реагируем сразу и крупно.
 *
 * `atLimit` отличает «сбавили» от «сбавлять больше некуда»: второе значит, что
 * причина не в частоте, и в чат надо написать другое.
 */
export function afterBlock(pace: Pace, nowMs: number): { pace: Pace; slowed: boolean; atLimit: boolean } {
  const minutes = Math.min(PACE_MAX_MINUTES, roundTo5((pace.minutes * 4) / 3));
  const slowed = minutes > pace.minutes;
  return {
    pace: {
      minutes,
      changedAt: slowed ? new Date(nowMs).toISOString() : pace.changedAt,
      // Счётчик обнуляем в любом случае: серия прервана блоком, даже если зазор
      // уже упёрся в потолок и не изменился.
      publishedSince: 0,
      reason: slowed ? "block" : pace.reason,
    },
    slowed,
    atLimit: !slowed,
  };
}

/**
 * Чистая серия — слабый сигнал, прибавляем понемногу и только по факту залитых
 * роликов.
 */
export function afterPublish(pace: Pace, nowMs: number): { pace: Pace; sped: boolean } {
  const publishedSince = pace.publishedSince + 1;
  if (publishedSince < CLEAN_RUN) return { pace: { ...pace, publishedSince }, sped: false };

  const minutes = Math.max(PACE_MIN_MINUTES, roundTo5(pace.minutes * 0.9));
  const sped = minutes < pace.minutes;
  return {
    // Счётчик обнуляем и на полу тоже: иначе каждая следующая публикация снова
    // просилась бы ускоряться и слала бы в чат сообщение о темпе, который не
    // менялся.
    pace: sped
      ? { minutes, changedAt: new Date(nowMs).toISOString(), publishedSince: 0, reason: "clean" }
      : { ...pace, publishedSince: 0 },
    sped,
  };
}

/** Сетка слотов по темпу: число в сутки выводится, а не хранится. */
export function paceSlotConfig(pace: Pace | null): SlotConfig {
  const env = slotConfigFromEnv();
  if (!pace) return env;
  return {
    ...env,
    minutes: pace.minutes,
    perDay: Math.min(MAX_PER_DAY, slotsPerDay(env.startHHMM, env.endHHMM, pace.minutes)),
  };
}

/** Текст темпа для чата: «ролик раз в 2 ч 40 мин (8 в сутки)». */
export function describePace(pace: Pace): string {
  const hours = Math.floor(pace.minutes / 60);
  const minutes = pace.minutes % 60;
  const every = hours > 0 ? (minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`) : `${minutes} мин`;
  return `ролик раз в ${every} (${paceSlotConfig(pace).perDay} в сутки)`;
}

export async function savePace(pace: Pace): Promise<void> {
  await put(PACE_PATH, JSON.stringify(pace), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

/**
 * Темп из состояния. Любой сбой чтения — это «темпа нет»: остановить заливку
 * из-за недоступного Blob хуже, чем один раз сходить в Instagram не по тому
 * расписанию.
 */
export async function loadPace(): Promise<Pace | null> {
  try {
    const { blobs } = await list({ prefix: PACE_PATH });
    const blob = blobs.find((b) => b.pathname === PACE_PATH);
    if (!blob) return null;
    // Blob кэшируется на CDN: без cache-busting заливка ещё минуту работала бы
    // по темпу, который только что сменили.
    const res = await fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isPace(data) ? data : null;
  } catch (error) {
    console.error("farm pace: темп не прочитался", error);
    return null;
  }
}
