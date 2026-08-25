# Адаптивный темп фермы рилсов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ферма сама подбирает зазор между публикациями так, чтобы Instagram не выдавал «User is performing too many actions».

**Architecture:** Единственный руль — зазор в минутах, лежит в новом блобе `farm/state/pace.json`. Число слотов в сутки выводится из окна `FARM_SLOT_START`–`FARM_SLOT_END`. Блок увеличивает зазор на треть сразу, двенадцать чистых публикаций уменьшают на 10%. Очередь держится на сетке текущего темпа правилом, которое каждые пять минут проверяет будильник.

**Tech Stack:** TypeScript, Next.js App Router, Vercel Blob, vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-farm-adaptive-pace-design.md`

## Global Constraints

- Комментарии и сообщения в чат — по-русски, как во всём `lib/farm/`.
- Комментарий объясняет **почему**, а не что. Пересказ кода словами не нужен.
- Округление зазора — всегда до 5 минут.
- Границы зазора: не быстрее **90** минут, не медленнее **240**.
- Порог чистой серии: **12** успешных публикаций подряд.
- Шаг вниз: `× 4/3`. Шаг вверх: `× 0.9`.
- Окно по умолчанию: `FARM_SLOT_START = 05:00`, `FARM_SLOT_END = 00:30`, зона `Asia/Jakarta`.
- Нечитаемое состояние в Blob никогда не роняет заливку: откат к значениям из переменных окружения.
- Тесты гоняются `npx vitest run <файл>`; весь набор — `npx vitest run`.

---

### Task 1: Окно и вывод числа слотов в сутки

**Files:**
- Modify: `lib/farm/slots.ts`
- Test: `tests/farm-slots.test.ts`

**Interfaces:**
- Produces:
  - `SlotConfig` получает поле `endHHMM: string`
  - `slotsPerDay(startHHMM: string, endHHMM: string, minutes: number): number`
  - `isOnGrid(iso: string, cfg: SlotConfig): boolean`

- [ ] **Step 1: Написать падающие тесты**

Дописать в конец `tests/farm-slots.test.ts`:

```ts
describe("slotsPerDay", () => {
  it("выводит число слотов из окна и зазора", () => {
    // 05:00–00:30 — это 1170 минут; сегодняшние 45 минут дают ровно 27 слотов,
    // те самые, что стоят в проде.
    expect(slotsPerDay("05:00", "00:30", 45)).toBe(27);
    expect(slotsPerDay("05:00", "00:30", 180)).toBe(7);
    expect(slotsPerDay("05:00", "00:30", 240)).toBe(5);
  });

  it("окно через полночь считает вперёд, а не назад", () => {
    expect(slotsPerDay("22:00", "02:00", 60)).toBe(5);
  });

  it("вырожденное окно и мусорный зазор дают один слот, а не ноль и не NaN", () => {
    expect(slotsPerDay("05:00", "05:00", 60)).toBe(1);
    expect(slotsPerDay("05:00", "00:30", 0)).toBe(1);
    expect(slotsPerDay("05:00", "00:30", Number.NaN)).toBe(1);
  });
});

describe("isOnGrid", () => {
  const cfg = { startHHMM: "05:00", endHHMM: "00:30", minutes: 180, perDay: 7, tz: "Asia/Jakarta" };

  it("узнаёт слот своей сетки", () => {
    expect(isOnGrid("2026-08-25T10:00:00.000Z", cfg)).toBe(true); // 17:00 по Джакарте
  });

  it("слот чужой сетки не признаёт", () => {
    expect(isOnGrid("2026-08-25T10:15:00.000Z", cfg)).toBe(false); // 17:15, сетка 45 минут
  });

  it("слот за полночь принадлежит сетке ПРЕДЫДУЩЕГО дня", () => {
    const cfg45 = { ...cfg, minutes: 45, perDay: 27 };
    // 00:30 по Джакарте 26.08 — это 27-й слот сетки, начавшейся 25.08 в 05:00.
    expect(isOnGrid("2026-08-25T17:30:00.000Z", cfg45)).toBe(true);
  });

  it("время за пределом числа слотов в сетку не входит", () => {
    // 26.08, 02:00 по Джакарте — сетка 25.08 кончилась на 23:00, а сетка 26.08
    // ещё не началась (её первый слот в 05:00).
    expect(isOnGrid("2026-08-25T19:00:00.000Z", cfg)).toBe(false);
  });

  it("битую дату не признаёт, а не падает", () => {
    expect(isOnGrid("не дата", cfg)).toBe(false);
  });
});
```

Импорты в шапке файла дополнить: `import { ..., isOnGrid, slotsPerDay } from "../lib/farm/slots";`

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/farm-slots.test.ts`
Expected: FAIL — `slotsPerDay is not a function`, `isOnGrid is not a function`.

- [ ] **Step 3: Реализовать**

В `lib/farm/slots.ts` в интерфейс добавить поле и расширить дефолт с чтением из env:

```ts
export interface SlotConfig {
  startHHMM: string;
  /** Конец окна выпуска. Из него выводится число слотов в сутки. */
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
```

В `slotConfigFromEnv()` рядом с разбором `FARM_SLOT_START` добавить такой же разбор `FARM_SLOT_END` (тот же регэксп `HHMM`, тот же откат к дефолту) и вернуть `endHHMM` в объекте.

Ниже `dayKey` добавить:

```ts
function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Сколько слотов помещается в окно при данном зазоре.
 *
 * Окно почти всегда переходит полночь (05:00 → 00:30), поэтому длину считаем
 * по кругу суток, а не вычитанием: иначе вышло бы отрицательное число.
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
 * очередь: сменился темп — прежние слоты перестают принадлежать сетке.
 *
 * Проверяем два якоря, потому что окно переходит полночь: слот в 00:30 — это
 * последний слот вчерашней сетки, а не первый сегодняшней.
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
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run tests/farm-slots.test.ts`
Expected: PASS.

Затем весь набор — новое поле `endHHMM` обязательно, и его отсутствие в литералах `SlotConfig` внутри других тестов сломает типы:

Run: `npx vitest run && npx tsc --noEmit`
Expected: тесты зелёные; в `tsc` остаются только три давние ошибки в `tests/farm-cooldown.test.ts` (строки ~136 и ~161) — они были до этой работы.

Если какой-то тест или файл собирает `SlotConfig` литералом без `endHHMM` — дописать туда `endHHMM: "00:30"`.

- [ ] **Step 5: Коммит**

```bash
git add lib/farm/slots.ts tests/farm-slots.test.ts
git commit -m "feat(farm): окно выпуска явное, число слотов в сутки выводится из зазора"
```

---

### Task 2: Состояние темпа и правила адаптации

**Files:**
- Create: `lib/farm/pace.ts`
- Create: `tests/farm-pace.test.ts`

**Interfaces:**
- Consumes: `slotsPerDay`, `slotConfigFromEnv`, `SlotConfig` из Task 1.
- Produces:
  - `Pace { minutes: number; changedAt: string; publishedSince: number; reason: "manual" | "block" | "clean" }`
  - `PACE_PATH`, `PACE_MIN_MINUTES = 90`, `PACE_MAX_MINUTES = 240`, `CLEAN_RUN = 12`, `MIN_SLOT_MINUTES = 15`, `MAX_PER_DAY = 40`
  - `isPace(value: unknown): value is Pace`
  - `roundTo5(minutes: number): number`
  - `defaultPace(nowMs: number): Pace`
  - `afterBlock(pace: Pace, nowMs: number): { pace: Pace; slowed: boolean; atLimit: boolean }`
  - `afterPublish(pace: Pace, nowMs: number): { pace: Pace; sped: boolean }`
  - `manualPace(minutes: number, nowMs: number): Pace`
  - `paceSlotConfig(pace: Pace | null): SlotConfig`
  - `describePace(pace: Pace): string`
  - `loadPace(): Promise<Pace | null>`, `savePace(pace: Pace): Promise<void>`

- [ ] **Step 1: Написать падающие тесты**

Создать `tests/farm-pace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  afterBlock,
  afterPublish,
  CLEAN_RUN,
  defaultPace,
  describePace,
  isPace,
  manualPace,
  Pace,
  PACE_MAX_MINUTES,
  PACE_MIN_MINUTES,
  paceSlotConfig,
  roundTo5,
} from "../lib/farm/pace";

const NOW = Date.parse("2026-08-25T05:00:00.000Z");
const pace = (over: Partial<Pace> = {}): Pace => ({
  minutes: 180,
  changedAt: new Date(NOW - 3_600_000).toISOString(),
  publishedSince: 0,
  reason: "manual",
  ...over,
});

describe("roundTo5", () => {
  it("округляет к ближайшим пяти минутам", () => {
    expect(roundTo5(162)).toBe(160);
    expect(roundTo5(144)).toBe(145);
    expect(roundTo5(130.5)).toBe(130);
  });

  it("ниже пяти минут не опускается", () => {
    expect(roundTo5(1)).toBe(5);
  });
});

describe("afterBlock", () => {
  it("растит зазор на треть", () => {
    const next = afterBlock(pace({ minutes: 180 }), NOW);
    expect(next.pace.minutes).toBe(240);
    expect(next.slowed).toBe(true);
    expect(next.atLimit).toBe(false);
    expect(next.pace.reason).toBe("block");
  });

  it("обнуляет счётчик чистой серии: серия прервана", () => {
    expect(afterBlock(pace({ publishedSince: 9 }), NOW).pace.publishedSince).toBe(0);
  });

  it("не переваливает за потолок", () => {
    expect(afterBlock(pace({ minutes: 200 }), NOW).pace.minutes).toBe(PACE_MAX_MINUTES);
  });

  it("на потолке говорит, что сбавлять больше некуда", () => {
    const next = afterBlock(pace({ minutes: PACE_MAX_MINUTES }), NOW);
    expect(next.pace.minutes).toBe(PACE_MAX_MINUTES);
    expect(next.slowed).toBe(false);
    expect(next.atLimit).toBe(true);
  });
});

describe("afterPublish", () => {
  it("считает публикации, пока серия не набралась", () => {
    const next = afterPublish(pace({ publishedSince: 3 }), NOW);
    expect(next.pace.publishedSince).toBe(4);
    expect(next.pace.minutes).toBe(180);
    expect(next.sped).toBe(false);
  });

  it("на двенадцатой публикации ускоряется и обнуляет счётчик", () => {
    const next = afterPublish(pace({ minutes: 180, publishedSince: CLEAN_RUN - 1 }), NOW);
    expect(next.pace.minutes).toBe(160);
    expect(next.pace.publishedSince).toBe(0);
    expect(next.pace.reason).toBe("clean");
    expect(next.sped).toBe(true);
  });

  it("на полу счётчик обнуляет, но темп не трогает и не сообщает", () => {
    // Иначе каждая следующая публикация снова просилась бы ускоряться и слала
    // бы в чат сообщение о темпе, который не менялся.
    const next = afterPublish(pace({ minutes: PACE_MIN_MINUTES, publishedSince: CLEAN_RUN - 1 }), NOW);
    expect(next.pace.minutes).toBe(PACE_MIN_MINUTES);
    expect(next.pace.publishedSince).toBe(0);
    expect(next.sped).toBe(false);
  });

  it("ниже пола не опускается", () => {
    const next = afterPublish(pace({ minutes: 95, publishedSince: CLEAN_RUN - 1 }), NOW);
    expect(next.pace.minutes).toBe(PACE_MIN_MINUTES);
  });
});

describe("paceSlotConfig", () => {
  it("выводит число слотов из зазора", () => {
    const cfg = paceSlotConfig({ ...pace(), minutes: 180 });
    expect(cfg.minutes).toBe(180);
    expect(cfg.perDay).toBe(7);
  });

  it("без состояния берёт настройки окружения", () => {
    expect(paceSlotConfig(null).minutes).toBe(45);
  });
});

describe("isPace", () => {
  it("принимает целую запись", () => {
    expect(isPace(pace())).toBe(true);
  });

  it("отвергает мусор и выход за границы", () => {
    expect(isPace(null)).toBe(false);
    expect(isPace({ minutes: 180 })).toBe(false);
    expect(isPace(pace({ minutes: 5 }))).toBe(false);
    expect(isPace(pace({ reason: "какой-то" as Pace["reason"] }))).toBe(false);
  });
});

describe("describePace", () => {
  it("часы и минуты по-человечески, с числом в сутки", () => {
    expect(describePace(pace({ minutes: 240 }))).toBe("ролик раз в 4 ч (5 в сутки)");
    expect(describePace(pace({ minutes: 160 }))).toBe("ролик раз в 2 ч 40 мин (8 в сутки)");
    expect(describePace(pace({ minutes: 45 }))).toBe("ролик раз в 45 мин (27 в сутки)");
  });
});

describe("defaultPace / manualPace", () => {
  it("дефолт берёт зазор из окружения и помечен как ручной", () => {
    const p = defaultPace(NOW);
    expect(p.minutes).toBe(45);
    expect(p.reason).toBe("manual");
    expect(p.publishedSince).toBe(0);
  });

  it("ручная установка обнуляет счётчик серии", () => {
    expect(manualPace(180, NOW)).toEqual({
      minutes: 180,
      changedAt: new Date(NOW).toISOString(),
      publishedSince: 0,
      reason: "manual",
    });
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/farm-pace.test.ts`
Expected: FAIL — `Cannot find module '../lib/farm/pace'`.

- [ ] **Step 3: Реализовать**

Создать `lib/farm/pace.ts`:

```ts
import { list, put } from "@vercel/blob";
import { SlotConfig, slotConfigFromEnv, slotsPerDay } from "./slots";

/**
 * Темп заливки — единственный руль расписания.
 *
 * До 25.08.2026 темп задавали три связанных числа: час старта, зазор и
 * «сколько в сутки». Независимыми они не были — 05:00 плюс 26 шагов по 45 минут
 * и есть 00:30, — и лишнее число мешало: сменить зазор, не пересчитав его,
 * значило получить сетку, которая не совпадает ни с чем. Здесь остаётся зазор,
 * а число в сутки выводится из окна.
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

const REASONS = new Set(["manual", "block", "clean"]);

export type PaceReason = "manual" | "block" | "clean";

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

export function defaultPace(nowMs: number): Pace {
  return manualPace(slotConfigFromEnv().minutes, nowMs);
}

export function manualPace(minutes: number, nowMs: number): Pace {
  return {
    minutes,
    changedAt: new Date(nowMs).toISOString(),
    publishedSince: 0,
    reason: "manual",
  };
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
    // Счётчик обнуляем в любом случае: серия прервана блоком, даже если зазор
    // уже упёрся в потолок и не изменился.
    pace: { minutes, changedAt: slowed ? new Date(nowMs).toISOString() : pace.changedAt, publishedSince: 0, reason: slowed ? "block" : pace.reason },
    slowed,
    atLimit: !slowed,
  };
}

/**
 * Чистая серия — слабый сигнал, прибавляем понемногу и только по факту
 * залитых роликов.
 */
export function afterPublish(pace: Pace, nowMs: number): { pace: Pace; sped: boolean } {
  const publishedSince = pace.publishedSince + 1;
  if (publishedSince < CLEAN_RUN) return { pace: { ...pace, publishedSince }, sped: false };

  const minutes = Math.max(PACE_MIN_MINUTES, roundTo5(pace.minutes * 0.9));
  const sped = minutes < pace.minutes;
  // Счётчик обнуляем и на полу тоже: иначе каждая следующая публикация снова
  // просилась бы ускоряться и слала бы в чат сообщение о темпе, который не менялся.
  return {
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
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run tests/farm-pace.test.ts`
Expected: PASS (все группы).

- [ ] **Step 5: Коммит**

```bash
git add lib/farm/pace.ts tests/farm-pace.test.ts
git commit -m "feat(farm): темп заливки как состояние с правилами вверх и вниз"
```

---

### Task 3: Чтение задач мимо кэша

**Files:**
- Modify: `lib/farm/store.ts`
- Test: `tests/farm-store.test.ts`

**Interfaces:**
- Produces: `listItems(opts?: { fresh?: boolean }): Promise<Item[]>`

- [ ] **Step 1: Написать падающий тест**

Дописать в `tests/farm-store.test.ts` (внутри существующего блока про `listItems`; мок `fetch` в этом файле уже есть — использовать тот же приём, что и соседние тесты):

```ts
it("с fresh читает мимо кэша: проход, который пишет сразу после чтения, не должен видеть стухшую запись", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(String(url));
    return { ok: true, json: async () => ({ itemId: "a", index: 1, status: "queued" }) } as unknown as Response;
  });

  await listItems({ fresh: true });

  expect(urls.every((u) => u.includes("?ts="))).toBe(true);
});

it("без fresh кэш не обходит: /reels и страница расписания читают десятки блобов", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(String(url));
    return { ok: true, json: async () => ({ itemId: "a", index: 1, status: "queued" }) } as unknown as Response;
  });

  await listItems();

  expect(urls.some((u) => u.includes("?ts="))).toBe(false);
});
```

Если в файле нет готового мока `list` из `@vercel/blob`, повторить тот, что используют соседние тесты этого же файла.

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/farm-store.test.ts`
Expected: FAIL — первый тест не находит `?ts=` в запросах.

- [ ] **Step 3: Реализовать**

В `lib/farm/store.ts`:

```ts
async function readJson<T>(url: string, fresh = false): Promise<T | null> {
  // Blob отдаёт запись до минуты после put. Проход, который читает и тут же
  // пишет (будильник, тик заливки), из-за этого видит смесь старого и нового и
  // делает двойную работу — так пересборка очереди 23.08.2026 сходилась за три
  // вызова вместо одного. Читателям, которым минута неактуальности ничего не
  // стоит, обход кэша не нужен: это запрос к источнику на каждый ролик.
  const at = fresh ? `${url}${url.includes("?") ? "&" : "?"}ts=${Date.now()}` : url;
  try {
    return await fetchOnce<T>(at);
  } catch (firstError) {
    ...
```

Ниже сигнатуру `listItems` заменить на:

```ts
export async function listItems(opts?: { fresh?: boolean }): Promise<Item[]> {
```

и внутри воркера пробросить флаг в `readJson<Item>(blobs[mine].url, opts?.fresh)`.

`loadItem` оставить как есть.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run tests/farm-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add lib/farm/store.ts tests/farm-store.test.ts
git commit -m "feat(farm): listItems умеет читать задачи мимо кэша Blob"
```

---

### Task 4: Пересборка очереди правилом

**Files:**
- Modify: `lib/farm/schedule.ts`
- Test: `tests/farm-schedule.test.ts`

**Interfaces:**
- Consumes: `SLOT_TAKEN_STATUSES` из `lib/farm/queue.ts`.
- Produces:
  - `regrid(items: Item[], floorMs: number, nextFreeSlot: (taken: string[], nowMs: number) => string): SlotChange[]`
  - `queueOffGrid(items: Item[], floorMs: number, paused: boolean, onGrid: (iso: string) => boolean): boolean`
  - `rescheduleAfterPause` **удаляется** — `regrid` её обобщает.

- [ ] **Step 1: Написать падающие тесты**

В `tests/farm-schedule.test.ts` заменить блок `describe("rescheduleAfterPause", ...)` целиком на:

```ts
describe("regrid", () => {
  it("ставит всю очередь на сетку от пола, сохраняя порядок", () => {
    const items = [q(1, grid[0]), q(2, grid[1]), q(3, grid[2])];

    const changes = regrid(items, RESUME, nextFreeAfterResume);

    expect(changes.map((c) => c.scheduledAt)).toEqual([lateGrid[0], lateGrid[1], lateGrid[2]]);
  });

  it("первым идёт тот, кто стоял первым", () => {
    const items = [q(7, grid[3]), q(4, grid[0]), q(5, grid[1])];

    const changes = regrid(items, RESUME, nextFreeAfterResume);

    expect(changes.find((c) => c.scheduledAt === lateGrid[0])!.itemId).toBe("i4");
  });

  it("повторный проход ничего не двигает", () => {
    const items = [q(1, grid[0]), q(2, grid[1])];
    for (const c of regrid(items, RESUME, nextFreeAfterResume)) {
      items.find((i) => i.itemId === c.itemId)!.scheduledAt = c.scheduledAt;
    }

    expect(regrid(items, RESUME, nextFreeAfterResume)).toEqual([]);
  });

  it("занятое время posted и posting второй раз не выдаёт", () => {
    const items = [q(1, grid[0]), q(2, lateGrid[0], { status: "posted" })];

    expect(regrid(items, RESUME, nextFreeAfterResume)).toEqual([{ itemId: "i1", scheduledAt: lateGrid[1] }]);
  });

  it("упавших и выкинутых в расписание не возвращает", () => {
    const items = [q(1, grid[0], { status: "failed" }), q(2, grid[1], { status: "rejected" })];
    expect(regrid(items, RESUME, nextFreeAfterResume)).toEqual([]);
  });
});

describe("queueOffGrid", () => {
  const onGrid = (iso: string) => lateGrid.includes(iso);

  it("сетка сменилась — пересобирать надо", () => {
    expect(queueOffGrid([q(1, grid[0])], RESUME, false, onGrid)).toBe(true);
  });

  it("очередь уже на сетке — не надо", () => {
    expect(queueOffGrid([q(1, lateGrid[3])], RESUME, false, onGrid)).toBe(false);
  });

  it("во время паузы просроченный ролик пересборку запускает", () => {
    expect(queueOffGrid([q(1, lateGrid[0])], RESUME + 60_000, true, onGrid)).toBe(true);
  });

  it("вне паузы опоздавший ролик пересборку НЕ запускает: он не сломан, он наступил", () => {
    // Иначе двухминутное опоздание внешнего таймера перетряхивало бы всю очередь.
    expect(queueOffGrid([q(1, lateGrid[0])], RESUME + 60_000, false, onGrid)).toBe(false);
  });

  it("не-queued статусы не смотрит", () => {
    expect(queueOffGrid([q(1, grid[0], { status: "posted" })], RESUME, false, onGrid)).toBe(false);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/farm-schedule.test.ts`
Expected: FAIL — `regrid is not a function`, `queueOffGrid is not a function`.

- [ ] **Step 3: Реализовать**

В `lib/farm/schedule.ts` заменить `rescheduleAfterPause` на:

```ts
/**
 * Возврат очереди на сетку текущего темпа.
 *
 * Обобщение прежней rescheduleAfterPause, которая двигала только просроченные
 * за паузу ролики. Поводов съехать с сетки два, и оба требуют одного и того же:
 * пауза Instagram (слоты наступали, а публиковать было нельзя) и смена темпа
 * (сетка стала другой, прежние слоты ей больше не принадлежат).
 *
 * Просрочку не догоняют, а переносят: каждый ролик получает свой слот сетки
 * начиная с пола, в прежнем порядке. Сколько времени пауза съела, на столько
 * очередь и подвинется — зато аккаунт вернётся к тому ритму, за отклонение от
 * которого его и наказали.
 *
 * Возвращаем только настоящие переносы: ролик, который и так стоит на своём
 * месте, писать в Blob незачем, а на этом же держится идемпотентность прохода.
 */
export function regrid(
  items: Item[],
  floorMs: number,
  nextFreeSlot: (taken: string[], nowMs: number) => string
): SlotChange[] {
  const inSchedule = items.filter((i) => i.scheduledAt && SLOT_TAKEN_STATUSES.has(i.status));
  const queued = inSchedule
    .filter((i) => i.status === "queued")
    // Кто стоял раньше, тот и уходит раньше. Здесь это ещё и про ролик,
    // поймавший блок: он стоял первым и первым же должен выйти после паузы.
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!) || a.index - b.index);
  if (queued.length === 0) return [];

  // posting и posted своё время уже отработали: занять его вторично значило бы
  // вернуть ту самую слипшуюся сетку, ради которой всё и затевалось.
  const taken = inSchedule.filter((i) => i.status !== "queued").map((i) => i.scheduledAt as string);

  const changes: SlotChange[] = [];
  for (const item of queued) {
    const slot = nextFreeSlot(taken, floorMs);
    taken.push(slot);
    if (slot !== item.scheduledAt) changes.push({ itemId: item.itemId, scheduledAt: slot });
  }
  return changes;
}

/**
 * Стоит ли очередь не там, где должна.
 *
 * Опоздавший ролик ВНЕ паузы поводом не считается: он не сломан, он наступил, и
 * его дело — опубликоваться. Иначе двухминутное опоздание внешнего таймера
 * перетряхивало бы всю очередь на каждом проходе будильника.
 */
export function queueOffGrid(
  items: Item[],
  floorMs: number,
  paused: boolean,
  onGrid: (iso: string) => boolean
): boolean {
  return items.some(
    (i) =>
      i.status === "queued" &&
      i.scheduledAt !== null &&
      (!onGrid(i.scheduledAt) || (paused && Date.parse(i.scheduledAt) < floorMs))
  );
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run tests/farm-schedule.test.ts`
Expected: PASS. Сборка `tests/farm-sweep.test.ts` временно сломается — её чинит Task 5.

- [ ] **Step 5: Коммит**

```bash
git add lib/farm/schedule.ts tests/farm-schedule.test.ts
git commit -m "feat(farm): regrid вместо rescheduleAfterPause — очередь держится на сетке правилом"
```

---

### Task 5: Будильник применяет правило

**Files:**
- Modify: `lib/farm/sweep.ts`
- Modify: `app/api/farm/sweep/route.ts`
- Test: `tests/farm-sweep.test.ts`

**Interfaces:**
- Consumes: `regrid`, `queueOffGrid` (Task 4); `loadPace`, `paceSlotConfig` (Task 2); `isOnGrid` (Task 1); `listItems({ fresh })` (Task 3).
- Produces: `SweepDeps` получает `loadPace: () => Promise<Pace | null>` и `onGrid: (iso: string) => boolean`; поле `loadCooldown` остаётся.

- [ ] **Step 1: Написать падающие тесты**

В `tests/farm-sweep.test.ts` во все существующие вызовы `runSweep({...})` дописать две зависимости:

```ts
      loadPace: async () => null,
      onGrid: () => true,
```

и добавить новые тесты:

```ts
it("темп сменился — очередь пересобирается на новую сетку", async () => {
  const saved: Item[] = [];
  const result = await runSweep({
    now: () => NOW,
    loadCooldown: async () => null,
    loadPace: async () => null,
    // Слоты сетки 45 минут после смены темпа на 180 перестали ей принадлежать.
    onGrid: (iso) => iso === "2026-08-21T03:00:00.000Z",
    listItems: async () => [
      item({ itemId: "a", index: 1, status: "queued", scheduledAt: "2026-08-21T02:00:00.000Z" }),
      item({ itemId: "b", index: 2, status: "queued", scheduledAt: "2026-08-21T02:45:00.000Z" }),
    ],
    saveItem: async (i) => { saved.push(i); },
    nextFreeSlot: (taken) => (taken.includes("2026-08-21T03:00:00.000Z") ? "2026-08-21T06:00:00.000Z" : "2026-08-21T03:00:00.000Z"),
    triggerRender: async () => {},
  });

  expect(result.respaced).toBe(2);
  expect(saved.map((i) => i.scheduledAt)).toEqual(["2026-08-21T03:00:00.000Z", "2026-08-21T06:00:00.000Z"]);
});

it("очередь на сетке — не пишет ничего", async () => {
  const saveItem = vi.fn(async (_i: Item) => {});
  const result = await runSweep({
    now: () => NOW,
    loadCooldown: async () => null,
    loadPace: async () => null,
    onGrid: () => true,
    listItems: async () => [
      item({ itemId: "a", index: 1, status: "queued", scheduledAt: "2026-08-21T03:00:00.000Z" }),
    ],
    saveItem,
    nextFreeSlot: () => "2026-08-21T09:00:00.000Z",
    triggerRender: async () => {},
  });

  expect(result.respaced).toBe(0);
  expect(saveItem).not.toHaveBeenCalled();
});

it("нечитаемый темп не срывает будильник", async () => {
  const result = await runSweep({
    now: () => NOW,
    loadCooldown: async () => null,
    loadPace: async () => { throw new Error("Blob недоступен"); },
    onGrid: () => true,
    listItems: async () => [item({ itemId: "a", index: 1, status: "queued", scheduledAt: "2026-08-21T03:00:00.000Z" })],
    saveItem: async () => {},
    nextFreeSlot: () => "2026-08-21T09:00:00.000Z",
    triggerRender: async () => {},
  });

  expect(result.failed).toEqual([]);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/farm-sweep.test.ts`
Expected: FAIL — `rescheduleAfterPause` больше нет, `onGrid` не используется.

- [ ] **Step 3: Реализовать**

В `lib/farm/sweep.ts` заменить импорт и блок пересборки:

```ts
import { Cooldown, isPaused } from "./cooldown";
import { normalizeSchedule, queueOffGrid, regrid, SlotChange } from "./schedule";
```

В `SweepDeps` добавить:

```ts
  /**
   * Темп заливки. Будильнику он нужен не сам по себе, а чтобы понять, на какой
   * сетке очередь обязана стоять — см. onGrid.
   */
  loadPace: () => Promise<Pace | null>;
  /** Принадлежит ли время сетке текущего темпа (см. lib/farm/slots.ts). */
  onGrid: (iso: string) => boolean;
```

Тело `runSweep` — вместо прежнего блока с `rescheduleAfterPause`:

```ts
  // Съехать с сетки очередь может по двум причинам, и обе лечатся одинаково:
  // пауза Instagram (слоты наступали, публиковать было нельзя) и смена темпа
  // (сетка стала другой). Поэтому здесь не событие, а правило: очередь обязана
  // стоять на сетке текущего темпа начиная с пола — и если это не так,
  // пересобираем целиком.
  let cooldown: Cooldown | null = null;
  try {
    cooldown = await deps.loadCooldown();
  } catch (error) {
    // Нечитаемая пауза — не повод срывать будильник: расселение и пинки сборки
    // от неё не зависят, а перенос попробуем на следующем проходе.
    console.error("farm sweep: пауза не прочиталась, расписание не переносим", error);
  }
  try {
    await deps.loadPace();
  } catch (error) {
    // Темп читает роут, чтобы собрать nextFreeSlot и onGrid; здесь вызов нужен
    // лишь затем, чтобы его сбой попал в лог, а не остался незамеченным.
    console.error("farm sweep: темп не прочитался", error);
  }

  const paused = isPaused(cooldown, deps.now());
  const floor = paused ? Date.parse((cooldown as Cooldown).until) : deps.now();

  const changes: SlotChange[] = [];
  let scheduled = items;
  if (queueOffGrid(items, floor, paused, deps.onGrid)) {
    const moved = regrid(items, floor, deps.nextFreeSlot);
    if (moved.length) {
      changes.push(...moved);
      // Дальше расселение должно видеть уже новые времена, иначе оно приняло бы
      // освободившиеся слоты за занятые и погнало бы ролики по сетке впустую.
      const byId = new Map(moved.map((c) => [c.itemId, c.scheduledAt]));
      scheduled = items.map((i) => (byId.has(i.itemId) ? { ...i, scheduledAt: byId.get(i.itemId)! } : i));
    }
  }
```

Остальная часть функции (расселение через `normalizeSchedule(scheduled, ...)`, `lastPerItem`, запись) не меняется. Строку чтения задач заменить на `const items = await deps.listItems();` — тип `listItems` в `SweepDeps` остаётся `() => Promise<Item[]>`, флаг ставит роут.

В `app/api/farm/sweep/route.ts`:

```ts
import { loadCooldown } from "../../../../lib/farm/cooldown";
import { loadPace, paceSlotConfig } from "../../../../lib/farm/pace";
import { isOnGrid, nextFreeSlot } from "../../../../lib/farm/slots";
...
  const pace = await loadPace();
  const cfg = paceSlotConfig(pace);
  const result = await runSweep({
    now: () => Date.now(),
    loadCooldown,
    loadPace: async () => pace,
    onGrid: (iso) => isOnGrid(iso, cfg),
    // Будильник пишет сразу после чтения: стухшая запись здесь означает вторую
    // пересборку той же очереди на следующем проходе.
    listItems: () => listItems({ fresh: true }),
    saveItem,
    nextFreeSlot: (taken, nowMs) => nextFreeSlot(taken, nowMs, cfg),
    ...
```

Прежние строки с `loadRhythm`/`slotConfigFromEnv` из роута убрать.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run tests/farm-sweep.test.ts && npx tsc --noEmit`
Expected: PASS; в `tsc` — только три давние ошибки в `tests/farm-cooldown.test.ts`.

- [ ] **Step 5: Коммит**

```bash
git add lib/farm/sweep.ts app/api/farm/sweep/route.ts tests/farm-sweep.test.ts
git commit -m "feat(farm): будильник держит очередь на сетке текущего темпа"
```

---

### Task 6: Заливка крутит руль

**Files:**
- Modify: `lib/farm/post.ts`
- Test: `tests/farm-cooldown.test.ts`

**Interfaces:**
- Consumes: `afterBlock`, `afterPublish`, `defaultPace`, `describePace`, `loadPace`, `savePace`, `Pace` (Task 2).
- Produces: `PostDeps` получает `loadPace: () => Promise<Pace | null>` и `savePace: (pace: Pace) => Promise<void>`.

- [ ] **Step 1: Написать падающие тесты**

В `tests/farm-cooldown.test.ts` в хелпер `makeDeps` добавить дефолты:

```ts
    loadPace: async () => ({ minutes: 180, changedAt: new Date(NOW - 3_600_000).toISOString(), publishedSince: 0, reason: "manual" as const }),
    savePace: async (_p: Pace) => {},
```

и дописать группу:

```ts
describe("темп на блоке и на чистой серии", () => {
  it("блок сбавляет темп и говорит об этом в том же сообщении, что и о паузе", async () => {
    const savePace = vi.fn(async (_p: Pace) => {});
    const notify = vi.fn(async () => {});
    await postOne(base, makeDeps({ savePace, notify }));

    expect(savePace.mock.calls.at(-1)![0].minutes).toBe(240);
    const text = notify.mock.calls.map((c) => c[0] as string).join("\n");
    expect(text).toContain("Сбавил темп");
    expect(text).toContain("раз в 4 ч");
  });

  it("на потолке сообщает, что дело не в частоте", async () => {
    const notify = vi.fn(async () => {});
    const atLimit = { minutes: 240, changedAt: new Date(NOW).toISOString(), publishedSince: 0, reason: "block" as const };
    await postOne(base, makeDeps({ notify, loadPace: async () => atLimit }));

    expect(notify.mock.calls.map((c) => c[0] as string).join("\n")).toContain("Дело не в частоте");
  });

  it("нечитаемый темп не мешает объявить паузу", async () => {
    const saveCooldown = vi.fn(async () => {});
    await postOne(base, makeDeps({ saveCooldown, loadPace: async () => { throw new Error("Blob недоступен"); } }));

    expect(saveCooldown).toHaveBeenCalled();
  });
});
```

Для теста на успешную публикацию использовать хелпер успешного прогона из `tests/farm-post.test.ts` (там уже есть моки, которые доводят `postOne` до `posted`). Добавить туда:

```ts
it("двенадцатая публикация подряд ускоряет темп и сообщает об этом", async () => {
  const savePace = vi.fn(async (_p: Pace) => {});
  const notify = vi.fn(async () => {});
  await postOne(base, makeDeps({
    savePace,
    notify,
    loadPace: async () => ({ minutes: 180, changedAt: new Date(NOW - 86_400_000).toISOString(), publishedSince: 11, reason: "manual" as const }),
  }));

  expect(savePace.mock.calls.at(-1)![0].minutes).toBe(160);
  expect(notify.mock.calls.map((c) => c[0] as string).join("\n")).toContain("ускоряюсь");
});

it("обычная публикация только считает, темп не трогает и молчит", async () => {
  const savePace = vi.fn(async (_p: Pace) => {});
  const notify = vi.fn(async () => {});
  await postOne(base, makeDeps({
    savePace,
    notify,
    loadPace: async () => ({ minutes: 180, changedAt: new Date(NOW - 86_400_000).toISOString(), publishedSince: 3, reason: "manual" as const }),
  }));

  expect(savePace.mock.calls.at(-1)![0]).toMatchObject({ minutes: 180, publishedSince: 4 });
  expect(notify.mock.calls.map((c) => c[0] as string).join("\n")).not.toContain("ускоряюсь");
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/farm-cooldown.test.ts tests/farm-post.test.ts`
Expected: FAIL — `savePace` не вызывается, в сообщениях нет «Сбавил темп».

- [ ] **Step 3: Реализовать**

В `lib/farm/post.ts` в `PostDeps` добавить:

```ts
  /** Темп заливки — см. lib/farm/pace.ts. Блок сбавляет его, чистая серия прибавляет. */
  loadPace: () => Promise<Pace | null>;
  savePace: (pace: Pace) => Promise<void>;
```

В ветке `isRateBlock`, внутри `if (!running) { ... }` — до отправки сообщения:

```ts
      // Пауза лечит симптом: она пережидает блок, но следующий приходит ровно
      // тем же путём. Причина — темп выше того, что аккаунт переваривает,
      // поэтому блок обязан сбавлять темп, а не только останавливать заливку.
      let paceLine = "";
      try {
        const current = (await deps.loadPace()) ?? defaultPace(deps.now());
        const { pace, slowed, atLimit } = afterBlock(current, deps.now());
        await deps.savePace(pace);
        paceLine = slowed
          ? `\n\nСбавил темп: ${describePace(pace)}. Очередь пересоберётся ближайшим проходом будильника.`
          : atLimit
            ? `\n\nСбавил до предела — ${describePace(pace)}, и всё равно блок. Дело не в частоте: проверьте аккаунт руками.`
            : "";
      } catch (paceError) {
        // Несохранённый темп — это лишь «в следующий раз попробуем снова».
        // Пауза важнее: без неё очередь продолжит долбить в стену.
        console.error("farm postOne: темп не сбавлен", fresh.itemId, paceError);
      }
```

и в само сообщение добавить `paceLine` последней строкой:

```ts
        await notifyQuiet(
          `Instagram ограничил частоту публикаций: «${message}»\n\n` +
            `Заливка встала на ${formatCooldown(cooldown, deps.now())}. ` +
            `Ролики не потеряны — они ждут в очереди и пойдут сами, когда пауза кончится. ` +
            `Проверить очередь: /reels` +
            paceLine
        );
```

В успешной ветке — сразу после блока с `recordPublication`, перед `await deleteVideoQuiet();`:

```ts
    // Чистая серия — единственное доказательство, что темп безопасен, и
    // считать её надо по факту залитых роликов: пустая очередь двое суток
    // ничего не доказывает.
    try {
      const current = (await deps.loadPace()) ?? defaultPace(deps.now());
      const { pace, sped } = afterPublish(current, deps.now());
      await deps.savePace(pace);
      if (sped) {
        await notifyQuiet(
          `${CLEAN_RUN} роликов подряд без единого блока — ускоряюсь: ${describePace(pace)}. ` +
            `Очередь пересоберётся ближайшим проходом будильника.`
        );
      }
    } catch (paceError) {
      // Ролик уже на аккаунте; несчитанная публикация лишь отодвинет ускорение.
      console.error("farm postOne: темп не обновлён после публикации", fresh.itemId, paceError);
    }
```

В `livePostTickDeps()` добавить `loadPace` и `savePace` из `./pace`, а `minGapMs` считать от темпа:

```ts
  const pace = await loadPace();
  return {
    minGapMs: publishGapMs(pace?.minutes ?? slotConfigFromEnv().minutes),
    loadPace,
    savePace,
    ...
```

Прежнюю строку с `loadRhythm()` из `livePostTickDeps` убрать.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run tests/farm-cooldown.test.ts tests/farm-post.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add lib/farm/post.ts tests/farm-cooldown.test.ts tests/farm-post.test.ts
git commit -m "feat(farm): блок сбавляет темп, чистая серия его прибавляет"
```

---

### Task 7: Команды `/rhythm` и `/reels`

**Files:**
- Modify: `lib/farm/commands.ts`
- Modify: `lib/farm/style.ts`
- Modify: `app/api/telegram/route.ts`
- Test: `tests/farm-rhythm.test.ts`

**Interfaces:**
- Consumes: всё из Task 2.
- Produces: `parseRhythm(text: string, presets: Record<string, number>): number | "show" | null`; `RHYTHM_PRESETS: Record<string, number>` переезжает в `lib/farm/pace.ts`.

- [ ] **Step 1: Написать падающие тесты**

Заменить содержимое `tests/farm-rhythm.test.ts` на:

```ts
import { describe, expect, it } from "vitest";
import { parseRhythm } from "../lib/farm/commands";
import { RHYTHM_PRESETS } from "../lib/farm/pace";

describe("parseRhythm", () => {
  it("одно число — это зазор в минутах", () => {
    expect(parseRhythm("/rhythm 180", RHYTHM_PRESETS)).toBe(180);
  });

  it("пресеты переопределены под реальный потолок аккаунта", () => {
    // Прежние 30/45/90 минут на @daristeppe гарантированно приводили к блоку.
    expect(parseRhythm("/rhythm плотно", RHYTHM_PRESETS)).toBe(120);
    expect(parseRhythm("/rhythm обычно", RHYTHM_PRESETS)).toBe(180);
    expect(parseRhythm("/rhythm спокойно", RHYTHM_PRESETS)).toBe(240);
  });

  it("без аргумента показывает текущий темп", () => {
    expect(parseRhythm("/rhythm", RHYTHM_PRESETS)).toBe("show");
  });

  it("старую форму с двумя числами не принимает: второе теперь выводится", () => {
    expect(parseRhythm("/rhythm 30 20", RHYTHM_PRESETS)).toBe(null);
  });

  it("мусор не принимает", () => {
    expect(parseRhythm("/rhythm быстро", RHYTHM_PRESETS)).toBe(null);
    expect(parseRhythm("/rhythm -5", RHYTHM_PRESETS)).toBe(null);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/farm-rhythm.test.ts`
Expected: FAIL — `parseRhythm` возвращает объект, `RHYTHM_PRESETS` в `pace.ts` нет.

- [ ] **Step 3: Реализовать**

В `lib/farm/pace.ts` добавить:

```ts
// Пресеты — это стартовые зазоры, от которых ферма пляшет дальше сама. Прежние
// (30/45/90 минут) на этом аккаунте гарантированно приводят к блоку, поэтому
// имена сохранены, а числа переопределены.
export const RHYTHM_PRESETS: Record<string, number> = {
  плотно: 120,
  обычно: 180,
  спокойно: 240,
};
```

В `lib/farm/commands.ts` переписать `parseRhythm`:

```ts
/**
 * /rhythm — темп выпуска. Понимает пресет и одно число: /rhythm 180.
 *
 * Форма с двумя числами убрана: число роликов в сутки теперь выводится из окна
 * и зазора, и принимать его отдельно значило бы позволить выставить сетку,
 * которая не совпадает сама с собой.
 */
export function parseRhythm(text: string, presets: Record<string, number>): number | "show" | null {
  const arg = text.trim().split(/\s+/).slice(1).join(" ").trim().toLowerCase();
  if (!arg) return "show";
  if (arg in presets) return presets[arg];
  if (!/^\d+$/.test(arg)) return null;
  const minutes = Number(arg);
  return minutes > 0 ? minutes : null;
}
```

Из `lib/farm/style.ts` убрать `Rhythm`, `isRhythm`, `RHYTHM_PRESETS`, `MIN_SLOT_MINUTES`, `MAX_PER_DAY`, `saveRhythm`, `loadRhythm`; оставить позицию хука и `readSettings`/`writeSettings` без поля `rhythm`. Все импорты этих имён в проекте перевести на `lib/farm/pace.ts` (найти: `grep -rn "loadRhythm\|saveRhythm\|RHYTHM_PRESETS\|MIN_SLOT_MINUTES\|MAX_PER_DAY" --include="*.ts" --include="*.tsx" . | grep -v node_modules`).

В `app/api/telegram/route.ts` обработчик `/rhythm`:

```ts
  if (cmd === "/rhythm") {
    const parsed = parseRhythm(text, RHYTHM_PRESETS);
    const current = (await loadPace()) ?? defaultPace(Date.now());
    if (parsed === "show") {
      const who = { manual: "поставлено руками", block: "сбавлено после блока", clean: "ускорено за чистую серию" }[current.reason];
      await sendMessage(
        `Сейчас: ${describePace(current)} — ${who} ${formatWhen(current.changedAt)}.\n` +
          `До следующего ускорения роликов: ${Math.max(0, CLEAN_RUN - current.publishedSince)}.\n\n` +
          `Пресеты: /rhythm плотно (2 ч) · /rhythm обычно (3 ч) · /rhythm спокойно (4 ч)\n` +
          `Или своим числом минут: /rhythm 150`,
        opts
      );
      return true;
    }
    if (parsed === null) {
      await sendMessage(
        "Не понял. Теперь одно число — зазор в минутах: /rhythm 180. " +
          "Сколько роликов в сутки, бот считает сам из окна выпуска.",
        opts
      );
      return true;
    }
    if (parsed < MIN_SLOT_MINUTES) {
      await sendMessage(`Зазор не меньше ${MIN_SLOT_MINUTES} минут.`, opts);
      return true;
    }
    const next = manualPace(parsed, Date.now());
    await savePace(next);
    await sendMessage(
      `Темп: ${describePace(next)}. Очередь пересоберётся ближайшим проходом будильника — это до пяти минут.`,
      opts
    );
    return true;
  }
```

`formatWhen` — короткий локальный хелпер в этом же файле:

```ts
const formatWhen = (iso: string): string =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
```

В обработчике `/reels` строку, где собирается `slotCfg`, заменить на `paceSlotConfig(await loadPace())`, и первой строкой сводки добавить текущий темп:

```ts
      const pace = (await loadPace()) ?? defaultPace(Date.now());
      const slotCfg = paceSlotConfig(pace);
      // ...в текст сводки, рядом со строкой о паузе:
      `Темп: ${describePace(pace)}`
```

Строку помощи (`/rhythm плотно|обычно|спокойно — ...`) поправить под одно число.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run && npx tsc --noEmit`
Expected: весь набор зелёный; в `tsc` — только три давние ошибки в `tests/farm-cooldown.test.ts`.

- [ ] **Step 5: Коммит**

```bash
git add lib/farm/commands.ts lib/farm/pace.ts lib/farm/style.ts app/api/telegram/route.ts tests/farm-rhythm.test.ts
git commit -m "feat(farm): /rhythm одним числом, темп виден в /reels"
```

---

### Task 8: Выкатка

**Files:**
- Modify: `docs/superpowers/specs/2026-08-25-farm-adaptive-pace-design.md` (сообщение о блоке — одно, а не два)

- [ ] **Step 1: Поправить спеку под фактическое поведение**

В разделе «Что видит человек» заменить отдельное сообщение о сбавленном темпе на строку, которая дописывается к сообщению о паузе — два уведомления подряд об одном событии это шум.

- [ ] **Step 2: Задать окно в переменных Vercel**

```bash
printf '00:30' | npx vercel env add FARM_SLOT_END production
```

Проверить, что `FARM_SLOT_START` уже равен `05:00` (значение помечено sensitive и не читается; сверяться по сетке слотов в `/reels`).

- [ ] **Step 3: Деплой**

```bash
npx vercel --prod --yes
```

- [ ] **Step 4: Записать стартовый темп**

Без этого первый же проход возьмёт зазор из переменных окружения (45 минут) и вернёт аккаунт под блок. Одноразовым скриптом через `npx vite-node` записать `farm/state/pace.json`:

```
{ minutes: 180, changedAt: <сейчас>, publishedSince: 0, reason: "manual" }
```

- [ ] **Step 5: Проверить, что правило согласно с уже пересобранной очередью**

```bash
curl -s -H "Authorization: Bearer $(cat .superpowers/cron-secret.txt)" https://qurany-eight.vercel.app/api/farm/sweep
```

Expected: `{"kicked":[],"failed":[],"respaced":0}` — очередь, вручную пересобранная 25.08, сетке 180 минут уже соответствует, и правило её не двигает.

- [ ] **Step 6: Коммит**

```bash
git add docs/superpowers/specs/2026-08-25-farm-adaptive-pace-design.md
git commit -m "docs: сообщение о сбавленном темпе идёт одной строкой с сообщением о паузе"
```

---

## Самопроверка плана

**Покрытие спеки:**

| Раздел спеки | Задача |
|---|---|
| Состояние `pace.json` | 2 |
| Окно и вывод числа в сутки | 1 |
| Правила адаптации (блок / чистая серия / руками) | 2 (правила), 6 (блок и публикация), 7 (руками) |
| Пересборка очереди | 4 (правило), 5 (применение) |
| Чтение мимо кэша | 3 (механизм), 5 (использование) |
| Что видит человек | 6 (сообщения), 7 (команды) |
| Файлы | все задачи |
| Тесты | все задачи |
| Что делается руками при выкатке | 8 |

**Согласованность имён:** `slotsPerDay`, `isOnGrid` (Task 1) → `paceSlotConfig` (Task 2) → `regrid`, `queueOffGrid` (Task 4) → `SweepDeps.onGrid`, `SweepDeps.loadPace` (Task 5) → `PostDeps.loadPace`, `PostDeps.savePace` (Task 6) → `RHYTHM_PRESETS`, `parseRhythm` (Task 7). Расхождений нет.

**Порядок:** Task 3 (store) идёт до Task 5 (sweep), который им пользуется. Task 4 временно ломает сборку `tests/farm-sweep.test.ts` — это отмечено в самой задаче и чинится Task 5.
