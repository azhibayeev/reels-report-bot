import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

// Окно задаём явно: дефолт в DEFAULT_SLOTS исторический (09:00), а числа ниже
// проверяют вывод для окна, которое стоит в проде.
const ENV_KEYS = ["FARM_SLOT_START", "FARM_SLOT_END", "FARM_SLOT_MINUTES"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.FARM_SLOT_START = "05:00";
  process.env.FARM_SLOT_END = "00:30";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});
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
