import { describe, it, expect } from "vitest";
import { measureWidth } from "../lib/textwidth";

describe("measureWidth", () => {
  it("на пустой строке возвращает 0", () => {
    expect(measureWidth("", 106)).toBe(0);
  });

  it("узкие буквы уже широких: iii меньше mmm", () => {
    const narrow = measureWidth("iii", 106);
    const wide = measureWidth("mmm", 106);
    expect(narrow).toBeGreaterThan(0);
    expect(narrow).toBeLessThan(wide);
  });

  it("линейна по кеглю: удвоение кегля удваивает ширину", () => {
    const base = measureWidth("Bacalah doa ini", 106);
    const doubled = measureWidth("Bacalah doa ini", 212);
    expect(doubled).toBeCloseTo(base * 2, 1);
  });

  it("символ вне cmap не роняет функцию", () => {
    // Эмодзи и арабская алиф отсутствуют в латинском Plus Jakarta Sans —
    // должны посчитаться по advance глифа .notdef (id 0), не бросить исключение.
    expect(() => measureWidth("halo🙂dunia", 106)).not.toThrow();
    const withUnknown = measureWidth("a🙂b", 106);
    expect(withUnknown).toBeGreaterThan(0);
  });
});
