import { describe, it, expect } from "vitest";
import { fontFamily } from "../lib/probe";
import { fontPath } from "../lib/binaries";

describe("fontFamily", () => {
  it("читает имя семейства из name-таблицы TTF", () => {
    const family = fontFamily(fontPath());
    expect(family.length).toBeGreaterThan(0);
    expect(family).toMatch(/Jakarta/i);
  });

  it("на файле, который не TTF, бросает понятную ошибку", () => {
    expect(() => fontFamily("/etc/hosts")).toThrow(/name-таблиц/i);
  });
});
