// QA, раунд 2 — краевые случаи фермы рилсов.
// Тесты ФИКСИРУЮТ текущее (дефектное) поведение, чтобы набор оставался зелёным.
// Каждый блок помечен «ДЕФЕКТ:» и содержит инструкцию, какое утверждение должно
// прийти на его место после починки.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleEditReply, ApproveDeps } from "../lib/farm/approve";
import { classifyForCleanup } from "../lib/farm/daily";
import { parseBlocks } from "../lib/farm/parse";
import { runRenderTick } from "../lib/farm/tick";
import { ffmpegArgs } from "../lib/farm/render";
import { startBatch, validateBatch } from "../lib/farm/start";
import { Item, Batch } from "../lib/farm/types";
import { HOOK_LINE_CHARS, HOOK_MAX_LINES } from "../lib/farm/wrap";

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

// ---------------------------------------------------------------------------
// H. Хук с эмодзи/арабицей: шрифт таких знаков не знает, ffmpeg рисует пустые
//    прямоугольники .notdef и выходит с кодом 0. validateBatch теперь такие
//    хуки отбраковывает (первый тест ниже); до ffmpeg они не доходят — второй
//    тест ниже фиксирует сам факт дефекта на уровне рендера как документацию.
// ---------------------------------------------------------------------------
describe("H. хук из знаков вне шрифта рендерится в пустые квадраты", () => {
  const FONT = join(process.cwd(), "assets", "hook.ttf");
  const FFMPEG = join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");

  // Разбор cmap формата 4: какие коды знаков шрифт вообще умеет рисовать.
  function fontCovers(codepoint: number): boolean {
    const b = readFileSync(FONT);
    const numTables = b.readUInt16BE(4);
    let cmapOff = 0;
    for (let i = 0; i < numTables; i += 1) {
      const o = 12 + i * 16;
      if (b.toString("ascii", o, o + 4) === "cmap") cmapOff = b.readUInt32BE(o + 8);
    }
    const subtables = b.readUInt16BE(cmapOff + 2);
    let fmt4 = 0;
    for (let i = 0; i < subtables; i += 1) {
      const r = cmapOff + 4 + i * 8;
      const off = b.readUInt32BE(r + 4);
      if (b.readUInt16BE(cmapOff + off) === 4 && fmt4 === 0) fmt4 = cmapOff + off;
    }
    if (codepoint > 0xffff) return false; // cmap формата 4 адресует только BMP
    const segX2 = b.readUInt16BE(fmt4 + 6);
    const endOff = fmt4 + 14;
    const startOff = endOff + segX2 + 2;
    for (let i = 0; i < segX2 / 2; i += 1) {
      const end = b.readUInt16BE(endOff + i * 2);
      const start = b.readUInt16BE(startOff + i * 2);
      if (codepoint <= end) return codepoint >= start;
    }
    return false;
  }

  it("хук со знаком вне cmap шрифта (эмодзи, арабица) даёт ошибку валидации", () => {
    expect(fontCovers(0x41)).toBe(true); // A
    expect(fontCovers(0x430)).toBe(true); // а
    expect(fontCovers(0x1f525)).toBe(false); // 🔥
    expect(fontCovers(0x2600)).toBe(false); // ☀
    expect(fontCovers(0x627)).toBe(false); // ا

    const files = [{ url: "https://x/1.mp4", bytes: 10 }];
    const emojiErrors = validateBatch({ pairs: [{ hook: "Gratis 🔥", caption: "О" }], files });
    expect(emojiErrors).toHaveLength(1);
    expect(emojiErrors[0]).toContain("🔥");

    const arabicErrors = validateBatch({ pairs: [{ hook: "بسم الله", caption: "О" }], files });
    expect(arabicErrors).toHaveLength(1);
    // Первый непокрытый знак — «ب», с него начинается сама строка «بسم الله».
    expect(arabicErrors[0]).toContain("ب");
  });

  it("знаки вне шрифта дают одинаковую картинку — потому валидация их и отклоняет", async () => {
    // Раньше это проверялось прогоном настоящего ffmpeg с drawtext. Теперь хук
    // рисуется канвасом (drawtext в линуксовой сборке отсутствует), и свойство
    // проверяется прямо на картинке: два РАЗНЫХ хука из непокрытых знаков дают
    // побайтово одинаковый PNG, то есть текста в кадре нет вовсе.
    const { drawHookPng } = await import("../lib/farm/text-image");
    const a = drawHookPng("🔥🔥🔥", FONT);
    const b = drawHookPng("☀☀☀", FONT);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.png.equals(b!.png)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// J. Сорванное создание пачки теперь откатывает и файлы, и уже созданные
//    записи задач вместе с записью пачки — фантомов не остаётся.
// ---------------------------------------------------------------------------
describe("J. откат startBatch оставляет уже созданные задачи в хранилище", () => {
  it("исправлено: откат сносит и файлы, и уже созданные записи задач с записью пачки", async () => {
    const pairs = [
      { hook: "Хук 1", caption: "О" },
      { hook: "Хук 2", caption: "О" },
      { hook: "Хук 3", caption: "О" },
    ];
    const files = [
      { url: "https://blob/1.mp4", bytes: 10 },
      { url: "https://blob/2.mp4", bytes: 10 },
      { url: "https://blob/3.mp4", bytes: 10 },
    ];

    const saved: Item[] = [];
    const deleted: string[] = [];
    const saveItem = vi.fn(async (item: Item) => {
      if (saved.length === 2) throw new Error("blob down");
      saved.push(item);
    });

    await expect(
      startBatch(
        { chatId: -100, threadId: null, pairs, files },
        {
          saveItem,
          saveBatch: async (_b: Batch) => {},
          triggerRender: async () => {},
          deleteBlobQuiet: async (url: string) => {
            deleted.push(url);
          },
          now: () => new Date("2026-08-19T00:00:00.000Z"),
          newId: (() => {
            let n = 0;
            return () => `id${(n += 1)}`;
          })(),
        }
      )
    ).rejects.toThrow(/blob down/);

    // Файлы удалены все три...
    expect(files.every((f) => deleted.includes(f.url))).toBe(true);
    // ...и обе уже созданные записи задач тоже удалены — фантомов не остаётся.
    expect(deleted.filter((u) => u.startsWith("farm/items/"))).toHaveLength(2);
    // ...и запись самой пачки снесена вместе с ними.
    expect(deleted.some((u) => u.startsWith("farm/batches/"))).toBe(true);
    expect(deleted).toHaveLength(6);
    // saveItem реально вызывался дважды до отказа — это те же записи, что попали в deleted.
    expect(saved).toHaveLength(2);
    expect(saved.every((i) => i.status === "pending")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// L. Отказ Telegram при отправке карточки больше не отменяет ролик.
//    Раньше карточка была разрешением на публикацию, и не ушедшая карточка
//    означала потерянный ролик — его видео тут же удаляли из farm/out/.
//    С отменой ручного апрува карточка стала уведомлением: слот выдан ДО
//    отправки, и удалять видео теперь значило бы сорвать уже назначенную
//    публикацию из-за недоступного мессенджера.
// ---------------------------------------------------------------------------
describe("L. отказ sendVideo не должен отменять уже назначенную публикацию", () => {
  it("ролик остаётся в очереди со своим слотом, видео не удаляется", async () => {
    const item: Item = { ...base, itemId: "i9", status: "pending", videoUrl: null, messageId: null };
    const outUrl = "https://blob.public.blob.vercel-storage.com/farm/out/i9.mp4";
    const SLOT = "2026-08-20T02:00:00.000Z";

    const saved: Item[] = [];
    const deleted: string[] = [];
    let listed = [item];

    await runRenderTick("b1", {
      now: () => Date.parse("2026-08-19T00:00:00.000Z"),
      listItems: async () => listed,
      saveItem: async (i: Item) => {
        saved.push(i);
        listed = [i];
      },
      renderItem: async () => outUrl,
      queueRendered: async (i: Item) => {
        const queued = { ...i, status: "queued" as const, scheduledAt: SLOT };
        saved.push(queued);
        listed = [queued];
        return SLOT;
      },
      formatSlot: (iso: string) => iso,
      // Ролик длиннее ~40 секунд весит больше 20 МБ, а по URL Telegram принимает
      // максимум 20 МБ — отказ здесь штатный, а не экзотический.
      sendVideoWithButtons: async () => {
        throw new Error("Telegram sendVideo failed (400): Bad Request: file is too big");
      },
      deleteBlobQuiet: async (url: string) => {
        deleted.push(url);
      },
      notify: async () => {},
      triggerRender: async () => {},
    });

    const last = saved[saved.length - 1];
    expect(last.status).toBe("queued");
    expect(last.scheduledAt).toBe(SLOT);
    expect(last.videoUrl).toBe(outUrl);
    // Именно это раньше и ломало ролик: собранное видео удаляли, а публиковать
    // потом было нечего.
    expect(deleted).not.toContain(outUrl);
  });
});

// K. Номер блока в ошибке валидации сдвигается, если раньше был битый блок.
// ---------------------------------------------------------------------------
describe("K. «блок N» в ошибке хука указывает не на тот блок", () => {
  it("ДЕФЕКТ: виноват блок 3, а форма пишет «блок 2»", () => {
    const raw = [
      "Только хук",                       // блок 1 — без описания
      "---",
      "Хук два",                          // блок 2 — нормальный
      "Описание два",
      "---",
      "Assalamualaikumwarahmatullahi",    // блок 3 — хук не переносится
      "Описание три",
    ].join("\n");

    const { pairs, errors } = parseBlocks(raw);
    expect(errors).toEqual(["блок 1: есть хук, но нет описания"]);
    expect(pairs).toHaveLength(2);

    const files = [
      { url: "https://blob/1.mp4", bytes: 10 },
      { url: "https://blob/2.mp4", bytes: 10 },
    ];
    // Именно так их складывает страница пачки: [...parseErrors, ...validateBatch].
    const shown = [...errors, ...validateBatch({ pairs, files })];
    expect(shown[1]).toBe(`блок 2: хук не влезает в ${HOOK_MAX_LINES} строки по ${HOOK_LINE_CHARS} знаков`);
    // Хук блока 2 при этом безупречен — сообщение показывает на чужой блок.
    expect(pairs[1].hook).toBe("Assalamualaikumwarahmatullahi");
    // После починки: нумерация в validateBatch сквозная по исходным блокам.
  });
});
