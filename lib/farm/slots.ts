export interface SlotConfig {
  startHHMM: string;
  /**
   * Конец окна выпуска. Из него и зазора выводится число слотов в сутки: держать
   * их двумя независимыми настройками значило позволить сетку, которая не
   * совпадает сама с собой (см. slotsPerDay).
   */
  endHHMM: string;
  minutes: number;
  perDay: number;
  tz: string;
}

export const DEFAULT_SLOTS: SlotConfig = {
  startHHMM: "09:00",
  endHHMM: "00:30",
  minutes: 45,
  perDay: 15,
  tz: "Asia/Jakarta",
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function slotConfigFromEnv(): SlotConfig {
  // Кривой HH:MM (без ведущего нуля, лишние символы и т.п.) уводит localToUtcMs
  // в Date.parse -> NaN, и назначение слота падает с RangeError вместо отката к дефолту.
  const rawStart = process.env.FARM_SLOT_START;
  const startHHMM = rawStart && HHMM.test(rawStart) ? rawStart : DEFAULT_SLOTS.startHHMM;
  const rawEnd = process.env.FARM_SLOT_END;
  const endHHMM = rawEnd && HHMM.test(rawEnd) ? rawEnd : DEFAULT_SLOTS.endHHMM;
  return {
    startHHMM,
    endHHMM,
    minutes: Number(process.env.FARM_SLOT_MINUTES) || DEFAULT_SLOTS.minutes,
    perDay: Number(process.env.FARM_SLOTS_PER_DAY) || DEFAULT_SLOTS.perDay,
    tz: process.env.FARM_TZ || DEFAULT_SLOTS.tz,
  };
}

// Смещение зоны в минутах на конкретный момент. Считаем через Intl, а не константой:
// Джакарта без переходов, но правило не должно врать при смене зоны в настройках.
function offsetMinutes(tz: string, atUtcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(atUtcMs));
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(at("year"), at("month") - 1, at("day"), at("hour") % 24, at("minute"), at("second"));
  return (asUtc - atUtcMs) / 60_000;
}

// Момент локального времени в UTC. Смещение зависит от самого момента, поэтому
// уточняем его вторым проходом — иначе на границе перехода зоны ошиблись бы на час.
function localToUtcMs(tz: string, dayKey: string, hhmm: string): number {
  const naive = Date.parse(`${dayKey}T${hhmm}:00.000Z`);
  let guess = naive - offsetMinutes(tz, naive) * 60_000;
  guess = naive - offsetMinutes(tz, guess) * 60_000;
  return guess;
}

function dayKey(tz: string, atUtcMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(atUtcMs));
}

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Сколько слотов помещается в окно при данном зазоре.
 *
 * Окно почти всегда переходит полночь (05:00 → 00:30), поэтому длину считаем по
 * кругу суток, а не вычитанием: иначе вышло бы отрицательное число.
 *
 * Зазор — единственный руль темпа, и число в сутки обязано следовать за ним.
 * Пока их держали двумя независимыми настройками, сменить одно, не пересчитав
 * другое, значило получить сетку, которая не совпадает ни с чем.
 */
export function slotsPerDay(startHHMM: string, endHHMM: string, minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 1;
  const span = (minutesOfDay(endHHMM) - minutesOfDay(startHHMM) + 1440) % 1440;
  return Math.max(1, Math.floor(span / minutes) + 1);
}

/**
 * Лежит ли время ровно на сетке. По этому и решается, пора ли пересобирать
 * очередь: сменился темп — прежние слоты перестают ей принадлежать.
 *
 * Якорей два, потому что окно переходит полночь: слот в 00:30 — это последний
 * слот вчерашней сетки, а не первый сегодняшней.
 */
export function isOnGrid(iso: string, cfg: SlotConfig): boolean {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return false;
  const step = cfg.minutes * 60_000;
  if (step <= 0) return false;
  for (const dayShift of [0, -86_400_000]) {
    const key = dayKey(cfg.tz, at + dayShift);
    const delta = at - localToUtcMs(cfg.tz, key, cfg.startHHMM);
    if (delta < 0 || delta % step !== 0) continue;
    if (delta / step < cfg.perDay) return true;
  }
  return false;
}

export function nextFreeSlot(
  taken: string[],
  nowMs: number,
  cfg: SlotConfig = DEFAULT_SLOTS,
  leadMs: number = 5 * 60_000
): string {
  const busy = new Set(taken);
  const earliest = nowMs + leadMs;

  // 60 дней вперёд — с запасом: при 15 слотах в день это 900 роликов, больше
  // любой реальной очереди, а бесконечный цикл здесь недопустим.
  for (let dayOffset = 0; dayOffset < 60; dayOffset += 1) {
    const key = dayKey(cfg.tz, nowMs + dayOffset * 86_400_000);
    const first = localToUtcMs(cfg.tz, key, cfg.startHHMM);
    for (let i = 0; i < cfg.perDay; i += 1) {
      const at = first + i * cfg.minutes * 60_000;
      if (at < earliest) continue;
      const iso = new Date(at).toISOString();
      if (!busy.has(iso)) return iso;
    }
  }
  throw new Error("Свободных слотов не нашлось на 60 дней вперёд");
}
