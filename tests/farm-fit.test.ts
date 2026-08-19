import { describe, expect, it } from "vitest";
import { charsPerLine, fitHook, HOOK_SIZES } from "../lib/farm/wrap";

describe("charsPerLine", () => {
  it("на базовом кегле даёт исходные 26 знаков", () => {
    expect(charsPerLine(54)).toBe(26);
  });

  it("мельче кегль — больше знаков в строке", () => {
    const sizes = [...HOOK_SIZES];
    for (let i = 1; i < sizes.length; i += 1) {
      expect(charsPerLine(sizes[i])).toBeGreaterThan(charsPerLine(sizes[i - 1]));
    }
  });
});

describe("fitHook", () => {
  it("короткий хук рисуется самым крупным кеглем", () => {
    const fitted = fitHook("Ternyata boleh");
    expect(fitted?.fontSize).toBe(54);
    expect(fitted?.lines).toEqual(["Ternyata boleh"]);
  });

  it("длинный хук из группы 2 больше не отвергается, а мельчает", () => {
    const long =
      "Bayangkan seseorang bertanya kepadamu: mengapa Al-Qur'an diturunkan selama 23 tahun, bukan sekaligus dalam satu malam, dan kamu hanya diam.";
    const fitted = fitHook(long);
    expect(fitted).not.toBeNull();
    expect(fitted!.fontSize).toBeLessThan(54);
    expect(fitted!.lines.length).toBeLessThanOrEqual(4);
    expect(fitted!.lines.join(" ")).toBe(long);
  });

  it("берёт самый крупный из подходящих, а не первый попавшийся", () => {
    const hook = "Yang haram sudah jelas. Sisanya jangan ditambah sendiri";
    const fitted = fitHook(hook)!;
    const bigger = HOOK_SIZES.filter((s) => s > fitted.fontSize);
    for (const size of bigger) {
      const linesAtBigger = Math.ceil(hook.length / charsPerLine(size));
      expect(linesAtBigger).toBeGreaterThan(4);
    }
  });

  it("чрезмерный хук всё же отвергается — это честный отказ", () => {
    const absurd = "слово ".repeat(80);
    expect(fitHook(absurd)).toBeNull();
  });
});
