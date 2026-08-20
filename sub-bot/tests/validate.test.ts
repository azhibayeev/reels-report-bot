import { describe, it, expect } from "vitest";
import { validateCue, validateSpelling } from "../lib/validate";
import { loadGlossary } from "../lib/glossary";
import type { Cue } from "../lib/cues";

const G = loadGlossary();
const cue = (ru: string, id: string | null): Cue => ({
  i: 1, start: 0, end: 2, ru, id, needsManual: false, warning: null,
});

describe("validateCue", () => {
  it("пропускает корректный перевод", () => {
    expect(validateCue(cue("Читай дуа", "Bacalah doa"), G)).toBeNull();
  });

  it("ловит запрещённый вариант dua", () => {
    expect(validateCue(cue("Читай дуа", "Bacalah dua"), G)).toMatch(/dua/);
  });

  it("не считает berdua запрещённым — это другое слово", () => {
    expect(validateCue(cue("Они вдвоём", "Mereka berdua"), G)).toBeNull();
  });

  it("запрещённый вариант ищется строго по границе слова: dua внутри berdua не считается", () => {
    // В отличие от предыдущего теста, здесь ru СОДЕРЖИТ триггер «дуа» —
    // запись doa попадает в relevant(), и id реально проверяется. "dua"
    // спрятано ВНУТРИ "berdua", но это не отдельное слово — containsWord
    // не должен принять его за запрещённый вариант. Сообщение всё равно
    // будет (в переводе нет корня "doa" — другая проверка), но не с
    // пометкой "запрещённый вариант".
    const msg = validateCue(cue("Они читают дуа", "Mereka berdua"), G);
    expect(msg).not.toMatch(/запрещённый вариант/);
    expect(msg).toMatch(/doa/);
  });

  it("требует целевой термин, если исходный есть", () => {
    expect(validateCue(cue("Читай дуа", "Bacalah sesuatu"), G)).toMatch(/doa/);
  });

  it("засчитывает термин с индонезийским аффиксом", () => {
    expect(validateCue(cue("Читай дуа", "Berdoalah sekarang"), G)).toBeNull();
  });

  it("требует SAW при упоминании Пророка", () => {
    expect(validateCue(cue("Пророк сказал", "Nabi Muhammad bersabda"), G)).toMatch(/SAW/);
  });

  it("принимает перевод с SAW", () => {
    expect(validateCue(cue("Пророк сказал", "Nabi Muhammad SAW bersabda"), G)).toBeNull();
  });

  it("ловит Tuhan вместо Allah", () => {
    expect(validateCue(cue("Аллах милостив", "Tuhan maha pengasih"), G)).toMatch(/Tuhan/);
  });

  it("ловит блок, который не влезает в кадр — по измеренной ширине, не по числу знаков", () => {
    const long = "Ini kalimat yang sangat panjang sekali dan sama sekali tidak muat";
    const msg = validateCue(cue("Длинно", long), G);
    expect(msg).toMatch(/кадр/i);
    expect(msg).toMatch(/px/);
    expect(msg).not.toMatch(/знаков при потолке/i); // не старое сообщение по числу знаков
  });

  it("ловит слишком быструю реплику", () => {
    const c: Cue = { ...cue("Быстро", "Bacalah doa ini setelah sholat"), start: 0, end: 1.0 };
    expect(validateCue(c, G)).toMatch(/быстро|секунд/i);
  });

  it("реплику без перевода не проверяет терминами", () => {
    expect(validateCue({ ...cue("Бисмилляхи", null), needsManual: true }, G)).toBeNull();
  });

  // Особое внимание: терминологию с ручного текста снимаем (человек вписал
  // осознанно), но геометрия и скорость чтения — это физика кадра, а не
  // богословие, и остаются в силе даже на needsManual-репликах. Штатный
  // путь ведёт прямо в ловушку: коранический блок ждёт ручного текста, а
  // дуа руками легко даёт 150–200 знаков на блок в 2.4 секунды — без
  // проверки это отрендерится молча и нечитаемо.
  describe("геометрия и скорость на ручном тексте (needsManual: true)", () => {
    it("ловит ширину на длинной дуа, вписанной руками — 146 знаков за 2.4с", () => {
      const manualDua =
        "Ya Allah, jadikanlah kami dari golongan hamba-hamba-Mu yang senantiasa " +
        "bersyukur, bersabar dan istiqomah di jalan-Mu hingga akhir hayat kami nanti";
      const c: Cue = {
        i: 1, start: 0, end: 2.4, ru: "Дуа после намаза",
        id: manualDua, needsManual: true, warning: null,
      };
      const msg = validateCue(c, G);
      expect(msg).not.toBeNull();
      expect(msg).toMatch(/кадр|px/i);
    });

    it("ловит скорость чтения на ручном тексте, даже если ширина в порядке", () => {
      // "Bacalah doa ini setelah sholat" укладывается по ширине в две
      // строки (проверено измерением), но 30 знаков за 1с — это далеко
      // за потолком MAX_CPS(17), и needsManual это не извиняет.
      const c: Cue = {
        i: 1, start: 0, end: 1.0, ru: "Читай",
        id: "Bacalah doa ini setelah sholat", needsManual: true, warning: null,
      };
      expect(validateCue(c, G)).toMatch(/быстро|секунд/i);
    });

    it("терминологию на ручном тексте не спрашивает, если геометрия и скорость в порядке", () => {
      // Контрастный случай: короткий ручной текст без целевого термина —
      // needsManual действительно снимает только терминологическую
      // проверку, не более того.
      const c: Cue = {
        i: 1, start: 0, end: 2.0, ru: "Читай дуа",
        id: "Bacalah sesuatu", needsManual: true, warning: null,
      };
      expect(validateCue(c, G)).toBeNull();
    });
  });
});

describe("validateSpelling", () => {
  it("ловит два режима написания в одном ролике", () => {
    const cues = [cue("а", "Bacalah sholat"), { ...cue("б", "Setelah salat"), i: 2 }];
    expect(validateSpelling(cues)).toMatch(/sholat|salat/);
  });

  it("на едином режиме молчит", () => {
    const cues = [cue("а", "Bacalah sholat"), { ...cue("б", "Setelah sholat"), i: 2 }];
    expect(validateSpelling(cues)).toBeNull();
  });
});
