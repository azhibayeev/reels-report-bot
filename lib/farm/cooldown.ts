import { list, put } from "@vercel/blob";

/**
 * Пауза заливки, объявленная самим Instagram.
 *
 * «User is performing too many actions» (HTTP 400, код 9) — это не про ролик и
 * не про разовый сбой Graph: аккаунт целиком получил ограничение по частоте
 * действий и держит его часами. 21.08.2026 на проде это стоило шести роликов
 * подряд — каждый приходил в свой слот, получал тот же отказ и уходил в failed,
 * а /retry сознательно не поднимает упавших на публикации.
 *
 * Отсюда общее состояние, а не решение по каждому ролику: первый же такой отказ
 * останавливает всю заливку до конца паузы. Ролики при этом остаются в очереди.
 *
 * Пауза растёт от повторов. Возвращаться через тот же час в неснятый блок —
 * значит биться о ту же стену и продлевать её: Instagram считает и отвергнутые
 * попытки тоже.
 */
export const COOLDOWN_PATH = "farm/state/cooldown.json";

export interface Cooldown {
  /** До какого момента заливка стоит. */
  until: string;
  /** Когда влетели в блок: по нему видно, продолжение это серии или новая. */
  since: string;
  /** Сколько блоков подряд — по нему растёт следующая пауза. */
  strikes: number;
  /** Дословный отказ Graph: человек в чате должен видеть, за что именно. */
  reason: string;
}

// Час, два, четыре, восемь. Первый шаг короткий не из оптимизма, а из цены
// ошибки: если блок уже снят, лишние семь часов простоя дороже одной отвергнутой
// попытки. Дальше растёт вдвое — повтор доказывает, что часа не хватило.
export const COOLDOWN_STEPS_MS = [60, 120, 240, 480].map((m) => m * 60_000);

// Блок через полсуток после прошлого — это новая история, а не продолжение
// старой. Без сброса счётчик рос бы месяцами и однажды остановил бы ферму на
// восемь часов из-за единичного отказа.
export const STRIKE_RESET_MS = 12 * 60 * 60_000;

export function isCooldown(value: unknown): value is Cooldown {
  if (!value || typeof value !== "object") return false;
  const { until, since, strikes, reason } = value as Partial<Cooldown>;
  return (
    typeof until === "string" &&
    typeof since === "string" &&
    typeof strikes === "number" &&
    Number.isFinite(strikes) &&
    typeof reason === "string"
  );
}

/** Стоит ли заливка прямо сейчас. Битая дата — не пауза: NaN > nowMs ложно. */
export function isPaused(cooldown: Cooldown | null, nowMs: number): boolean {
  return cooldown !== null && Date.parse(cooldown.until) > nowMs;
}

/** Следующая пауза по предыдущей: шаг растёт, пока блоки идут подряд. */
export function nextCooldown(prev: Cooldown | null, nowMs: number, reason: string): Cooldown {
  // NaN в since (битая запись) даёт ложь и честно начинает серию заново.
  const continuing = prev !== null && nowMs - Date.parse(prev.since) < STRIKE_RESET_MS;
  const strikes = continuing ? Math.max(1, Math.floor(prev.strikes)) + 1 : 1;
  const step = COOLDOWN_STEPS_MS[Math.min(strikes, COOLDOWN_STEPS_MS.length) - 1];
  return {
    until: new Date(nowMs + step).toISOString(),
    since: new Date(nowMs).toISOString(),
    strikes,
    reason,
  };
}

export async function saveCooldown(cooldown: Cooldown): Promise<void> {
  await put(COOLDOWN_PATH, JSON.stringify(cooldown), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

/**
 * Пауза из состояния. Любой сбой чтения — это «паузы нет»: замолчать заливку
 * из-за недоступного Blob хуже, чем сходить в Instagram лишний раз. Отвергнутая
 * попытка всего лишь заново взведёт паузу, а вставшая намертво ферма молчит.
 */
export async function loadCooldown(): Promise<Cooldown | null> {
  try {
    const { blobs } = await list({ prefix: COOLDOWN_PATH });
    const blob = blobs.find((b) => b.pathname === COOLDOWN_PATH);
    if (!blob) return null;
    // Blob кэшируется на CDN: без cache-busting заливка ещё минуту не увидела бы
    // только что объявленную паузу и успела бы сходить в блок второй раз.
    const res = await fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isCooldown(data) ? data : null;
  } catch (error) {
    console.error("farm cooldown: состояние паузы не прочиталось", error);
    return null;
  }
}

/** Человеческий текст паузы для чата: сколько стоим и до какого времени. */
export function formatCooldown(cooldown: Cooldown, nowMs: number, tz = "Asia/Jakarta"): string {
  const leftMs = Math.max(0, Date.parse(cooldown.until) - nowMs);
  const hours = Math.floor(leftMs / 3_600_000);
  const minutes = Math.round((leftMs % 3_600_000) / 60_000);
  const left = hours > 0 ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
  const at = new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(cooldown.until));
  return `${left} (до ${at})`;
}
