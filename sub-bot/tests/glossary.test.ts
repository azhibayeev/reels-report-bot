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
