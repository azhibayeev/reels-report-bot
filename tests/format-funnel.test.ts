import { describe, it, expect } from "vitest";
import { formatFunnelCaption } from "../lib/format";
import { FunnelSeries } from "../lib/types";

const series = (over: Partial<FunnelSeries> = {}): FunnelSeries => ({
  published: [],
  views: [],
  joins: [],
  store: [],
  ...over,
});

const DAY = "2026-08-26";

describe("подпись к графику воронки", () => {
  it("повторяет текстом последний день всех трёх уровней", () => {
    const caption = formatFunnelCaption(
      "@daristeppe",
      DAY,
      series({
        published: [{ date: "2026-08-25", value: 17 }, { date: DAY, value: 16 }],
        views: [{ date: DAY, value: 1_066_409 }],
        joins: [{ date: DAY, value: 27 }],
        store: [{ date: DAY, value: 26 }],
      })
    );

    expect(caption).toContain("@daristeppe");
    expect(caption).toContain("<b>16</b> роликов");
    // Разделитель тысяч ставит Intl (неразрывный пробел), поэтому строку собираем им же.
    expect(caption).toContain(`<b>${new Intl.NumberFormat("ru-RU").format(1_066_409)}</b> просмотров`);
    expect(caption).toContain("<b>27</b> заходов");
    expect(caption).toContain("<b>26</b> переходов в стор");
    // Вчерашние цифры в подпись не лезут.
    expect(caption).not.toContain("17");
  });

  it("отличает ноль от «данных нет»", () => {
    // Ноль переходов — это факт; отсутствие точки за день — не измеряли.
    const caption = formatFunnelCaption("@qurany_app", DAY, series({ store: [{ date: DAY, value: 0 }] }));

    expect(caption).toContain("<b>0</b> переходов в стор");
    expect(caption).toContain("— роликов");
    expect(caption).toContain("— просмотров");
  });
});
