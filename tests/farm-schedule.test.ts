import { describe, expect, it } from "vitest";
import { normalizeSchedule, rescheduleAfterPause } from "../lib/farm/schedule";
import { Item } from "../lib/farm/types";

const base: Item = {
  itemId: "i", batchId: "b1", chatId: -1, threadId: null, index: 1, total: 60,
  hook: "Хук", caption: "Описание", sourceUrl: "https://x/s.mp4", videoUrl: "https://out/v.mp4",
  messageId: null, editPromptId: null, status: "queued",
  renderingAt: null, postingAt: null, scheduledAt: null,
  igMediaId: null, permalink: null, error: null, createdAt: "2026-08-20T00:00:00.000Z",
};
const NOW = Date.parse("2026-08-20T12:00:00.000Z");
const q = (index: number, at: string, over: Partial<Item> = {}): Item => ({
  ...base, itemId: `i${index}`, index, scheduledAt: at, ...over,
});

// Сетка из теста: каждые 45 минут, начиная с 13:00.
const grid = Array.from({ length: 40 }, (_, i) =>
  new Date(Date.parse("2026-08-20T13:00:00.000Z") + i * 45 * 60_000).toISOString()
);
const nextFreeSlot = (taken: string[]) => grid.find((s) => !taken.includes(s))!;

describe("normalizeSchedule", () => {
  it("расселяет ролики, слипшиеся в один слот", () => {
    // Ровно то, что вышло на проде: замок работает внутри процесса, но ролики
    // рендерятся на разных инстансах Vercel одновременно, и там он бессилен.
    // Пятьдесят два уникальных времени на пятьдесят девять роликов.
    const items = [q(1, grid[0]), q(2, grid[0]), q(3, grid[0])];

    const changes = normalizeSchedule(items, NOW, nextFreeSlot);

    expect(changes).toHaveLength(2);
    const after = items.map((i) => changes.find((c) => c.itemId === i.itemId)?.scheduledAt ?? i.scheduledAt);
    expect(new Set(after).size).toBe(3);
    // Первый остаётся на месте: двигаем только опоздавших, иначе расписание
    // перетряхивалось бы целиком на каждом проходе.
    expect(after[0]).toBe(grid[0]);
  });

  it("повторный проход ничего не меняет", () => {
    // Уборка идёт каждые пять минут; неустойчивая нормализация гоняла бы
    // ролики по сетке бесконечно и слала бы правки в Blob на пустом месте.
    const items = [q(1, grid[0]), q(2, grid[0])];
    for (const c of normalizeSchedule(items, NOW, nextFreeSlot)) {
      items.find((i) => i.itemId === c.itemId)!.scheduledAt = c.scheduledAt;
    }
    expect(normalizeSchedule(items, NOW, nextFreeSlot)).toEqual([]);
  });

  it("чистое расписание не трогает вовсе", () => {
    const items = [q(1, grid[0]), q(2, grid[1]), q(3, grid[2])];
    expect(normalizeSchedule(items, NOW, nextFreeSlot)).toEqual([]);
  });

  it("время уже опубликованных занято и повторно не выдаётся", () => {
    const items = [
      q(1, grid[0], { status: "posted" }),
      q(2, grid[0]),
    ];
    const changes = normalizeSchedule(items, NOW, nextFreeSlot);
    expect(changes).toHaveLength(1);
    expect(changes[0].itemId).toBe("i2");
    expect(changes[0].scheduledAt).not.toBe(grid[0]);
  });

  it("уходящий прямо сейчас ролик не двигаем: его слот уже сработал", () => {
    const items = [q(1, grid[0], { status: "posting" }), q(2, grid[0])];
    const changes = normalizeSchedule(items, NOW, nextFreeSlot);
    expect(changes.map((c) => c.itemId)).toEqual(["i2"]);
  });

  it("выкинутый ролик слот не держит — иначе в сетке навсегда дыра", () => {
    const items = [q(1, grid[0], { status: "rejected" }), q(2, grid[0])];
    expect(normalizeSchedule(items, NOW, nextFreeSlot)).toEqual([]);
  });

  it("порядок сохраняется: кто стоял раньше, тот и уходит раньше", () => {
    const items = [q(5, grid[1]), q(2, grid[0]), q(3, grid[0])];
    for (const c of normalizeSchedule(items, NOW, nextFreeSlot)) {
      items.find((i) => i.itemId === c.itemId)!.scheduledAt = c.scheduledAt;
    }
    const sorted = [...items].sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));
    expect(sorted.map((i) => i.index)).toEqual([2, 3, 5]);
  });

  it("ролик без времени не трогаем: он не в расписании", () => {
    const items = [q(1, grid[0]), { ...base, itemId: "x", status: "pending" as const, scheduledAt: null }];
    expect(normalizeSchedule(items, NOW, nextFreeSlot)).toEqual([]);
  });
});

// Сетка «после паузы»: те же 45 минут, но с 20:00 — так, чтобы просроченные
// ролики не могли занять слот раньше момента выхода из паузы.
const RESUME = Date.parse("2026-08-20T20:00:00.000Z");
const lateGrid = Array.from({ length: 40 }, (_, i) => new Date(RESUME + i * 45 * 60_000).toISOString());
const nextFreeAfterResume = (taken: string[]) => lateGrid.find((s) => !taken.includes(s))!;

describe("rescheduleAfterPause", () => {
  it("просроченные за паузу ролики уходят на сетку, а не вываливаются разом", () => {
    // Ровно то, что вышло на проде 22.08.2026: пауза на восемь часов, за неё
    // просрочилось полтора десятка слотов, и после паузы очередь пошла подряд
    // — в том числе ночью, мимо дневного окна и мимо лимита роликов в сутки.
    const items = [q(1, grid[0]), q(2, grid[1]), q(3, grid[2])];

    const changes = rescheduleAfterPause(items, RESUME, nextFreeAfterResume);

    expect(changes.map((c) => c.scheduledAt)).toEqual([lateGrid[0], lateGrid[1], lateGrid[2]]);
  });

  it("первым идёт тот, кто стоял первым: блок его задержал, а не отправил в конец", () => {
    // Раньше ролик, поймавший блок, отодвигался ровно на конец паузы — и
    // оказывался позади всех, кто просрочился следом: pickDue берёт самый
    // ранний слот, а конец паузы позже любого из них.
    const items = [q(7, grid[3]), q(4, grid[0]), q(5, grid[1])];

    const changes = rescheduleAfterPause(items, RESUME, nextFreeAfterResume);
    const first = changes.find((c) => c.scheduledAt === lateGrid[0])!;

    expect(first.itemId).toBe("i4");
  });

  it("повторный проход ничего не двигает: пауза длинная, а будильник частый", () => {
    const items = [q(1, grid[0]), q(2, grid[1])];
    for (const c of rescheduleAfterPause(items, RESUME, nextFreeAfterResume)) {
      items.find((i) => i.itemId === c.itemId)!.scheduledAt = c.scheduledAt;
    }

    expect(rescheduleAfterPause(items, RESUME, nextFreeAfterResume)).toEqual([]);
  });

  it("тех, чей слот и так после паузы, не трогает — их время не прошло", () => {
    const items = [q(1, lateGrid[5])];
    expect(rescheduleAfterPause(items, RESUME, nextFreeAfterResume)).toEqual([]);
  });

  it("занятое время второй раз не выдаёт", () => {
    // posted/posting держат свои слоты: они уже сработали, и наложить на них
    // просроченный ролик значило бы вернуть ту же слипшуюся сетку.
    const items = [q(1, grid[0]), q(2, lateGrid[0], { status: "posted" })];

    const changes = rescheduleAfterPause(items, RESUME, nextFreeAfterResume);

    expect(changes).toEqual([{ itemId: "i1", scheduledAt: lateGrid[1] }]);
  });

  it("упавших и выкинутых в расписание не возвращает", () => {
    const items = [q(1, grid[0], { status: "failed" }), q(2, grid[1], { status: "rejected" })];
    expect(rescheduleAfterPause(items, RESUME, nextFreeAfterResume)).toEqual([]);
  });
});
