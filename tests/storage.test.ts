import { describe, it, expect } from "vitest";
import { jakartaDateKey } from "../lib/storage";

describe("jakartaDateKey", () => {
  it("formats a UTC instant as a date in Asia/Jakarta (UTC+7)", () => {
    // 2026-07-20 05:30 UTC = 12:30 WIB same day
    expect(jakartaDateKey(new Date("2026-07-20T05:30:00Z"))).toBe("2026-07-20");
    // 2026-07-20 20:00 UTC = 03:00 WIB next day
    expect(jakartaDateKey(new Date("2026-07-20T20:00:00Z"))).toBe("2026-07-21");
  });
});
