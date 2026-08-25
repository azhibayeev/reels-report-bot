import { describe, expect, it } from "vitest";
import { parseFarmCommand, parseRhythm } from "../lib/farm/commands";
import { RHYTHM_PRESETS } from "../lib/farm/pace";

describe("parseFarmCommand", () => {
  it("узнаёт /rhythm, в том числе с именем бота", () => {
    expect(parseFarmCommand("/rhythm")).toBe("rhythm");
    expect(parseFarmCommand("/rhythm@insta_otchet_bot плотно")).toBe("rhythm");
  });
});

describe("parseRhythm", () => {
  it("без аргумента показывает текущее", () => {
    expect(parseRhythm("/rhythm", RHYTHM_PRESETS)).toBe("show");
  });

  it("одно число — это зазор в минутах", () => {
    expect(parseRhythm("/rhythm 180", RHYTHM_PRESETS)).toBe(180);
  });

  it("пресеты переопределены под реальный потолок аккаунта", () => {
    // Прежние 30/45/90 минут на @daristeppe гарантированно приводят к блоку.
    expect(parseRhythm("/rhythm плотно", RHYTHM_PRESETS)).toBe(120);
    expect(parseRhythm("/rhythm обычно", RHYTHM_PRESETS)).toBe(180);
    expect(parseRhythm("/rhythm спокойно", RHYTHM_PRESETS)).toBe(240);
  });

  it("старую форму с двумя числами не принимает: второе теперь выводится", () => {
    // Молча взять первое число значило бы сделать не то, что человек написал.
    expect(parseRhythm("/rhythm 30 20", RHYTHM_PRESETS)).toBeNull();
  });

  it("мусор отвергает, а не толкует наугад", () => {
    expect(parseRhythm("/rhythm быстро", RHYTHM_PRESETS)).toBeNull();
    expect(parseRhythm("/rhythm -5", RHYTHM_PRESETS)).toBeNull();
    expect(parseRhythm("/rhythm 0", RHYTHM_PRESETS)).toBeNull();
  });
});
