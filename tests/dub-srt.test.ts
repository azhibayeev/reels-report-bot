import { describe, expect, it } from "vitest";
import { parseSrt, trimOverlaps } from "../lib/dub/srt";

// Кусок настоящего ответа ElevenLabs: перевод уже разбит на реплики с таймингами.
const REAL = `1
00:00:00,739 --> 00:00:05,335
Panggilan untuk semua followers yang jago
editing dan mampu membuat video seperti

2
00:00:05,335 --> 00:00:09,529
ini, serta bisa bikin subtitle serupa,
tolong segera DM gue ya. Atau kalau
`;

describe("parseSrt", () => {
  it("разбирает ответ ElevenLabs и склеивает перенос в одну реплику", () => {
    const cues = parseSrt(REAL);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({
      startSec: 0.739,
      endSec: 5.335,
      text: "Panggilan untuk semua followers yang jago editing dan mampu membuat video seperti",
    });
    expect(cues[1].startSec).toBe(5.335);
  });

  it("понимает WebVTT: он отличается точкой вместо запятой и отсутствием номера", () => {
    const cues = parseSrt("WEBVTT\n\n00:00:01.500 --> 00:00:02.250\nHalo\n");
    expect(cues).toEqual([{ startSec: 1.5, endSec: 2.25, text: "Halo" }]);
  });

  it("часы и трёхзначные доли не теряются", () => {
    const cues = parseSrt("1\n01:02:03,040 --> 01:02:04,000\nlama\n");
    expect(cues[0].startSec).toBeCloseTo(3723.04, 3);
  });

  it("кривую реплику пропускает, а не роняет весь файл — лучше часть субтитров, чем ни одной", () => {
    const cues = parseSrt("1\nне тайминг\nтекст\n\n2\n00:00:01,000 --> 00:00:02,000\nOke\n");
    expect(cues).toEqual([{ startSec: 1, endSec: 2, text: "Oke" }]);
  });

  it("пустые и нулевой длины выбрасывает: показать их всё равно нельзя", () => {
    expect(parseSrt("1\n00:00:01,000 --> 00:00:02,000\n\n\n2\n00:00:03,000 --> 00:00:03,000\nOke\n")).toEqual([]);
  });

  it("теги разметки в кадр не попадают", () => {
    expect(parseSrt("1\n00:00:01,000 --> 00:00:02,000\n<i>Halo</i> <b>dunia</b>\n")[0].text).toBe("Halo dunia");
  });

  it("порядок восстанавливает по времени, а не по номеру", () => {
    const cues = parseSrt("2\n00:00:05,000 --> 00:00:06,000\nB\n\n1\n00:00:01,000 --> 00:00:02,000\nA\n");
    expect(cues.map((c) => c.text)).toEqual(["A", "B"]);
  });

  it("на пустом входе молчит, а не падает", () => {
    expect(parseSrt("")).toEqual([]);
  });
});

describe("trimOverlaps", () => {
  it("подрезает наложение: два блока текста в одном кадре читать невозможно", () => {
    const cues = trimOverlaps([
      { startSec: 0, endSec: 3, text: "A" },
      { startSec: 2, endSec: 4, text: "B" },
    ]);
    expect(cues).toEqual([
      { startSec: 0, endSec: 2, text: "A" },
      { startSec: 2, endSec: 4, text: "B" },
    ]);
  });

  it("реплику, полностью накрытую следующей, выбрасывает — окна у неё не осталось", () => {
    const cues = trimOverlaps([
      { startSec: 2, endSec: 3, text: "A" },
      { startSec: 2, endSec: 4, text: "B" },
    ]);
    expect(cues.map((c) => c.text)).toEqual(["B"]);
  });

  it("непересекающиеся не трогает", () => {
    const cues = [
      { startSec: 0, endSec: 1, text: "A" },
      { startSec: 2, endSec: 3, text: "B" },
    ];
    expect(trimOverlaps(cues)).toEqual(cues);
  });
});
