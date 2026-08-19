// Раунд 2, дефекты 1/2/4/3/5 (lib/farm/start.ts): собственные тесты исполнителя
// на изменения в этом файле — красные до правки, зелёные после.
import { describe, expect, it, vi } from "vitest";
import { startBatch, StartDeps, validateBatch } from "../lib/farm/start";
import { BATCHES_PREFIX, itemPath } from "../lib/farm/store";
import { Pair } from "../lib/farm/types";

// ── Дефекты 1/2/4: откат startBatch должен сносить и записи, не только файлы ──
describe("startBatch: откат сорванной пачки убирает записи задач и пачки, а не только файлы", () => {
  it("после отказа на третьей задаче удалены записи двух успевших задач и запись пачки", async () => {
    const files = Array.from({ length: 4 }, (_, i) => ({ url: `https://blob/f${i}.mp4`, bytes: 10 }));
    const pairs = Array.from({ length: 4 }, (_, i) => ({ hook: `Хук ${i + 1}`, caption: "Описание" }));
    let saves = 0;
    const deleted: string[] = [];

    const deps: StartDeps = {
      saveBatch: async () => {},
      saveItem: async () => {
        saves += 1;
        // Третья запись падает — ровно как в репродукции QA (block A round 2).
        if (saves === 3) throw new Error("blob write failed");
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

    // newId(): "id1" — batchId; "id2","id3" — успевшие сохраниться задачи; "id4" —
    // задача, чей saveItem как раз и упал.
    expect(deleted).toContain(itemPath("id2"));
    expect(deleted).toContain(itemPath("id3"));
    expect(deleted).toContain(`${BATCHES_PREFIX}id1.json`);
    // Задачу, чей saveItem провалился, удалять нечего — записи не было.
    expect(deleted).not.toContain(itemPath("id4"));
    // Все четыре исходника по-прежнему снесены.
    for (const file of files) expect(deleted).toContain(file.url);

    // Записи и пачка убраны раньше файлов: иначе есть окно, где /reels уже видит
    // мёртвую задачу, а исходник у неё ещё жив (или наоборот).
    const recordIdx = Math.max(
      deleted.indexOf(itemPath("id2")),
      deleted.indexOf(itemPath("id3")),
      deleted.indexOf(`${BATCHES_PREFIX}id1.json`)
    );
    const firstFileIdx = Math.min(...files.map((f) => deleted.indexOf(f.url)));
    expect(recordIdx).toBeLessThan(firstFileIdx);
  });

  it("отказ на самой первой задаче всё равно сносит уже написанную запись пачки", async () => {
    const files = [{ url: "https://blob/a.mp4", bytes: 1 }];
    const pairs = [{ hook: "Хук", caption: "Описание" }];
    const deleted: string[] = [];

    const deps: StartDeps = {
      saveBatch: async () => {},
      saveItem: async () => {
        throw new Error("boom");
      },
      triggerRender: async () => {},
      deleteBlobQuiet: async (url) => {
        deleted.push(url);
      },
      now: () => new Date("2026-08-19T00:00:00.000Z"),
      newId: (() => {
        let n = 0;
        return () => `id${(n += 1)}`;
      })(),
    };

    await expect(startBatch({ chatId: -1, threadId: null, pairs, files }, deps)).rejects.toThrow(/boom/);

    // Пачка (id1) уже была записана до цикла задач — её тоже нужно снести, хотя
    // ни одна задача так и не сохранилась.
    expect(deleted).toContain(`${BATCHES_PREFIX}id1.json`);
    expect(deleted).toContain(files[0].url);
  });
});

// ── Дефект 3: хук со знаками вне шрифта assets/hook.ttf должен отбраковываться ──
describe("validateBatch: хук со знаками вне шрифта хука отклоняется", () => {
  const files = [{ url: "https://x/1.mp4", bytes: 10 }];

  it("эмодзи в хуке даёт ошибку валидации с этим знаком", () => {
    const errors = validateBatch({ pairs: [{ hook: "Gratis 🔥", caption: "О" }], files });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("🔥"))).toBe(true);
  });

  it("арабица в хуке тоже даёт ошибку валидации", () => {
    const errors = validateBatch({ pairs: [{ hook: "بسم الله", caption: "О" }], files });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("латиница и кириллица — то, что шрифт знает — проходят без ошибок", () => {
    expect(validateBatch({ pairs: [{ hook: "Скидка 50% Discount", caption: "О" }], files })).toEqual([]);
  });
});

// ── Дефект 5: номер блока в ошибке хука берётся из pair.block, если он есть ──
describe("validateBatch: номер блока в сообщении об ошибке хука", () => {
  const files = [
    { url: "https://blob/1.mp4", bytes: 10 },
    { url: "https://blob/2.mp4", bytes: 10 },
  ];

  it("использует pair.block вместо порядкового индекса массива пар", () => {
    // block проставляет parseBlocks номером исходного текстового блока — здесь
    // эмулируем это вручную, чтобы проверить именно потребление в validateBatch.
    const pairs = [
      { hook: "Хук два", caption: "Описание", block: 2 },
      { hook: "Assalamualaikumwarahmatullahi", caption: "Описание", block: 3 },
    ] as unknown as Pair[];

    expect(validateBatch({ pairs, files })).toEqual([
      "блок 3: хук не влезает в 3 строки по 26 знаков",
    ]);
  });

  it("без pair.block по-прежнему считает по порядку в массиве (обратная совместимость)", () => {
    const pairs = [
      { hook: "Хук раз", caption: "Описание" },
      { hook: "Assalamualaikumwarahmatullahi", caption: "Описание" },
    ];

    expect(validateBatch({ pairs, files })).toEqual([
      "блок 2: хук не влезает в 3 строки по 26 знаков",
    ]);
  });
});
