import { describe, it, expect } from "vitest";
import { buildCues, fitLines, LINE_MAX_PX, MAX_DUR_SEC, MIN_DUR_SEC, GAP_SEC } from "../lib/cues";
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
    // Гэп после "Читай." (1.02-1.0=0.02с) специально мал, но собственная
    // длительность каждой группы уже ≥ MIN_DUR_SEC — растяжение до нижней
    // границы никого не толкает на соседа, поэтому тест проверяет именно
    // разрез по концу предложения, а не заодно и слияние из Ruling 10.
    const cues = buildCues([w("Читай.", 0, 1.0), w("Потом", 1.02, 1.5)]);
    expect(cues).toHaveLength(2);
  });

  it("splitLongGroup режет по наибольшей внутренней паузе, а не в точке переполнения (Ruling 11)", () => {
    // Без пауз ≥300мс и без пунктуации основной цикл buildCues ни разу не
    // остановится — вся цепочка выйдет одной группой длиннее MAX_DUR_SEC
    // (2.74с > 2.6с), и порезать её обязан splitLongGroup. Пауза между w2 и
    // w3 (0.26с) заметно больше остальных (0.02с), но меньше PAUSE_BREAK_SEC
    // (0.3с) — единственная причина разреза именно тут это работа
    // splitLongGroup, а не случайное слово, на котором истёк лимит.
    const words: Word[] = [
      w("w0", 0.0, 0.4),
      w("w1", 0.42, 0.82),
      w("w2", 0.84, 1.24),
      w("w3", 1.5, 1.9),
      w("w4", 1.92, 2.32),
      w("w5", 2.34, 2.74),
    ];
    const cues = buildCues(words);
    expect(cues).toHaveLength(2);
    expect(cues[0].ru).toBe("w0 w1 w2");
    expect(cues[1].ru).toBe("w3 w4 w5");
    expect(cues[0].end).toBeCloseTo(1.24, 9);
    expect(cues[1].start).toBeCloseTo(1.5, 9);
  });

  it("режет блок, который вышел длиннее потолка длительности (инвариант по всем результирующим репликам)", () => {
    // Паузы намеренно не одинаковые (в отличие от старой версии теста) —
    // после Ruling 11 splitLongGroup режет по САМОЙ БОЛЬШОЙ паузе, а не
    // делит пополам, и на связке из одинаковых пауз рекурсия съезжает в
    // вырожденное «отгрызание по одному слову с фронта», которое потом
    // склеивает enforceTiming обратно почти в один блок — не то, что
    // проверяет этот тест.
    const words: Word[] = [
      w("a0", 0.0, 0.5),
      w("a1", 0.55, 1.05),
      w("a2", 1.3, 1.8),
      w("a3", 1.85, 2.35),
      w("a4", 2.4, 2.9),
      w("a5", 3.2, 3.7),
    ];
    const cues = buildCues(words);
    for (const c of cues) expect(c.end - c.start).toBeLessThanOrEqual(MAX_DUR_SEC + 0.001);
  });

  it("рекурсия splitLongGroup завершается на группе из двух слов без паузы", () => {
    // Каждое слово само по себе длиннее MAX_DUR_SEC — делить его уже
    // невозможно (group.length < 2 останавливает рекурсию), несмотря на то
    // что после разреза длительность отдельного слова всё ещё выше потолка.
    // Проверяем, что вызов вообще завершается и не рекурсирует бесконечно.
    const cues = buildCues([w("long0", 0, 3.0), w("long1", 3.0, 6.0)]);
    expect(cues).toHaveLength(2);
    expect(cues[0].ru).toBe("long0");
    expect(cues[1].ru).toBe("long1");
  });

  it("нумерует реплики с единицы и подряд", () => {
    const cues = buildCues([w("раз.", 0, 1.0), w("два.", 1.1, 2.1), w("три.", 2.2, 3.2)]);
    expect(cues.map((c) => c.i)).toEqual([1, 2, 3]);
  });

  it("сливает блоки, если растянутый до MIN_DUR_SEC конец залезает на следующий (Ruling 10)", () => {
    // Старый код в этом сценарии тихо нарушал MIN_DUR_SEC: растягивал
    // cues[0] до 0.9, а затем сжимал обратно до 0.45, чтобы освободить
    // зазор перед cues[1]. Разрыв между блоками меньше 0.9с — это одно
    // высказывание, а не два субтитра, поэтому правильный результат — один
    // слитый блок, а не два блока с заниженной длительностью.
    const cues = buildCues([w("раз.", 0, 0.5), w("два", 0.55, 1.6)]);
    expect(cues).toHaveLength(1);
    expect(cues[0].ru).toBe("раз. два");
    expect(cues[0].start).toBe(0);
    expect(cues[0].end).toBe(1.6);
    expect(cues[0].end - cues[0].start).toBeGreaterThanOrEqual(MIN_DUR_SEC);
  });

  it("подтягивает зазор между блоками до GAP_SEC, если сливать не пришлось", () => {
    // Естественный зазор между группами здесь всего 0.02с (< GAP_SEC), но
    // обе группы уже длиннее MIN_DUR_SEC поодиночке, так что слияние
    // (Ruling 10, приоритет 1) не требуется — остаётся самый слабый,
    // третий приоритет: подтянуть зазор к GAP_SEC, не опускаясь ниже
    // MIN_DUR_SEC для cues[0]. toBeCloseTo — вычитание next.start-GAP_SEC
    // и обратно даёт погрешность на уровне последнего бита double.
    const cues = buildCues([w("Раз.", 0, 1.0), w("Два.", 1.02, 2.5)]);
    expect(cues).toHaveLength(2);
    expect(cues[1].start - cues[0].end).toBeCloseTo(GAP_SEC, 5);
    expect(cues[0].end - cues[0].start).toBeGreaterThanOrEqual(MIN_DUR_SEC);
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
