import { describe, expect, it } from "vitest";
import { TELEGRAM_TEXT_LIMIT } from "../lib/farm/commands";
import { formatHooksReport, rankHooks, reliabilityNote } from "../lib/farm/hooks-report";
import type { ReelMetrics } from "../lib/farm/insights";
import type { PublicationRecord } from "../lib/farm/journal";

// Запись журнала целиком, но в тестах важны только hook/igMediaId/permalink —
// остальное заполняем правдоподобным постоянством, чтобы литералы не мешали читать.
function rec(hook: string, mediaId: string): PublicationRecord {
  return {
    itemId: `item-${mediaId}`,
    batchId: "b1",
    index: 1,
    total: 1,
    hook,
    caption: "подпись",
    sourceUrl: "https://blob/src.mp4",
    musicUrl: null,
    position: "top",
    seconds: 30,
    scheduledAt: null,
    publishedAt: "2026-08-01T10:00:00.000Z",
    igMediaId: mediaId,
    permalink: `https://instagram.com/reel/${mediaId}`,
  };
}

function metrics(views: number): ReelMetrics {
  return {
    views,
    reach: null,
    shares: null,
    saved: null,
    comments: null,
    likes: null,
    avgWatchMs: null,
    error: null,
  };
}

function failed(message: string): ReelMetrics {
  return { ...metrics(0), views: null, error: message };
}

// Хук + просмотры для каждого его ролика — короткая запись целого набора данных.
function build(input: Array<[string, number[]]>): {
  records: PublicationRecord[];
  map: Map<string, ReelMetrics>;
} {
  const records: PublicationRecord[] = [];
  const map = new Map<string, ReelMetrics>();
  let id = 0;
  for (const [hook, views] of input) {
    for (const v of views) {
      id += 1;
      const mediaId = `m${id}`;
      records.push(rec(hook, mediaId));
      map.set(mediaId, metrics(v));
    }
  }
  return { records, map };
}

describe("rankHooks", () => {
  it("один вирусный ролик не делает свой хук лучшим — сравниваем по среднему геометрическому", () => {
    const { records, map } = build([
      ["виральный выброс", [1000, 1000, 1_000_000]],
      ["ровный середняк", [30_000, 30_000, 30_000]],
    ]);

    const stats = rankHooks(records, map);

    // Среднее арифметическое у первого хука 334 000 против 30 000 — по нему он
    // «победил бы». Геометрическое ставит его на место: 10 000 против 30 000.
    expect(stats.map((s) => s.hook)).toEqual(["ровный середняк", "виральный выброс"]);
    expect(stats[1].geoMean).toBe(10_000);
    expect(stats[1].median).toBe(1000);
    expect(stats[1].best).toBe(1_000_000);
    expect(stats[1].views).toEqual([1_000_000, 1000, 1000]);
  });

  it("ролики без цифр не подмешиваются в статистику, но остаются в счёте роликов хука", () => {
    const records = [rec("хук", "m1"), rec("хук", "m2"), rec("хук", "m3"), rec("хук", "m4")];
    const map = new Map<string, ReelMetrics>([
      ["m1", metrics(10_000)],
      ["m2", metrics(10_000)],
      ["m3", failed("Graph отказал (HTTP 400): media not found")],
      // m4 в карте нет вовсе — так выглядит удалённый из аккаунта ролик.
    ]);

    const stats = rankHooks(records, map);

    expect(stats).toHaveLength(1);
    expect(stats[0].views).toEqual([10_000, 10_000]);
    expect(stats[0].geoMean).toBe(10_000);
    expect(stats[0].n).toBe(4);
  });

  it("пустой журнал не притворяется рейтингом", () => {
    expect(rankHooks([], new Map())).toEqual([]);
  });
});

describe("reliabilityNote", () => {
  it("по одному ролику на хук — предупреждение прямо запрещает решать по таблице", () => {
    const { records, map } = build([
      ["первый", [5000]],
      ["второй", [40_000]],
    ]);

    const note = reliabilityNote(rankHooks(records, map));

    expect(note).toContain("42");
    expect(note).toContain("10%");
    expect(note).toMatch(/нельзя/i);
  });

  it("по пять роликов на хук — тон меняется с запрета на осторожность", () => {
    const { records, map } = build([
      ["первый", [5000, 6000, 7000, 8000, 9000]],
      ["второй", [40_000, 41_000, 42_000, 43_000, 44_000]],
    ]);

    const note = reliabilityNote(rankHooks(records, map));

    expect(note).not.toMatch(/нельзя/i);
    expect(note).not.toContain("42 раза");
    expect(note).toMatch(/×\d/);
  });

  it("два-четыре ролика на хук — не запрет, но и не разрешение верить мелким отрывам", () => {
    const { records, map } = build([
      ["первый", [5000, 6000, 7000]],
      ["второй", [40_000, 41_000]],
    ]);

    const note = reliabilityNote(rankHooks(records, map));

    expect(note).not.toMatch(/нельзя/i);
    // Порог берётся из той же формулы, что и «×42» при одном ролике, а не из
    // круглого числа. Занижение тут опаснее завышения: оно делает человека
    // увереннее, чем позволяют данные, — ровно то, ради чего модуль и написан.
    // У самого бедного хука здесь 2 ролика, формула даёт ×14, а не ×5.
    expect(note).toContain("×14");
    expect(note).not.toContain("×5");
  });

  it("порог согласован с формулой на всём диапазоне, а не только в крайних точках", () => {
    // Ожидания сверены с fmtRatio: всё, что ×3 и выше, он округляет до целого.
    for (const [n, expected] of [[2, "×14"], [3, "×9"], [4, "×6"], [6, "×5"]] as const) {
      const { records, map } = build([
        ["бедный", Array.from({ length: n }, (_, i) => 5000 + i)],
        ["богатый", Array.from({ length: n + 2 }, (_, i) => 40_000 + i)],
      ]);
      const note = reliabilityNote(rankHooks(records, map));
      expect(note, `n=${n}`).toContain(expected);
    }
  });
});

describe("formatHooksReport", () => {
  it("не вылезает за лимит телеграма, даже когда одних слепых хуков больше лимита", () => {
    // Слепые хуки, заголовок и итог складывались в «фиксированную» часть и
    // вычитались из бюджета, но сами ничем не ограничивались: при сотне хуков
    // без метрик бюджет уходил в минус, строки рейтинга не показывались — а
    // переросшая фиксированная часть всё равно уезжала в сообщение. Telegram
    // отвечает на такое 400, и человек не получает отчёт вообще.
    // build() кладёт метрику на каждый ролик, поэтому слепые хуки собираем
    // руками: запись в журнале есть, метрики к ней нет.
    const { records, map } = build([["с цифрами", [5000, 6000, 7000]]]);
    for (let i = 0; i < 200; i += 1) {
      records.push(rec(`Очень длинный хук номер ${i} про то, как устроена молитва и почему это важно знать`, `blind${i}`));
    }

    // limit задаёт вызывающий, и при большом значении «фиксированная» часть
    // перестаёт быть маленькой: она вычитается из бюджета, но сама не режется.
    const text = formatHooksReport(rankHooks(records, map), { limit: 500 });

    expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    // Предупреждение — последнее, чем можно жертвовать: без него отчёт врёт.
    expect(text).toMatch(/⚠️|ℹ️/);
  });

  it("отчёт по одиночным роликам несёт предупреждение про шум рядом с таблицей", () => {
    const { records, map } = build([
      ["первый", [5000]],
      ["второй", [40_000]],
    ]);

    const text = formatHooksReport(rankHooks(records, map));

    expect(text).toContain("42");
    expect(text).toMatch(/нельзя/i);
    expect(text).toContain("первый");
    expect(text).toContain("второй");
  });

  it("пропавшие цифры видны в отчёте числом, а не молчанием", () => {
    const records = [rec("хук", "m1"), rec("хук", "m2"), rec("хук", "m3")];
    const map = new Map<string, ReelMetrics>([
      ["m1", metrics(10_000)],
      ["m2", failed("Graph отказал")],
      ["m3", failed("Graph отказал")],
    ]);

    const text = formatHooksReport(rankHooks(records, map));

    expect(text).toContain("без цифр: 2");
    expect(text).toContain("ещё 2 без цифр");
  });

  it("длинный список режется под лимит телеграма, но предупреждение и итог переживают обрезку", () => {
    const input: Array<[string, number[]]> = [];
    for (let i = 0; i < 200; i += 1) {
      input.push([`очень длинный хук номер ${i} про то, как перестать бояться и начать снимать`, [1000 + i]]);
    }
    const { records, map } = build(input);

    const text = formatHooksReport(rankHooks(records, map), { limit: 200 });

    expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    expect(text).toContain("42");
    expect(text).toContain("Итого");
    expect(text).toContain("показаны");
  });

  it("угловые скобки в хуке уезжают в отчёт экранированными, иначе телеграм не примет сообщение", () => {
    const { records, map } = build([["<b>ты не поверишь</b> & точка", [5000]]]);

    const text = formatHooksReport(rankHooks(records, map));

    expect(text).toContain("&lt;b&gt;ты не поверишь&lt;/b&gt; &amp; точка");
    expect(text).not.toContain("<b>ты не поверишь");
  });

  it("пустой ввод отвечает словами, а не пустой строкой", () => {
    const text = formatHooksReport([]);

    expect(text.length).toBeGreaterThan(20);
    expect(text).toMatch(/журнал|пуст/i);
  });
});
