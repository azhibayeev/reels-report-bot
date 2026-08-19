import { describe, expect, it } from "vitest";
import { parseFarmCommand, parseRhythm } from "../lib/farm/commands";
import { isRhythm, MAX_PER_DAY, MIN_SLOT_MINUTES, RHYTHM_PRESETS } from "../lib/farm/style";

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

  it("понимает пресеты", () => {
    expect(parseRhythm("/rhythm плотно", RHYTHM_PRESETS)).toEqual({ minutes: 30, perDay: 20 });
    expect(parseRhythm("/rhythm спокойно", RHYTHM_PRESETS)).toEqual({ minutes: 90, perDay: 8 });
  });

  it("понимает пару чисел", () => {
    expect(parseRhythm("/rhythm 25 24", RHYTHM_PRESETS)).toEqual({ minutes: 25, perDay: 24 });
  });

  it("мусор отвергает, а не толкует наугад", () => {
    expect(parseRhythm("/rhythm быстро", RHYTHM_PRESETS)).toBeNull();
    expect(parseRhythm("/rhythm 30", RHYTHM_PRESETS)).toBeNull();
  });
});

describe("isRhythm", () => {
  it("отбивает слишком частый выпуск и перебор за день", () => {
    expect(isRhythm({ minutes: MIN_SLOT_MINUTES - 1, perDay: 10 })).toBe(false);
    expect(isRhythm({ minutes: 45, perDay: MAX_PER_DAY + 1 })).toBe(false);
    expect(isRhythm({ minutes: 45, perDay: 0 })).toBe(false);
  });

  it("принимает нормальные значения и пресеты", () => {
    expect(isRhythm({ minutes: 45, perDay: 15 })).toBe(true);
    for (const preset of Object.values(RHYTHM_PRESETS)) expect(isRhythm(preset)).toBe(true);
  });

  it("мусор из Blob не проходит", () => {
    expect(isRhythm(null)).toBe(false);
    expect(isRhythm({ minutes: "45", perDay: 15 })).toBe(false);
    expect(isRhythm({ minutes: Number.NaN, perDay: 15 })).toBe(false);
  });
});
