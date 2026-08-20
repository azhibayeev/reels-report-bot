import { describe, expect, it } from "vitest";
import { HOOK_LINE_CHARS, HOOK_MAX_LINES, wrapHook } from "../lib/farm/wrap";

describe("wrapHook", () => {
  it("режет по словам, не превышая лимит строки", () => {
    const lines = wrapHook("Jangan tunggu Ramadan untuk mulai");
    expect(lines).toEqual(["Jangan tunggu Ramadan", "untuk mulai"]);
    for (const line of lines!) expect(line.length).toBeLessThanOrEqual(HOOK_LINE_CHARS);
  });

  it(`не влезающий в ${HOOK_MAX_LINES} строк хук отвергается`, () => {
    expect(
      wrapHook(
        "satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas duabelas tigabelas empatbelas limabelas"
      )
    ).toBeNull();
  });

  it("слово длиннее строки отвергается: в кадре оно всё равно вылезет", () => {
    expect(wrapHook("Assalamualaikumwarahmatullahi")).toBeNull();
  });

  it("схлопывает лишние пробелы и переносы", () => {
    // При лимите 26 «Kamu sibuk? Justru itu» — это 22 знака, влезает целиком в одну строку.
    expect(wrapHook("  Kamu   sibuk?\n Justru itu  ")).toEqual(["Kamu sibuk? Justru itu"]);
  });

  it("ровно по лимиту — одна строка", () => {
    // Фикстура строится от константы: лимит меняется вместе с полями кадра, и
    // зашитое число превратило бы правку геометрии в загадочно красный тест.
    const hook = "Jangan tunggu keajaiban ya".slice(0, HOOK_LINE_CHARS).trim();
    expect(hook.length).toBeLessThanOrEqual(HOOK_LINE_CHARS);
    expect(wrapHook(hook)).toEqual([hook]);
  });

  it("на знак длиннее лимита — переносится на две строки", () => {
    const lines = wrapHook("Jangan tunggu keajaiban ini kawan")!;
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(HOOK_LINE_CHARS);
  });

  it("лимиты строки и числа строк настраиваются", () => {
    expect(wrapHook("  Kamu   sibuk?\n Justru itu  ", 12)).toEqual(["Kamu sibuk?", "Justru itu"]);
    expect(wrapHook("Kamu sibuk? Justru itu", 12, 1)).toBeNull();
  });
});
