import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SLOTS, nextFreeSlot, slotConfigFromEnv } from "../lib/farm/slots";

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

const ENV_KEYS = ["FARM_SLOT_START", "FARM_SLOT_MINUTES", "FARM_SLOTS_PER_DAY", "FARM_TZ"] as const;

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
    process.env.FARM_SLOT_MINUTES = "30";
    process.env.FARM_SLOTS_PER_DAY = "20";
    process.env.FARM_TZ = "Asia/Almaty";
    expect(slotConfigFromEnv()).toEqual({
      startHHMM: "07:30",
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
