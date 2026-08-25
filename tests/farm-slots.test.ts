import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SLOTS, isOnGrid, nextFreeSlot, slotConfigFromEnv, slotsPerDay } from "../lib/farm/slots";

// 19 августа 2026, 02:00 UTC = 09:00 в Джакарте (UTC+7).
const AT_0900_JKT = Date.parse("2026-08-19T02:00:00.000Z");

describe("nextFreeSlot", () => {
  it("первый свободный слот дня, с учётом упреждения 5 минут", () => {
    // 08:30 по Джакарте — слот 09:00 ещё впереди.
    const slot = nextFreeSlot([], AT_0900_JKT - 30 * 60_000, DEFAULT_SLOTS);
    expect(slot).toBe("2026-08-19T02:00:00.000Z");
  });

  it("занятые слоты пропускаются", () => {
    const slot = nextFreeSlot(["2026-08-19T02:00:00.000Z"], AT_0900_JKT - 30 * 60_000, DEFAULT_SLOTS);
    expect(slot).toBe("2026-08-19T02:45:00.000Z");
  });

  it("слот, до которого меньше 5 минут, не берётся", () => {
    const slot = nextFreeSlot([], AT_0900_JKT - 60_000, DEFAULT_SLOTS);
    expect(slot).toBe("2026-08-19T02:45:00.000Z");
  });

  it("кончились 15 слотов дня — переходит на 09:00 завтра", () => {
    const taken = Array.from({ length: DEFAULT_SLOTS.perDay }, (_, i) =>
      new Date(AT_0900_JKT + i * DEFAULT_SLOTS.minutes * 60_000).toISOString()
    );
    expect(nextFreeSlot(taken, AT_0900_JKT - 30 * 60_000, DEFAULT_SLOTS)).toBe("2026-08-20T02:00:00.000Z");
  });

  it("вечером после последнего слота — сразу утро следующего дня", () => {
    const atNight = Date.parse("2026-08-19T15:00:00.000Z"); // 22:00 в Джакарте
    expect(nextFreeSlot([], atNight, DEFAULT_SLOTS)).toBe("2026-08-20T02:00:00.000Z");
  });
});

const ENV_KEYS = ["FARM_SLOT_START", "FARM_SLOT_END", "FARM_SLOT_MINUTES", "FARM_SLOTS_PER_DAY", "FARM_TZ"] as const;

describe("slotConfigFromEnv", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("без переменных окружения возвращает дефолты", () => {
    expect(slotConfigFromEnv()).toEqual(DEFAULT_SLOTS);
  });

  it("читает полный набор переменных окружения", () => {
    process.env.FARM_SLOT_START = "07:30";
    process.env.FARM_SLOT_END = "22:00";
    process.env.FARM_SLOT_MINUTES = "30";
    process.env.FARM_SLOTS_PER_DAY = "20";
    process.env.FARM_TZ = "Asia/Almaty";
    expect(slotConfigFromEnv()).toEqual({
      startHHMM: "07:30",
      endHHMM: "22:00",
      minutes: 30,
      perDay: 20,
      tz: "Asia/Almaty",
    });
  });

  it("мусорный FARM_SLOT_START не должен ронять назначение слота", () => {
    process.env.FARM_SLOT_START = "9:00";
    expect(slotConfigFromEnv()).toEqual({
      ...DEFAULT_SLOTS,
      startHHMM: "09:00",
    });
  });
});

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
