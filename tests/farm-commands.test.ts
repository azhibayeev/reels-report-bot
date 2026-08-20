import { describe, expect, it } from "vitest";
import {
  batchesToKick,
  formatQueue,
  formatSlot,
  parseCallback,
  parseFarmCommand,
  parseStylePosition,
  positionName,
} from "../lib/farm/commands";
import { HOOK_POSITIONS, Item } from "../lib/farm/types";

const base: Item = {
  itemId: "i1", batchId: "b1", chatId: -1, threadId: null, index: 1, total: 3,
  hook: "Хук", caption: "Описание", sourceUrl: "https://x/s.mp4", videoUrl: null,
  messageId: null, editPromptId: null, status: "pending",
  renderingAt: null, postingAt: null, scheduledAt: null,
  igMediaId: null, permalink: null, error: null, createdAt: "2026-08-19T00:00:00.000Z",
};
const NOW = Date.parse("2026-08-19T01:00:00.000Z");

describe("parseFarmCommand", () => {
  it("/batch — простая команда", () => {
    expect(parseFarmCommand("/batch")).toBe("batch");
  });

  it("/batch@ИмяБота — отбрасывает упоминание бота", () => {
    expect(parseFarmCommand("/batch@MyReelsBot")).toBe("batch");
  });

  it("/reels — простая команда", () => {
    expect(parseFarmCommand("/reels")).toBe("reels");
  });

  it("/REELS@bot arg — регистр и хвостовые аргументы не мешают", () => {
    expect(parseFarmCommand("/REELS@bot arg1 arg2")).toBe("reels");
  });

  it("/style — простая команда", () => {
    expect(parseFarmCommand("/style")).toBe("style");
  });

  it("/style@ИмяБота — отбрасывает упоминание бота", () => {
    expect(parseFarmCommand("/style@MyReelsBot")).toBe("style");
  });

  it("/STYLE — регистр не важен", () => {
    expect(parseFarmCommand("/STYLE")).toBe("style");
  });

  it("чужая команда — null", () => {
    expect(parseFarmCommand("/otchet")).toBeNull();
  });

  it("не команда — null", () => {
    expect(parseFarmCommand("привет")).toBeNull();
  });
});

describe("parseStylePosition", () => {
  it("без аргумента — показать текущее", () => {
    expect(parseStylePosition("/style")).toBe("show");
    expect(parseStylePosition("/style   ")).toBe("show");
  });

  it("верх/top — top", () => {
    expect(parseStylePosition("/style верх")).toBe("top");
    expect(parseStylePosition("/style top")).toBe("top");
  });

  it("центр/center — center, регистр не важен", () => {
    expect(parseStylePosition("/style Центр")).toBe("center");
    expect(parseStylePosition("/style CENTER")).toBe("center");
  });

  it("низ/bottom — bottom", () => {
    expect(parseStylePosition("/style низ")).toBe("bottom");
    expect(parseStylePosition("/style bottom")).toBe("bottom");
  });

  it("неизвестный аргумент — null", () => {
    expect(parseStylePosition("/style сбоку")).toBeNull();
  });

  it("унаследованные ключи прототипа объекта — не позиция, null", () => {
    expect(parseStylePosition("/style constructor")).toBeNull();
    expect(parseStylePosition("/style __proto__")).toBeNull();
    expect(parseStylePosition("/style toString")).toBeNull();
    expect(parseStylePosition("/style valueOf")).toBeNull();
    expect(parseStylePosition("/style hasOwnProperty")).toBeNull();
  });

  it("каждая позиция из HOOK_POSITIONS разбирается своим английским синонимом и имеет непустое имя", () => {
    for (const p of HOOK_POSITIONS) {
      expect(parseStylePosition(`/style ${p}`)).toBe(p);
      expect(positionName(p)).toBeTruthy();
    }
  });
});

describe("positionName", () => {
  it("русские имена позиций", () => {
    expect(positionName("top")).toBe("верх");
    expect(positionName("center")).toBe("центр");
    expect(positionName("bottom")).toBe("низ");
  });
});

describe("parseCallback", () => {
  it("a:<id> — approve", () => {
    expect(parseCallback("a:i1")).toEqual({ action: "approve", itemId: "i1" });
  });

  it("r:<id> — reject", () => {
    expect(parseCallback("r:i1")).toEqual({ action: "reject", itemId: "i1" });
  });

  it("e:<id> — edit", () => {
    expect(parseCallback("e:i1")).toEqual({ action: "edit", itemId: "i1" });
  });

  it("неизвестный префикс — null", () => {
    expect(parseCallback("x:i1")).toBeNull();
  });

  it("без itemId — null", () => {
    expect(parseCallback("a:")).toBeNull();
  });

  it("пустая строка — null", () => {
    expect(parseCallback("")).toBeNull();
  });

  it("без двоеточия — null", () => {
    expect(parseCallback("mусор")).toBeNull();
  });
});

describe("formatSlot", () => {
  it("день, сокращённый месяц, время — в зоне Джакарты по умолчанию", () => {
    // 2026-08-20T02:00:00Z = 2026-08-20 09:00 в Asia/Jakarta (UTC+7)
    expect(formatSlot("2026-08-20T02:00:00.000Z")).toBe("20 авг, 09:00");
  });

  it("принимает свою зону", () => {
    // 2026-08-20T02:00:00Z = 2026-08-20 05:00 в Europe/Moscow (UTC+3)
    expect(formatSlot("2026-08-20T02:00:00.000Z", "Europe/Moscow")).toBe("20 авг, 05:00");
  });
});

describe("formatQueue", () => {
  it("ждущий сборки и собираемый прямо сейчас — разные строки", () => {
    // Раньше обе стадии складывались в одну строку «ещё рендерится». Из-за
    // этого вставшая цепочка выглядела как идущая работа: тринадцать задач
    // висели в pending, а сводка бодро сообщала, что они рендерятся.
    const text = formatQueue(
      [
        { ...base, itemId: "a", status: "rendering", renderingAt: "2026-08-19T00:59:00.000Z" },
        { ...base, itemId: "b", status: "pending" },
        { ...base, itemId: "c", status: "pending" },
      ],
      NOW
    );
    expect(text).toContain("собирается сейчас: 1");
    expect(text).toContain("ждут сборки: 2");
    expect(text).not.toContain("ещё рендерится");
  });

  it("нечего собирать — обе строки молчат", () => {
    const text = formatQueue([{ ...base, status: "review" }], NOW);
    expect(text).not.toContain("собирается сейчас");
    expect(text).not.toContain("ждут сборки");
  });

  it("пустая ферма — внятный непустой текст", () => {
    const text = formatQueue([], NOW);
    expect(text.length).toBeGreaterThan(0);
  });

  it("считает ждущих апрува и стоящих в очереди", () => {
    const items = [
      { ...base, itemId: "i1", status: "review" as const },
      { ...base, itemId: "i2", status: "review" as const },
      { ...base, itemId: "i3", status: "queued" as const, scheduledAt: new Date(NOW + 60_000).toISOString() },
    ];
    const text = formatQueue(items, NOW);
    expect(text).toContain("ждут апрува: 2");
    expect(text).toContain("в очереди: 1");
  });

  it("показывает ближайший слот из очереди", () => {
    const soonIso = new Date(NOW + 60_000).toISOString();
    const items = [
      { ...base, itemId: "i1", status: "queued" as const, scheduledAt: new Date(NOW + 3_600_000).toISOString() },
      { ...base, itemId: "i2", status: "queued" as const, scheduledAt: soonIso },
    ];
    const text = formatQueue(items, NOW);
    expect(text).toContain(formatSlot(soonIso));
  });

  it("перечисляет упавшие ролики с номером и текстом ошибки", () => {
    const items = [
      { ...base, itemId: "i1", status: "failed" as const, index: 5, total: 30, error: "ffmpeg сломался" },
    ];
    const text = formatQueue(items, NOW);
    expect(text).toContain("5/30");
    expect(text).toContain("ffmpeg сломался");
  });

  it("экранирует HTML-спецсимволы в тексте ошибки", () => {
    const items = [
      {
        ...base,
        itemId: "i1",
        status: "failed" as const,
        error: "ffmpeg: unexpected <html> & fail",
      },
    ];
    const text = formatQueue(items, NOW);
    expect(text).toContain("&lt;html&gt;");
    expect(text).toContain("&amp;");
    expect(text).not.toContain("<html>");
  });

  it("доделанные ролики в незавершённых не числятся", () => {
    const items = [
      { ...base, itemId: "i1", status: "pending" as const },
      { ...base, itemId: "i2", status: "rendering" as const },
      { ...base, itemId: "i3", status: "posted" as const },
      { ...base, itemId: "i4", status: "failed" as const },
    ];
    const text = formatQueue(items, NOW);
    expect(text).toContain("собирается сейчас: 1");
    expect(text).toContain("ждут сборки: 1");
  });

  it("ролик, упавший на заливке в IG (videoUrl уже есть), идёт в «Не залились», а не в «Не собрались»", () => {
    const items = [
      {
        ...base,
        itemId: "i1",
        status: "failed" as const,
        index: 7,
        total: 30,
        videoUrl: "https://blob/out.mp4",
        scheduledAt: "2026-08-19T00:30:00.000Z",
        error: "IG не опубликовал ролик: (#100) The parameter creation_id is required",
      },
    ];
    const text = formatQueue(items, NOW);
    expect(text).toContain("Не залились");
    expect(text).toContain("7/30");
    expect(text).toContain("IG не опубликовал ролик");
    // Ролик собрался — блока про несобранные ролики тут вообще быть не должно.
    expect(text).not.toContain("Не собрались");
  });

  it("упавший на сборке (videoUrl ещё нет) остаётся в «Не собрались», а не в «Не залились»", () => {
    const items = [
      { ...base, itemId: "i1", status: "failed" as const, index: 3, total: 10, error: "ffmpeg сломался" },
    ];
    const text = formatQueue(items, NOW);
    expect(text).toContain("Не собрались");
    expect(text).not.toContain("Не залились");
  });

  it("одновременно есть и несобравшиеся, и незалившиеся — оба блока со своими роликами", () => {
    const items = [
      { ...base, itemId: "i1", status: "failed" as const, index: 3, total: 10, error: "ffmpeg сломался" },
      {
        ...base,
        itemId: "i2",
        status: "failed" as const,
        index: 7,
        total: 30,
        videoUrl: "https://blob/out.mp4",
        error: "IG не опубликовал ролик: (#100) The parameter creation_id is required",
      },
    ];
    const text = formatQueue(items, NOW);
    expect(text).toContain("Не собрались");
    expect(text).toContain("3/10");
    expect(text).toContain("Не залились");
    expect(text).toContain("7/30");
  });

  it("обрезка не рвёт HTML-сущность посреди &amp;: десять failed с длинной серией & укладываются в лимит и не оканчиваются оборванной сущностью", () => {
    // Каждый '&' проходит через escapeHtml в "&amp;" — обрубить срез можно
    // ровно на границе "&am", это и есть воспроизведение бага.
    const items = Array.from({ length: 10 }, (_, i) => ({
      ...base,
      itemId: `f${i}`,
      index: i + 1,
      status: "failed" as const,
      error: "&".repeat(200),
    }));

    const text = formatQueue(items, NOW);

    expect(text.length).toBeLessThanOrEqual(4096);
    const withoutNote = text.replace(/\n\n…сводка обрезана, влезло не всё$/, "");
    expect(withoutNote).not.toMatch(/&[a-zA-Z#0-9]*$/);
  });
});

describe("batchesToKick", () => {
  it("pending — пачку нужно пнуть", () => {
    const items = [{ ...base, batchId: "b1", status: "pending" as const }];
    expect(batchesToKick(items, NOW)).toEqual(["b1"]);
  });

  it("брошенный rendering — пнуть, живой — не трогать", () => {
    const abandoned = { ...base, itemId: "dead", batchId: "b1", status: "rendering" as const, renderingAt: new Date(NOW - 301_000).toISOString() };
    const alive = { ...base, itemId: "alive", batchId: "b2", status: "rendering" as const, renderingAt: new Date(NOW - 1_000).toISOString() };
    expect(batchesToKick([abandoned], NOW)).toEqual(["b1"]);
    expect(batchesToKick([alive], NOW)).toEqual([]);
  });

  it("готовые, отвергнутые и стоящие в очереди — не трогает", () => {
    const items = [
      { ...base, batchId: "b1", status: "review" as const },
      { ...base, batchId: "b2", status: "queued" as const },
      { ...base, batchId: "b3", status: "rejected" as const },
      { ...base, batchId: "b4", status: "posted" as const },
    ];
    expect(batchesToKick(items, NOW)).toEqual([]);
  });

  it("дедуплицирует batchId", () => {
    const items = [
      { ...base, itemId: "i1", batchId: "b1", status: "pending" as const },
      { ...base, itemId: "i2", batchId: "b1", status: "pending" as const },
    ];
    expect(batchesToKick(items, NOW)).toEqual(["b1"]);
  });
});
