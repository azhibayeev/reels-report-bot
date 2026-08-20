import { describe, expect, it } from "vitest";
import { drawHookPng } from "../lib/farm/text-image";
import { fitHook, HOOK_MAX_LINES } from "../lib/farm/wrap";

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
    expect(long.lines.length).toBeLessThanOrEqual(HOOK_MAX_LINES);
  });

  it("перенос идёт по словам и сохраняет текст целиком", () => {
    const hook = "Kamu tidak berdosa. Kamu cuma salah informasi";
    const drawn = drawHookPng(hook, FONT)!;
    expect(drawn.lines.join(" ")).toBe(hook);
  });

  it("всё, что пропускает страница пачки, рендер обязан нарисовать", () => {
    // Два разных счёта одной величины: страница крутится в браузере и меряет
    // хук прикидкой в знаках (fitHook), рендер — настоящей метрикой шрифта.
    // Разъехались они однажды уже: поля кадра выросли, прикидка осталась от
    // прежних, и хук проходил проверку, а падал на сборке — после скачивания
    // подложки, сообщением в чат. Инвариант держит прикидку строгой стороной.
    const hooks = [
      "Ternyata boleh",
      "Jangan tunggu Ramadan untuk mulai berubah",
      "POV: Kamu baru saja selesai salat, lalu kamu sadar...",
      "Yang menjauhkan orang dari agama sering bukan agamanya, tapi aturan yang tidak pernah ada",
      "Bayangkan kamu seorang Muslim dan seseorang bertanya: mengapa kita membaca Al-Fatihah di setiap rakaat, dan kamu tidak tahu jawabannya.",
      "Sebagian larangan yang kamu pegang hari ini datang dari kebiasaan tetangga dan bukan dari dalil mana pun yang sahih dan bisa kamu tunjukkan kepada siapa pun",
      // Хук у самой границы: на мельчайшем кегле рендеру уже некуда отступать,
      // и разрыв между прикидкой и метрикой вылезает именно здесь.
      "Sebagian larangan yang kamu pegang dengan yakin hari ini sebenarnya datang dari kebiasaan tetangga dan bukan dari dalil mana pun yang sahih, dan tidak ada satu orang pun yang pernah menunjukkannya kepadamu",
      "a ".repeat(90).trim(),
    ];
    for (const hook of hooks) {
      if (!fitHook(hook)) continue; // страница отказала — рендер и не позовут
      const drawn = drawHookPng(hook, FONT);
      expect(drawn, `прикидка пропустила, а рендер не смог: ${hook.slice(0, 40)}…`).not.toBeNull();
      expect(drawn!.lines.length).toBeLessThanOrEqual(HOOK_MAX_LINES);
      expect(drawn!.lines.join(" ")).toBe(hook.replace(/\s+/g, " ").trim());
    }
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
