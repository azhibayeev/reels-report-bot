import { describe, it, expect } from "vitest";
import { jakartaDateKey, lastDayKeys, sprintDateKey } from "../lib/storage";

describe("jakartaDateKey", () => {
  it("formats a UTC instant as a date in Asia/Jakarta (UTC+7)", () => {
    // 2026-07-20 05:30 UTC = 12:30 WIB same day
    expect(jakartaDateKey(new Date("2026-07-20T05:30:00Z"))).toBe("2026-07-20");
    // 2026-07-20 20:00 UTC = 03:00 WIB next day
    expect(jakartaDateKey(new Date("2026-07-20T20:00:00Z"))).toBe("2026-07-21");
  });
});

describe("sprintDateKey", () => {
  it("names the sprint by the day it ends: 12:30 → 12:30 Джакарты", () => {
    // 04:00 UTC = 11:00 WIB — сутки ещё не закрылись, день тот же.
    expect(sprintDateKey(new Date("2026-08-26T04:00:00Z"))).toBe("2026-08-26");
    // 05:30 UTC = ровно 12:30 WIB — граница уходит уже в следующие сутки.
    expect(sprintDateKey(new Date("2026-08-26T05:30:00Z"))).toBe("2026-08-27");
    // 13:00 UTC = 20:00 WIB — вечер попадает в сутки, которые закроются завтра в 12:30.
    expect(sprintDateKey(new Date("2026-08-26T13:00:00Z"))).toBe("2026-08-27");
  });
});

describe("lastDayKeys", () => {
  it("returns the last N Jakarta days in ascending order, ending today", () => {
    expect(lastDayKeys(new Date("2026-08-26T05:30:20Z"), 3)).toEqual(["2026-08-24", "2026-08-25", "2026-08-26"]);
  });

  it("counts the day itself as one", () => {
    expect(lastDayKeys(new Date("2026-08-26T05:30:20Z"), 1)).toEqual(["2026-08-26"]);
  });
});
