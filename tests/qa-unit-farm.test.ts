import { describe, expect, it, vi } from "vitest";

import { formatQueue } from "../lib/farm/commands";
import { runRenderTick, RenderTickDeps } from "../lib/farm/tick";
import { Item } from "../lib/farm/types";

const base: Item = {
  itemId: "i1", batchId: "b1", chatId: -1, threadId: null, index: 1, total: 30,
  hook: "Хук", caption: "Описание", sourceUrl: "https://x/s.mp4", videoUrl: null,
  messageId: null, editPromptId: null, status: "pending",
  renderingAt: null, postingAt: null, scheduledAt: null,
  igMediaId: null, permalink: null, error: null, createdAt: "2026-08-19T00:00:00.000Z",
};

// Лимит текста sendMessage в Telegram Bot API.
const TELEGRAM_TEXT_LIMIT = 4096;

describe("A: formatQueue против лимита Telegram", () => {
  it("десять реальных ffmpeg-ошибок укладываются в лимит, номера роликов не пропали", () => {
    // Ровно то, что кладёт в item.error renderHook: `ffmpeg вышел с кодом 1: ${stderr.slice(-600)}`.
    const ffmpegError = `ffmpeg вышел с кодом 1: ${"x".repeat(600)}`;
    const items: Item[] = Array.from({ length: 10 }, (_, i) => ({
      ...base,
      itemId: `f${i}`,
      index: i + 1,
      status: "failed" as const,
      error: ffmpegError,
    }));

    const text = formatQueue(items, Date.parse("2026-08-19T01:00:00.000Z"));

    expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    for (const item of items) {
      expect(text).toContain(`${item.index}/${item.total}`);
    }
  });
});

describe("C: runRenderTick после успешной отправки карточки", () => {
  function makeDeps(overrides: Partial<RenderTickDeps> = {}): RenderTickDeps {
    return {
      now: () => 1_000_000,
      listItems: vi.fn(async () => []),
      saveItem: vi.fn(async () => {}),
      renderItem: vi.fn(async () => "https://out/v.mp4"),
      sendVideoWithButtons: vi.fn(async () => 555),
      deleteBlobQuiet: vi.fn(async () => {}),
      notify: vi.fn(async () => {}),
      triggerRender: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it("сбой удаления исходника опрокидывает уже сохранённый review обратно в failed", async () => {
    const store = new Map<string, Item>([["i1", { ...base }]]);
    let listed = 0;
    const deps = makeDeps({
      listItems: async () => {
        listed += 1;
        // Второй заход цикла отдаёт пустой список, чтобы тик завершился.
        return listed === 1 ? Array.from(store.values()).map((i) => ({ ...i })) : [];
      },
      saveItem: vi.fn(async (item: Item) => {
        store.set(item.itemId, item);
      }),
      deleteBlobQuiet: vi.fn(async () => {
        throw new Error("blob delete failed");
      }),
    });

    await runRenderTick("b1", deps);

    const saved = store.get("i1")!;
    expect(saved.status).toBe("failed");
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining("не собрался"), null);
    // Карточка с кнопками уже улетела в чат — ролик реально готов, а помечен как несобранный.
    expect(deps.sendVideoWithButtons).toHaveBeenCalledTimes(1);
  });
});

describe("D: formatQueue скрывает промежуточные статусы", () => {
  it("editing и posting не попадают ни в один счётчик", () => {
    const items: Item[] = [
      { ...base, itemId: "e1", status: "editing" },
      { ...base, itemId: "p1", status: "posting", scheduledAt: "2026-08-19T02:00:00.000Z" },
    ];

    const text = formatQueue(items, Date.parse("2026-08-19T01:00:00.000Z"));

    expect(text).toContain("ждут апрува: 0");
    expect(text).toContain("в очереди: 0");
    expect(text).not.toContain("рендерится");
    expect(text).not.toMatch(/правк|editing|залива|posting/i);
  });
});
