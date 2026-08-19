import { describe, expect, it } from "vitest";
import { parseHookList } from "../lib/farm/parse";
import { assignSources, interleave, validateGroups } from "../lib/farm/start";

const file = (n: number) => ({ url: `https://blob/v${n}.mp4`, bytes: 1_000_000 });

describe("parseHookList", () => {
  it("режет по строкам и срезает нумерацию", () => {
    const hooks = parseHookList("1. Первый хук\n\n2. Второй хук\n3) Третий\n4 - Четвёртый");
    expect(hooks).toEqual(["Первый хук", "Второй хук", "Третий", "Четвёртый"]);
  });

  it("не съедает число, с которого начинается сам хук", () => {
    expect(parseHookList("2. 5 hal yang kamu kira haram")).toEqual(["5 hal yang kamu kira haram"]);
  });

  it("понимает маркеры списка и пустые строки между хуками", () => {
    expect(parseHookList("- Раз\n\n\n• Два\n   \n* Три")).toEqual(["Раз", "Два", "Три"]);
  });

  it("переживает \\r\\n из буфера обмена", () => {
    expect(parseHookList("1. Раз\r\n2. Два\r\n")).toEqual(["Раз", "Два"]);
  });
});

describe("assignSources", () => {
  it("раздаёт подложки по кругу, не повторяя пару хук+подложка", () => {
    const groups = [{ hooks: ["a", "b", "c", "d", "e"], caption: "опис" }];
    const { pairs, sources } = assignSources(groups, [file(1), file(2)]);

    expect(pairs).toHaveLength(5);
    expect(sources.map((s) => s.url)).toEqual([
      "https://blob/v1.mp4",
      "https://blob/v2.mp4",
      "https://blob/v1.mp4",
      "https://blob/v2.mp4",
      "https://blob/v1.mp4",
    ]);
    const combos = pairs.map((p, i) => `${p.hook}|${sources[i].url}`);
    expect(new Set(combos).size).toBe(combos.length);
  });

  it("описание группы попадает под каждый её ролик, круг подложек общий", () => {
    const groups = [
      { hooks: ["a1", "a2"], caption: "описание A" },
      { hooks: ["b1"], caption: "описание B" },
    ];
    const { pairs, sources } = assignSources(groups, [file(1), file(2)]);

    expect(pairs.map((p) => p.caption)).toEqual(["описание A", "описание A", "описание B"]);
    // Счётчик подложек сквозной: третий хук берёт первую подложку по второму кругу.
    expect(sources.map((s) => s.url)).toEqual([
      "https://blob/v1.mp4",
      "https://blob/v2.mp4",
      "https://blob/v1.mp4",
    ]);
  });

  it("без файлов ничего не собирает и не делит на ноль", () => {
    expect(assignSources([{ hooks: ["a"], caption: "c" }], [])).toEqual({ pairs: [], sources: [] });
  });
});

describe("interleave", () => {
  it("сохраняет связку хука со своей подложкой при перемешивании", () => {
    const assignment = assignSources(
      [{ hooks: ["a", "b", "c", "d"], caption: "опис" }],
      [file(1), file(2), file(3), file(4)]
    );
    const before = new Map(assignment.pairs.map((p, i) => [p.hook, assignment.sources[i].url]));

    // Обратный порядок: детерминированная перестановка вместо случайной.
    const mixed = interleave(assignment, () => 0);

    expect(mixed.pairs).toHaveLength(4);
    for (const [i, pair] of mixed.pairs.entries()) {
      expect(mixed.sources[i].url).toBe(before.get(pair.hook));
    }
  });

  it("порядок действительно меняется, а не возвращается как был", () => {
    const assignment = assignSources(
      [{ hooks: ["a", "b", "c", "d", "e"], caption: "опис" }],
      [file(1)]
    );
    const mixed = interleave(assignment, () => 0);
    expect(mixed.pairs.map((p) => p.hook)).not.toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("validateGroups", () => {
  it("чистая пачка проходит без ошибок", () => {
    expect(validateGroups([{ hooks: ["Короткий хук"], caption: "Описание" }], [file(1)])).toEqual([]);
  });

  it("хук с арабской лигатурой отклоняется с указанием знака", () => {
    const errors = validateGroups([{ hooks: ["Bukan dari Nabi ﷺ"], caption: "Описание" }], [file(1)]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ﷺ");
  });

  it("хук в 89 знаков проходит: ровно четыре строки", () => {
    const long = "Yang menjauhkan orang dari agama sering bukan agamanya, tapi aturan yang tidak pernah ada";
    expect(validateGroups([{ hooks: [long], caption: "Описание" }], [file(1)])).toEqual([]);
  });

  it("хук в 120 знаков уже не влезает", () => {
    const tooLong =
      "Sebagian larangan yang kamu pegang hari ini datang dari kebiasaan tetangga dan bukan dari dalil mana pun yang sahih";
    const errors = validateGroups([{ hooks: [tooLong], caption: "Описание" }], [file(1)]);
    expect(errors.some((e) => e.includes("не влезает"))).toBe(true);
  });

  it("нумерует ошибки по группе и месту хука в ней", () => {
    const errors = validateGroups(
      [
        { hooks: ["Нормальный"], caption: "Описание" },
        { hooks: ["Тоже нормальный", "Плохой 🔥"], caption: "Описание" },
      ],
      [file(1)]
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("группа 2");
    expect(errors[0]).toContain("хук 2");
  });

  it("пустое описание — ошибка: оно уходит в подпись каждого ролика", () => {
    const errors = validateGroups([{ hooks: ["Хук"], caption: "  " }], [file(1)]);
    expect(errors.some((e) => e.includes("описание пустое"))).toBe(true);
  });

  it("без видео и без хуков говорит об этом прямо", () => {
    expect(validateGroups([], []).sort()).toEqual([
      "не введено ни одного хука",
      "не выбрано ни одного видео",
    ]);
  });
});
