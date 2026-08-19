import { describe, expect, it, vi } from "vitest";

import { batchesToKick, formatQueue } from "../lib/farm/commands";
import { MAX_BATCH_BYTES, MAX_FILE_BYTES, MAX_FILES, startBatch, StartDeps, validateBatch } from "../lib/farm/start";
import { pickNext } from "../lib/farm/tick";
import { waitForContainer } from "../lib/farm/instagram";
import { Item } from "../lib/farm/types";

const base: Item = {
  itemId: "i1", batchId: "b1", chatId: -1, threadId: null, index: 1, total: 4,
  hook: "Хук", caption: "Описание", sourceUrl: "https://blob/s1.mp4", videoUrl: null,
  messageId: null, editPromptId: null, status: "pending",
  renderingAt: null, postingAt: null, scheduledAt: null,
  igMediaId: null, permalink: null, error: null, createdAt: "2026-08-19T00:00:00.000Z",
};
const NOW = Date.parse("2026-08-19T01:00:00.000Z");

const HOST = "https://abc123.public.blob.vercel-storage.com";
const files = Array.from({ length: 4 }, (_, i) => ({ url: `${HOST}/farm/sources/${i}.mp4`, bytes: 10 }));
const pairs = Array.from({ length: 4 }, (_, i) => ({ hook: `Хук ${i + 1}`, caption: "Описание" }));

// ── A. Откат startBatch: файлы удалены, а уже созданные задачи остались ────────
describe("A. startBatch: откат наполовину созданной пачки", () => {
  it("откат сносит и исходники, и записи успевших задач, и запись пачки", async () => {
    const store = new Map<string, Item>();
    const deleted: string[] = [];
    let saves = 0;

    const deps: StartDeps = {
      saveBatch: async () => {},
      saveItem: async (item) => {
        saves += 1;
        // Третья запись падает: Blob не бесконечно доступен, а пачка пишется по одной задаче.
        if (saves === 3) throw new Error("blob write failed");
        store.set(item.itemId, item);
      },
      triggerRender: vi.fn(async () => {}),
      deleteBlobQuiet: async (url) => {
        deleted.push(url);
      },
      now: () => new Date("2026-08-19T00:00:00.000Z"),
      newId: (() => {
        let n = 0;
        return () => `id${(n += 1)}`;
      })(),
    };

    await expect(startBatch({ chatId: -1, threadId: null, pairs, files }, deps)).rejects.toThrow(
      /blob write failed/
    );

    // Все четыре исходника снесены.
    for (const file of files) expect(deleted).toContain(file.url);
    // ...и записи обеих успевших задач, и запись самой пачки — иначе они
    // остались бы pending-фантомами, ссылающимися на уже удалённые исходники.
    expect(deleted).toContain("farm/items/id2.json");
    expect(deleted).toContain("farm/items/id3.json");
    expect(deleted).toContain("farm/batches/id1.json");

    // Мок-стор в этом тесте отражает только то, что реально записал saveItem —
    // сам он от deleteBlobQuiet не очищается (это отдельная зависимость),
    // поэтому в нём по-прежнему две задачи.
    const left = [...store.values()];
    expect(left).toHaveLength(2);
    expect(left.map((i) => i.status)).toEqual(["pending", "pending"]);
    expect(deleted).toContain(left[0].sourceUrl);
    expect(deleted).toContain(left[1].sourceUrl);

    // Последствие: /reels видит pending и пинает цепочку рендера этой пачки,
    // а тик берёт задачу, чей исходник уже не скачается.
    expect(batchesToKick(left, NOW)).toEqual([left[0].batchId]);
    expect(pickNext(left, left[0].batchId, NOW)?.itemId).toBe(left[0].itemId);
  });
});

// ── B. /reels подписывает провал заливки как провал сборки ─────────────────────
describe("B. formatQueue про ролик, упавший на заливке", () => {
  it("ошибка публикации в IG выводится под заголовком «Не залились», а не «Не собрались»", () => {
    const failedOnPublish: Item = {
      ...base,
      itemId: "p1",
      index: 7,
      total: 30,
      status: "failed",
      videoUrl: "https://blob/out.mp4",
      scheduledAt: "2026-08-19T00:30:00.000Z",
      error: "IG не опубликовал ролик: (#100) The parameter creation_id is required",
    };

    const text = formatQueue([failedOnPublish], NOW);

    // Ролик собрался, был одобрен и получил слот — упал он на публикации,
    // и /reels обязан рапортовать о нём именно так.
    expect(text).toContain("Не залились");
    expect(text).toContain("7/30");
    expect(text).toContain("IG не опубликовал ролик");
    // Блока про несобранные ролики тут вообще быть не должно — ролик собрался.
    expect(text).not.toContain("Не собрались");
  });
});

// ── C. Ограничения пачки из спеки: до сих пор без единого теста ────────────────
describe("C. лимиты пачки из Global Constraints", () => {
  it("файлов больше 50 — ошибка с числом и лимитом", () => {
    const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => ({ url: `${HOST}/farm/sources/${i}.mp4`, bytes: 1 }));
    const manyPairs = many.map((_, i) => ({ hook: `Хук ${i}`, caption: "Описание" }));
    expect(validateBatch({ pairs: manyPairs, files: many })).toContain(
      `файлов ${MAX_FILES + 1}, лимит ${MAX_FILES}`
    );
  });

  it("ровно 50 файлов проходят", () => {
    const exact = Array.from({ length: MAX_FILES }, (_, i) => ({ url: `${HOST}/farm/sources/${i}.mp4`, bytes: 1 }));
    const exactPairs = exact.map((_, i) => ({ hook: `Хук ${i}`, caption: "Описание" }));
    expect(validateBatch({ pairs: exactPairs, files: exact })).toEqual([]);
  });

  it("пачка тяжелее 1 ГБ — ошибка, ровно 1 ГБ — нет", () => {
    // 20 файлов ниже потолка одного файла, но в сумме перебирающие гигабайт.
    const heavy = Array.from({ length: 20 }, (_, i) => ({ url: `${HOST}/farm/sources/${i}.mp4`, bytes: MAX_FILE_BYTES }));
    const heavyPairs = heavy.map((_, i) => ({ hook: `Хук ${i}`, caption: "Описание" }));
    expect(heavy.reduce((s, f) => s + f.bytes, 0)).toBeGreaterThan(MAX_BATCH_BYTES);
    expect(validateBatch({ pairs: heavyPairs, files: heavy }).some((e) => e.includes("лимит 1024 МБ"))).toBe(true);

    const exact = [{ url: `${HOST}/farm/sources/x.mp4`, bytes: MAX_BATCH_BYTES }];
    expect(validateBatch({ pairs: [pairs[0]], files: exact }).some((e) => e.includes("лимит 1024 МБ"))).toBe(false);
  });
});

// ── D. Контейнер IG в статусе EXPIRED ─────────────────────────────────────────
describe("D. waitForContainer и статус EXPIRED", () => {
  it("EXPIRED прекращает ожидание сразу, а не крутит опрос до таймаута", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ status_code: "EXPIRED", status: "Media expired" }))
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      waitForContainer("C1", { token: "T", igUserId: "IG", sleep: async () => {} })
    ).rejects.toThrow(/EXPIRED/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
