import { describe, expect, it } from "vitest";
import { drawHookPng } from "../lib/farm/text-image";

const FONT = "assets/hook.ttf";

describe("drawHookPng", () => {
  it("возвращает настоящий PNG", () => {
    const drawn = drawHookPng("Jangan tunggu Ramadan", FONT)!;
    expect(drawn).not.toBeNull();
    // Сигнатура PNG: без неё ffmpeg молча получит мусор вместо картинки.
    expect(drawn.png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(drawn.png.length).toBeGreaterThan(1000);
  });

  it("короткий хук рисуется самым крупным кеглем, длинный — мельче", () => {
    const short = drawHookPng("Ternyata boleh", FONT)!;
    const long = drawHookPng(
      "Bayangkan seseorang bertanya kepadamu dengan sungguh-sungguh: mengapa perempuan mengganti puasa tetapi tidak mengganti salat, dan kamu sama sekali tidak tahu dalilnya",
      FONT
    )!;
    expect(short.fontSize).toBe(54);
    expect(long.fontSize).toBeLessThan(short.fontSize);
    expect(long.lines.length).toBeLessThanOrEqual(4);
  });

  it("перенос идёт по словам и сохраняет текст целиком", () => {
    const hook = "Kamu tidak berdosa. Kamu cuma salah informasi";
    const drawn = drawHookPng(hook, FONT)!;
    expect(drawn.lines.join(" ")).toBe(hook);
  });

  it("замер по метрике шрифта даёт больше знаков, чем прежний коэффициент", () => {
    // Раньше в строку клали 26 знаков по прикидке; настоящая ширина позволяет ~31.
    const drawn = drawHookPng("Bayangkan seseorang bertanya kepada", FONT)!;
    expect(drawn.lines[0].length).toBeGreaterThan(26);
  });

  it("чрезмерный хук отвергается, а не рисуется нечитаемым", () => {
    expect(drawHookPng("kata ".repeat(80), FONT)).toBeNull();
  });

  it("разные позиции дают разные картинки", () => {
    const top = drawHookPng("Satu dua tiga", FONT, "top")!;
    const bottom = drawHookPng("Satu dua tiga", FONT, "bottom")!;
    expect(top.png.equals(bottom.png)).toBe(false);
  });
});
