import { describe, it, expect } from "vitest";
import { buildAss, assTime, escapeText } from "../lib/ass";
import { SUBTITLE_FONTSIZE } from "../lib/cues";
import type { Cue } from "../lib/cues";

const cue = (over: Partial<Cue> = {}): Cue => ({
  i: 1, start: 0.42, end: 2.61, ru: "Читай дуа",
  id: "Bacalah doa ini", needsManual: false, warning: null, ...over,
});

describe("assTime", () => {
  it("форматирует ноль", () => expect(assTime(0)).toBe("0:00:00.00"));
  it("форматирует сотые", () => expect(assTime(2.61)).toBe("0:00:02.61"));
  it("переходит через минуту", () => expect(assTime(61.5)).toBe("0:01:01.50"));
  it("переходит через час", () => expect(assTime(3661.25)).toBe("1:01:01.25"));

  it("округление сотых не даёт .100, а переносит секунду (2.999с)", () => {
    // Наивное Math.round((sec % 1) * 100) на 2.999 даёт 100 сотых. Если их
    // просто откусить до 99 — получим 2.99, тихо потеряв точность без
    // причины. Правильный перенос: 2.999с округляется целиком до 3.00с.
    expect(assTime(2.999)).toBe("0:00:03.00");
  });

  it("перенос сотых при округлении тянет за собой минуту (59.999с)", () => {
    expect(assTime(59.999)).toBe("0:01:00.00");
  });

  it("перенос сотых при округлении тянет за собой час (3599.999с)", () => {
    expect(assTime(3599.999)).toBe("1:00:00.00");
  });

  it("бросает понятную ошибку на NaN, а не тихо печатает NaN:NaN:NaN.NaN", () => {
    expect(() => assTime(NaN)).toThrow(/NaN/);
  });

  it("бросает понятную ошибку на Infinity, а не тихо печатает Infinity:NaN:NaN.NaN", () => {
    expect(() => assTime(Infinity)).toThrow(/Infinity/);
  });

  it("бросает понятную ошибку и на -Infinity", () => {
    expect(() => assTime(-Infinity)).toThrow(/Infinity/);
  });
});

describe("escapeText", () => {
  it("экранирует фигурные скобки", () => {
    expect(escapeText("a {b} c")).toBe("a \\{b\\} c");
  });
  it("превращает перевод строки в \\N", () => {
    expect(escapeText("a\nb")).toBe("a\\Nb");
  });
});

describe("buildAss", () => {
  it("кладёт имя семейства и кегль SUBTITLE_FONTSIZE в стиль", () => {
    expect(buildAss([cue()], "Plus Jakarta Sans ExtraBold"))
      .toContain(`Style: Sub,Plus Jakarta Sans ExtraBold,${SUBTITLE_FONTSIZE},`);
  });

  it("пишет полный набор 23 полей в Format стиля", () => {
    const out = buildAss([cue()], "F");
    expect(out).toContain(
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"
    );
    const styleLine = out.split("\n").find((l) => l.startsWith("Style: Sub,"));
    expect(styleLine).toBeDefined();
    expect(styleLine!.split(",")).toHaveLength(23);
  });

  it("держит WrapStyle 2 и разрешение кадра", () => {
    const out = buildAss([cue()], "F");
    expect(out).toContain("WrapStyle: 2");
    expect(out).toContain("PlayResX: 1080");
    expect(out).toContain("PlayResY: 1920");
  });

  it("даёт по строке Dialogue на реплику", () => {
    const out = buildAss([cue({ i: 1 }), cue({ i: 2, id: "Kedua" })], "F");
    expect(out.split("\n").filter((l) => l.startsWith("Dialogue:"))).toHaveLength(2);
  });

  it("ставит \\N там, где решил fitLines", () => {
    const out = buildAss([cue({ id: "Bacalah doa ini setelah sholat" })], "F");
    expect(out).toMatch(/Dialogue:.*\\N/);
  });

  it("печатает одной строкой то, что fitLines не смог разбить (null)", () => {
    // Та же фраза, что в tests/cues.test.ts возвращает null из fitLines —
    // buildAss не должен молча ломать её по-своему, а обязан отдать текст
    // одной строкой без \N.
    const text = "Ini kalimat yang sangat panjang sekali dan tidak muat";
    const out = buildAss([cue({ id: text })], "F");
    const line = out.split("\n").find((l) => l.startsWith("Dialogue:"));
    expect(line).toBeDefined();
    expect(line).not.toContain("\\N");
    expect(line).toContain(text);
  });

  it("пропускает реплики без перевода", () => {
    const out = buildAss([cue({ id: null, needsManual: true })], "F");
    expect(out.split("\n").filter((l) => l.startsWith("Dialogue:"))).toHaveLength(0);
  });

  it("экранирует фигурные скобки в тексте реплики", () => {
    const out = buildAss([cue({ id: "Halo {dunia}" })], "F");
    expect(out).toContain("Halo \\{dunia\\}");
  });

  it("использует assTime для начала и конца реплики", () => {
    const out = buildAss([cue({ start: 0.42, end: 2.61 })], "F");
    expect(out).toContain(`Dialogue: 0,${assTime(0.42)},${assTime(2.61)},Sub,,0,0,0,,`);
  });
});
