import { describe, expect, it } from "vitest";
import { HOOK_LINE_CHARS, wrapHook } from "../lib/farm/wrap";

describe("wrapHook", () => {
  it("режет по словам, не превышая лимит строки", () => {
    const lines = wrapHook("Jangan tunggu Ramadan untuk mulai");
    expect(lines).toEqual(["Jangan tunggu Ramadan", "untuk mulai"]);
    for (const line of lines!) expect(line.length).toBeLessThanOrEqual(HOOK_LINE_CHARS);
  });

  it("не влезающий в 4 строки хук отвергается", () => {
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

  it("ровно 26 знаков — одна строка", () => {
    const hook = "Jangan tunggu keajaiban ya";
    expect(hook.length).toBe(26);
    expect(wrapHook(hook)).toEqual(["Jangan tunggu keajaiban ya"]);
  });

  it("27 знаков — переносится на две строки", () => {
    const hook = "Jangan tunggu keajaiban ini";
    expect(hook.length).toBe(27);
    expect(wrapHook(hook)).toEqual(["Jangan tunggu keajaiban", "ini"]);
  });

  it("лимиты строки и числа строк настраиваются", () => {
    expect(wrapHook("  Kamu   sibuk?\n Justru itu  ", 12)).toEqual(["Kamu sibuk?", "Justru itu"]);
    expect(wrapHook("Kamu sibuk? Justru itu", 12, 1)).toBeNull();
  });
});
