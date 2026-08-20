import { describe, it, expect } from "vitest";
import { loadGlossary, relevant } from "../lib/glossary";

describe("глоссарий", () => {
  it("загружается и не пуст", () => {
    expect(loadGlossary().length).toBeGreaterThanOrEqual(25);
  });

  it("отдаёт только записи, встретившиеся в тексте", () => {
    const r = relevant(loadGlossary(), "Читай дуа после намаза");
    const ids = r.map((e) => e.id);
    expect(ids).toContain("doa");
    expect(ids).toContain("sholat");
    expect(ids).not.toContain("zakat");
  });

  it("на тексте без терминов отдаёт пустой список", () => {
    expect(relevant(loadGlossary(), "Сегодня хорошая погода")).toHaveLength(0);
  });
});

// Фикс-раунд 2, находка 5: relevant() матчил триггер голой подстрокой без
// границ слова — "ад" ловился внутри "садака"/"хадис"/"награда"/
// "тахаджуд", "Пророк" — внутри "лжепророк". Это подмешивало в промпт
// нерелевантные записи и заставляло валидатор требовать "neraka" в
// переводе фразы про садаку. Починено границей \p{L} (см. lib/glossary.ts,
// matchesTrigger), а недостающие словоформы дописаны прямо в глоссарий.
describe("relevant() — граница слова, не голая подстрока", () => {
  const idsOf = (ru: string) => relevant(loadGlossary(), ru).map((e) => e.id);

  it("не подтягивает запись про ад на фразах, где «ад» — часть другого слова", () => {
    expect(idsOf("Раздай садаку")).not.toContain("neraka");
    expect(idsOf("Передан хадис")).not.toContain("neraka");
    expect(idsOf("Это большая награда")).not.toContain("neraka");
    expect(idsOf("Молитва тахаджуд")).not.toContain("neraka");
  });

  it("не подтягивает запись про Пророка на слове «лжепророк»", () => {
    expect(idsOf("Он оказался лжепророк")).not.toContain("Nabi Muhammad SAW");
  });

  it("подтягивает нужные записи на добавленных словоформах — «читай аяты», «в суре», «в мечети», «о Пророке»", () => {
    expect(idsOf("Читай эти аяты")).toContain("ayat");
    expect(idsOf("В суре Аль-Бакара сказано")).toContain("surah");
    expect(idsOf("Собрались в мечети")).toContain("masjid");
    expect(idsOf("Расскажи о Пророке")).toContain("Nabi Muhammad SAW");
  });

  it("настоящий ад (не как часть другого слова) по-прежнему ловится", () => {
    expect(idsOf("Он попадёт в ад")).toContain("neraka");
    expect(idsOf("Он попадёт в аду")).toContain("neraka");
  });
});
