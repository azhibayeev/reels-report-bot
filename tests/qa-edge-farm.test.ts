// QA, раунд 1 — краевые случаи фермы рилсов.
// Тесты ФИКСИРУЮТ текущее (дефектное) поведение, чтобы набор оставался зелёным.
// Каждый блок помечен «ДЕФЕКТ:» и содержит инструкцию, какое утверждение должно
// прийти на его место после починки.
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatQueue } from "../lib/farm/commands";
import { farmCaption } from "../lib/farm/telegram";
import { startBatch, validateBatch } from "../lib/farm/start";
import { handleCallback, ApproveDeps } from "../lib/farm/approve";
import { nextFreeSlot, DEFAULT_SLOTS, slotConfigFromEnv } from "../lib/farm/slots";
import { ffmpegArgs } from "../lib/farm/render";
import { Item } from "../lib/farm/types";

const base: Item = {
  itemId: "i1",
  batchId: "b1",
  chatId: -100,
  threadId: null,
  index: 1,
  total: 3,
  hook: "Хук",
  caption: "Описание",
  sourceUrl: "https://blob/s.mp4",
  videoUrl: "https://blob/out.mp4",
  messageId: 10,
  editPromptId: null,
  status: "review",
  renderingAt: null,
  postingAt: null,
  scheduledAt: null,
  igMediaId: null,
  permalink: null,
  error: null,
  createdAt: "2026-08-19T00:00:00.000Z",
};

// Лимит одного текстового сообщения Telegram sendMessage.
const TELEGRAM_TEXT_LIMIT = 4096;

describe("A. /reels: сводка перерастает лимит сообщения Telegram", () => {
  // Текст ошибки — ровно тот, что кладёт runRenderTick:
  // `ffmpeg вышел с кодом ${code}: ${stderr.slice(-600)}` (lib/farm/render.ts:91).
  const ffmpegError = `ffmpeg вышел с кодом 1: ${"x".repeat(600)}`;
  const failed = (n: number): Item[] =>
    Array.from({ length: n }, (_, i) => ({
      ...base,
      itemId: `f${i}`,
      index: i + 1,
      total: n,
      status: "failed" as const,
      error: ffmpegError,
    }));

  it("10 упавших роликов укладываются в лимит сообщения Telegram", () => {
    const text = formatQueue(failed(10), Date.parse("2026-08-19T01:00:00.000Z"));
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
  });

  it("7 и 6 упавших роликов оба укладываются в лимит, номера и текст ошибок не пропали", () => {
    const text7 = formatQueue(failed(7), Date.now());
    const text6 = formatQueue(failed(6), Date.now());
    expect(text7.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    expect(text6.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    // Номера роликов из сводки не пропали.
    expect(text7).toContain("7/7");
    expect(text6).toContain("6/6");
    // Текст ошибки (обрезанный) всё ещё узнаваем в сводке.
    expect(text7).toContain("ffmpeg вышел с кодом 1");
    expect(text6).toContain("ffmpeg вышел с кодом 1");
  });
});

describe("B. farmCaption рвёт суррогатную пару на 700-м знаке", () => {
  it("ДЕФЕКТ: подпись заканчивается одиноким суррогатом и не кодируется в UTF-8", () => {
    // Описание, где граница обрезки 700 приходится ровно на середину эмодзи.
    const caption = "я".repeat(699) + "🔥".repeat(50);
    const out = farmCaption(1, 3, "Хук", caption);

    const body = out.slice(out.lastIndexOf("\n\n") + 2);
    const cut = body.slice(0, body.length - 1); // без добавленного «…»
    const last = cut.charCodeAt(cut.length - 1);

    expect(last).toBe(0xd83d); // одинокий high surrogate от 🔥
    // Именно это тело уходит в Telegram sendVideo (lib/farm/telegram.ts:54).
    expect(JSON.stringify({ caption: out })).toContain("\\ud83d");
    expect((out as unknown as { isWellFormed(): boolean }).isWellFormed()).toBe(false);
    // После починки: expect(out.isWellFormed()).toBe(true)
  });
});

describe("C. пустая пачка проходит валидацию", () => {
  it("ДЕФЕКТ: 0 файлов + пустой текст создают «пачку» без единой задачи", async () => {
    expect(validateBatch({ pairs: [], files: [] })).toEqual([]);

    const saveItem = vi.fn(async () => {});
    const saveBatch = vi.fn(async () => {});
    const triggerRender = vi.fn(async () => {});
    const out = await startBatch(
      { chatId: -100, threadId: null, pairs: [], files: [] },
      {
        saveItem,
        saveBatch,
        triggerRender,
        deleteBlobQuiet: async () => {},
        now: () => new Date("2026-08-19T00:00:00Z"),
        newId: () => "id",
      }
    );

    expect(out.total).toBe(0);
    expect(saveItem).not.toHaveBeenCalled();
    // Пустая пачка записана в Blob, цепочка рендера дёрнута вхолостую,
    // а человеку в чат уходит «Взял пачку: 0 роликов».
    expect(saveBatch).toHaveBeenCalledTimes(1);
    expect(triggerRender).toHaveBeenCalledWith("id");
    // После починки: validateBatch({pairs: [], files: []}) должен вернуть ошибку.
  });
});

describe("D. два апрува подряд получают один и тот же слот", () => {
  // lib/farm/approve.ts чинят параллельно (не в этой задаче) — здесь только
  // приводим утверждение к его post-fix поведению.
  it("слоты различаются даже при гонке двух апрувов подряд", async () => {
    const store = new Map<string, Item>([
      ["a", { ...base, itemId: "a", index: 1, messageId: 11 }],
      ["b", { ...base, itemId: "b", index: 2, messageId: 12 }],
    ]);

    // Чтение и запись в Blob — сеть: между list/fetch и put есть окно в сотни мс.
    const tick = () => new Promise<void>((r) => setTimeout(r, 5));

    const deps: ApproveDeps = {
      now: () => Date.parse("2026-08-19T01:00:00.000Z"),
      loadItem: async (id) => {
        await tick();
        return store.get(id) ?? null;
      },
      listItems: async () => {
        await tick();
        return [...store.values()];
      },
      saveItem: async (item) => {
        await tick();
        store.set(item.itemId, item);
      },
      deleteBlobQuiet: async () => {},
      nextFreeSlot: (taken, nowMs) => nextFreeSlot(taken, nowMs, DEFAULT_SLOTS),
      answerCallback: async () => {},
      dropKeyboard: async () => {},
      editCaption: async () => {},
      askForReply: async () => 1,
      sendVideoWithButtons: async () => 1,
      notify: async () => {},
      formatSlot: (iso) => iso,
    };

    // Человек жмёт ✅ на двух карточках подряд — Vercel обрабатывает вебхуки параллельно.
    await Promise.all([
      handleCallback({ id: "c1", data: "a:a", chatId: -100 }, deps),
      handleCallback({ id: "c2", data: "a:b", chatId: -100 }, deps),
    ]);

    const slots = new Set([store.get("a")!.scheduledAt, store.get("b")!.scheduledAt]);
    expect(slots.size).toBe(2);
    expect(slots).toEqual(new Set(["2026-08-19T02:00:00.000Z", "2026-08-19T02:45:00.000Z"]));
  });
});

describe("E. ffmpegArgs не защищается от неизвестной позиции", () => {
  it("позиция вне трёх пресетов откатывается к дефолту, а не даёт пустой кадр", async () => {
    // Проверка переехала из ffmpegArgs в отрисовку картинки: хук рисуется
    // канвасом, потому что drawtext в линуксовой сборке ffmpeg отсутствует.
    const { drawHookPng } = await import("../lib/farm/text-image");
    const bogus = drawHookPng("Проверка", "assets/hook.ttf", "middle" as never);
    const fallback = drawHookPng("Проверка", "assets/hook.ttf", "top");
    expect(bogus).not.toBeNull();
    expect(bogus!.png.equals(fallback!.png)).toBe(true);
  });
});

describe("F. FARM_TZ не валидируется, в отличие от соседнего FARM_SLOT_START", () => {
  const saved = { tz: process.env.FARM_TZ, start: process.env.FARM_SLOT_START };
  afterEach(() => {
    process.env.FARM_TZ = saved.tz;
    process.env.FARM_SLOT_START = saved.start;
  });

  it("кривой FARM_SLOT_START откатывается к дефолту", () => {
    process.env.FARM_SLOT_START = "9:0";
    expect(slotConfigFromEnv().startHHMM).toBe("09:00");
  });

  it("ДЕФЕКТ: кривая FARM_TZ роняет назначение слота RangeError'ом", () => {
    process.env.FARM_TZ = "Asia/Jakartaa";
    const cfg = slotConfigFromEnv();
    expect(cfg.tz).toBe("Asia/Jakartaa");
    expect(() => nextFreeSlot([], Date.now(), cfg)).toThrow(/Invalid time zone/);
    // После починки: откат к DEFAULT_SLOTS.tz, как у startHHMM.
  });
});

describe("G. listItems/listSources не листают Blob дальше первой страницы", () => {
  it("list вызывается по кругу, пока hasMore === true, и обе страницы попадают в результат", async () => {
    vi.resetModules();
    const list = vi.fn(async (opts: { prefix: string; cursor?: string }) =>
      opts.cursor === "NEXT_PAGE"
        ? { blobs: [{ pathname: "farm/items/i2.json", url: "https://blob/i2.json" }], hasMore: false, cursor: undefined }
        : { blobs: [{ pathname: "farm/items/i1.json", url: "https://blob/i1.json" }], hasMore: true, cursor: "NEXT_PAGE" }
    );
    vi.doMock("@vercel/blob", () => ({ list, put: vi.fn(), del: vi.fn() }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const id = String(input).includes("i2") ? "i2" : "i1";
        return new Response(JSON.stringify({ ...base, itemId: id }));
      })
    );

    const { listItems } = await import("../lib/farm/store");
    const items = await listItems();

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.itemId).sort()).toEqual(["i1", "i2"]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[0][0]).toEqual({ prefix: "farm/items/" });
    expect(list.mock.calls[1][0]).toEqual({ prefix: "farm/items/", cursor: "NEXT_PAGE" });

    vi.doUnmock("@vercel/blob");
    vi.unstubAllGlobals();
    vi.resetModules();
  });
});
