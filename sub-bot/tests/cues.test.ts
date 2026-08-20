import { describe, it, expect } from "vitest";
import { buildCues, fitLines, LINE_MAX_PX, MAX_DUR_SEC } from "../lib/cues";
import { measureWidth } from "../lib/textwidth";
import type { Word } from "../lib/cues";

const w = (text: string, start: number, end: number): Word => ({ text, start, end });

describe("buildCues", () => {
  it("режет блок по паузе длиннее 300 мс", () => {
    const cues = buildCues([w("Читай", 0, 0.4), w("дуа", 0.4, 0.8), w("после", 1.3, 1.7)]);
    expect(cues).toHaveLength(2);
    expect(cues[0].ru).toBe("Читай дуа");
    expect(cues[1].ru).toBe("после");
  });

  it("не режет по паузе короче 300 мс", () => {
    const cues = buildCues([w("Читай", 0, 0.4), w("дуа", 0.6, 1.0)]);
    expect(cues).toHaveLength(1);
  });

  it("режет по концу предложения даже без паузы", () => {
    const cues = buildCues([w("Читай.", 0, 0.4), w("Потом", 0.45, 0.9)]);
    expect(cues).toHaveLength(2);
  });

  it("режет блок, который вышел длиннее потолка длительности", () => {
    const words: Word[] = [];
    for (let i = 0; i < 10; i++) words.push(w(`слово${i}`, i * 0.5, i * 0.5 + 0.45));
    const cues = buildCues(words);
    for (const c of cues) expect(c.end - c.start).toBeLessThanOrEqual(MAX_DUR_SEC + 0.001);
  });

  it("нумерует реплики с единицы и подряд", () => {
    const cues = buildCues([w("раз.", 0, 0.4), w("два.", 0.8, 1.2), w("три.", 1.6, 2.0)]);
    expect(cues.map((c) => c.i)).toEqual([1, 2, 3]);
  });

  it("оставляет зазор между соседними блоками", () => {
    const cues = buildCues([w("раз.", 0, 0.5), w("два", 0.55, 1.6)]);
    expect(cues[1].start - cues[0].end).toBeGreaterThanOrEqual(0.05);
  });

  it("тянет слишком короткий блок до нижней границы", () => {
    const cues = buildCues([w("Да.", 0, 0.2)]);
    expect(cues[0].end - cues[0].start).toBeGreaterThanOrEqual(0.9);
  });

  it("на пустом входе возвращает пустой список", () => {
    expect(buildCues([])).toEqual([]);
  });
});

// Границы взяты не на глаз, а замером measureWidth на реальном шрифте
// (кегль 106, см. LINE_MAX_PX = 820 в lib/cues.ts, Ruling 8 плана).
// Символы в тексте могут занимать от 1 до 1.7× друг друга по ширине,
// поэтому фразы ниже подобраны так, чтобы граница фактически проходила
// там, где ожидает тест, а не «примерно».
describe("fitLines", () => {
  it("короткую фразу оставляет одной строкой", () => {
    expect(fitLines("Bacalah doa")).toEqual(["Bacalah doa"]);
  });

  it("ломает на две строки по ширине, обе строки в пределах LINE_MAX_PX", () => {
    const lines = fitLines("Bacalah doa ini setelah sholat");
    expect(lines).not.toBeNull();
    expect(lines!.length).toBe(2);
    for (const l of lines!) expect(measureWidth(l, 106)).toBeLessThanOrEqual(LINE_MAX_PX);
  });

  it("ставит разрыв перед союзом, а не после", () => {
    // Общая ширина (1385.6px) не влезает в одну строку 820px; разрыв перед
    // союзом "karena" даёт "Tetaplah bersabar" (569px) и "karena Allah
    // mencintaimu" (805px) — обе строки влезают, поэтому предпочтённая
    // союзная позиция выигрывает первой же проверкой (замерено).
    const lines = fitLines("Tetaplah bersabar karena Allah mencintaimu");
    expect(lines).not.toBeNull();
    expect(lines!.length).toBe(2);
    expect(lines![1].startsWith("karena")).toBe(true);
    for (const l of lines!) expect(measureWidth(l, 106)).toBeLessThanOrEqual(LINE_MAX_PX);
  });

  it("не разрывает редупликацию через дефис", () => {
    const lines = fitLines("Jagalah anak-anak kalian dengan sabar");
    expect(lines).not.toBeNull();
    for (const l of lines!) {
      expect(l.startsWith("-")).toBe(false);
      expect(l.endsWith("-")).toBe(false);
    }
  });

  it("возвращает null, если текст не влезает ни в какую разбивку на две строки", () => {
    expect(fitLines("Ini kalimat yang sangat panjang sekali dan tidak muat")).toBeNull();
  });

  it("возвращает null на слове длиннее строки", () => {
    expect(fitLines("mempertanggungjawabkan kepada")).toBeNull();
  });
});
