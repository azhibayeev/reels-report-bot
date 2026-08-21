import { describe, expect, it, vi } from "vitest";
import { COOLDOWN_STEPS_MS, isPaused, nextCooldown, STRIKE_RESET_MS } from "../lib/farm/cooldown";
import { isRateBlock, lastPostedAt, postOne, publishGapMs, runPostTick, PostDeps, PostTickDeps } from "../lib/farm/post";
import { rateBlockedItems } from "../lib/farm/commands";
import { Item } from "../lib/farm/types";

// Дословно то, что пришло с прода 21.08.2026 — шесть роликов подряд легли на
// этом отказе, и ни один шаблон временных сбоев его не узнавал.
const BLOCK = "IG не опубликовал ролик (HTTP 400): User is performing too many actions";

const base: Item = {
  itemId: "i1", batchId: "b1", chatId: 42, threadId: null, index: 16, total: 60,
  hook: "Хук", caption: "Описание", sourceUrl: "https://x/s.mp4", videoUrl: "https://out/video.mp4",
  messageId: null, editPromptId: null, status: "queued",
  renderingAt: null, postingAt: null, scheduledAt: "2026-08-21T05:15:00.000Z",
  igMediaId: null, permalink: null, error: null, createdAt: "2026-08-21T00:00:00.000Z",
};
const NOW = Date.parse("2026-08-21T05:15:00.000Z");

function makeDeps(overrides: Partial<PostDeps> = {}): PostDeps {
  return {
    now: () => NOW,
    loadItem: vi.fn(async () => ({ ...base })),
    saveItem: vi.fn(async () => {}),
    createTrialContainer: vi.fn(async () => "C1"),
    waitForContainer: vi.fn(async () => {}),
    publishContainer: vi.fn(async () => {
      throw new Error(BLOCK);
    }),
    fetchPermalink: vi.fn(async () => ""),
    deleteBlobQuiet: vi.fn(async () => {}),
    notify: vi.fn(async () => {}),
    recordPublication: vi.fn(async () => {}),
    loadCooldown: vi.fn(async () => null),
    saveCooldown: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("распознавание блока по частоте действий", () => {
  it("узнаёт живой отказ с прода", () => {
    expect(isRateBlock(BLOCK)).toBe(true);
  });

  it("узнаёт код 9 в обоих написаниях", () => {
    expect(isRateBlock("IG контейнер не создан (HTTP 400): (#9) Something went wrong")).toBe(true);
    expect(isRateBlock("Graph error, code: 9, type OAuthException")).toBe(true);
  });

  it("не путает с отказом по токену: #190 — это не #9", () => {
    expect(isRateBlock("(#190) Invalid OAuth access token")).toBe(false);
  });

  it("разовую пятисотку блоком не считает — иначе ферма встала бы на час из-за икоты", () => {
    expect(isRateBlock("IG не опубликовал ролик (HTTP 500): Please try again later")).toBe(false);
  });
});

describe("шаг паузы", () => {
  it("растёт от повторов: час, два, четыре, восемь", () => {
    let cooldown = nextCooldown(null, NOW, BLOCK);
    const steps = [cooldown];
    for (let i = 0; i < 3; i += 1) {
      const at = Date.parse(steps[steps.length - 1].until);
      steps.push(nextCooldown(steps[steps.length - 1], at, BLOCK));
    }
    const lengths = steps.map((c) => Date.parse(c.until) - Date.parse(c.since));
    expect(lengths).toEqual(COOLDOWN_STEPS_MS);
  });

  it("выше последнего шага не поднимается", () => {
    const deep = { until: new Date(NOW).toISOString(), since: new Date(NOW).toISOString(), strikes: 99, reason: BLOCK };
    const next = nextCooldown(deep, NOW, BLOCK);
    expect(Date.parse(next.until) - NOW).toBe(COOLDOWN_STEPS_MS[COOLDOWN_STEPS_MS.length - 1]);
  });

  it("через полсуток тишины серия начинается заново", () => {
    const old = {
      until: new Date(NOW).toISOString(),
      since: new Date(NOW - STRIKE_RESET_MS - 1).toISOString(),
      strikes: 4,
      reason: BLOCK,
    };
    expect(nextCooldown(old, NOW, BLOCK).strikes).toBe(1);
  });

  it("битая запись не ломает счёт — начинаем с первого шага", () => {
    const broken = { until: "не дата", since: "не дата", strikes: 3, reason: BLOCK };
    const next = nextCooldown(broken, NOW, BLOCK);
    expect(next.strikes).toBe(1);
    expect(Date.parse(next.until) - NOW).toBe(COOLDOWN_STEPS_MS[0]);
  });

  it("битую дату окончания за паузу не принимаем", () => {
    expect(isPaused({ until: "мусор", since: "мусор", strikes: 1, reason: BLOCK }, NOW)).toBe(false);
  });
});

describe("postOne на блоке по частоте", () => {
  it("ролик остаётся в очереди, а не уходит в failed", async () => {
    const saveItem = vi.fn(async (_item: Item) => {});
    await postOne(base, makeDeps({ saveItem }));

    const last = saveItem.mock.calls.map((c) => c[0] as Item).at(-1)!;
    expect(last.status).toBe("queued");
    expect(last.postingAt).toBeNull();
  });

  it("не тратит попытку: виновата частота, а не ролик", async () => {
    const saveItem = vi.fn(async (_item: Item) => {});
    await postOne({ ...base, postAttempts: 2 }, makeDeps({ saveItem, loadItem: async () => ({ ...base, postAttempts: 2 }) }));

    const last = saveItem.mock.calls.map((c) => c[0] as Item).at(-1)!;
    expect(last.postAttempts).toBe(2);
  });

  it("встаёт на выход сразу после паузы, а не остаётся с просроченным слотом", async () => {
    const saveItem = vi.fn(async (_item: Item) => {});
    const saveCooldown = vi.fn(async () => {});
    await postOne(base, makeDeps({ saveItem, saveCooldown }));

    const last = saveItem.mock.calls.map((c) => c[0] as Item).at(-1)!;
    expect(Date.parse(last.scheduledAt!)).toBe(NOW + COOLDOWN_STEPS_MS[0]);
  });

  it("объявляет паузу всей заливке", async () => {
    const saveCooldown = vi.fn(async () => {});
    await postOne(base, makeDeps({ saveCooldown }));

    expect(saveCooldown).toHaveBeenCalledTimes(1);
    expect(saveCooldown.mock.calls[0][0]).toMatchObject({ strikes: 1, reason: BLOCK });
  });

  it("сообщает человеку один раз, а не по ролику на каждый слот", async () => {
    const notify = vi.fn(async () => {});
    const running = {
      until: new Date(NOW + 30 * 60_000).toISOString(),
      since: new Date(NOW - 30 * 60_000).toISOString(),
      strikes: 1,
      reason: BLOCK,
    };
    const saveCooldown = vi.fn(async () => {});
    // Пауза уже идёт, но ролик всё равно дошёл до Graph — так бывает, когда
    // другой инстанс ещё не увидел записи в Blob.
    await postOne(base, makeDeps({ notify, saveCooldown, loadCooldown: async () => running }));

    expect(notify).not.toHaveBeenCalled();
    // И шаг не растим: блок тот же самый, а не новый.
    expect(saveCooldown).not.toHaveBeenCalled();
  });

  it("в первом сообщении есть и причина, и срок", async () => {
    const notify = vi.fn(async () => {});
    await postOne(base, makeDeps({ notify }));

    const text = notify.mock.calls[0][0] as string;
    expect(text).toContain("too many actions");
    expect(text).toMatch(/пауз/i);
    expect(text).toContain("/reels");
  });

  it("непрочитанная пауза не оставляет ролик в posting навсегда", async () => {
    const saveItem = vi.fn(async (_item: Item) => {});
    await postOne(
      base,
      makeDeps({
        saveItem,
        loadCooldown: async () => {
          throw new Error("Blob недоступен");
        },
      })
    );

    const last = saveItem.mock.calls.map((c) => c[0] as Item).at(-1)!;
    expect(last.status).toBe("queued");
  });
});

function tickDeps(overrides: Partial<PostTickDeps> = {}): PostTickDeps {
  return {
    ...makeDeps({ publishContainer: vi.fn(async () => "M1") }),
    listItems: vi.fn(async () => [{ ...base }]),
    ...overrides,
  };
}

describe("runPostTick", () => {
  it("на паузе не ходит в Instagram вовсе: отвергнутые попытки продлевают блок", async () => {
    const publishContainer = vi.fn(async () => "M1");
    const listItems = vi.fn(async () => [{ ...base }]);
    const paused = {
      until: new Date(NOW + 60 * 60_000).toISOString(),
      since: new Date(NOW).toISOString(),
      strikes: 1,
      reason: BLOCK,
    };

    const taken = await runPostTick(tickDeps({ publishContainer, listItems, loadCooldown: async () => paused }));

    expect(taken).toBe(0);
    expect(publishContainer).not.toHaveBeenCalled();
    expect(listItems).not.toHaveBeenCalled();
  });

  it("кончившаяся пауза заливку не держит", async () => {
    const expired = {
      until: new Date(NOW - 1).toISOString(),
      since: new Date(NOW - 60 * 60_000).toISOString(),
      strikes: 1,
      reason: BLOCK,
    };
    expect(await runPostTick(tickDeps({ loadCooldown: async () => expired }))).toBe(1);
  });

  it("недоступный Blob не глушит заливку насовсем", async () => {
    const taken = await runPostTick(
      tickDeps({
        loadCooldown: async () => {
          throw new Error("Blob недоступен");
        },
      })
    );
    expect(taken).toBe(1);
  });

  it("не разгоняется на просрочке: между публикациями держит паузу", async () => {
    // Три просроченных ролика и свежая публикация десять минут назад — добор
    // именно так и разгонял очередь втрое после того, как аккаунт наказали.
    const overdue = [1, 2, 3].map((n) => ({ ...base, itemId: `i${n}`, index: n }));
    const justPosted = { ...base, itemId: "done", status: "posted" as const, postedAt: new Date(NOW - 10 * 60_000).toISOString() };
    const publishContainer = vi.fn(async () => "M1");

    const taken = await runPostTick(
      tickDeps({
        publishContainer,
        listItems: async () => [...overdue, justPosted],
        minGapMs: 22 * 60_000,
      }),
      3
    );

    expect(taken).toBe(0);
    expect(publishContainer).not.toHaveBeenCalled();
  });

  it("когда пауза между публикациями вышла — заливает", async () => {
    const justPosted = { ...base, itemId: "done", status: "posted" as const, postedAt: new Date(NOW - 40 * 60_000).toISOString() };
    const taken = await runPostTick(
      tickDeps({ listItems: async () => [{ ...base }, justPosted], minGapMs: 22 * 60_000 }),
      3
    );
    expect(taken).toBe(1);
  });

  it("собственная публикация этого же прохода тоже считается — Blob отдаёт запись не сразу", async () => {
    const stale = [1, 2].map((n) => ({ ...base, itemId: `i${n}`, index: n }));
    // listItems всё время отдаёт обоих queued: запись первой публикации ещё не видна.
    const taken = await runPostTick(tickDeps({ listItems: async () => stale, minGapMs: 22 * 60_000 }), 2);
    expect(taken).toBe(1);
  });
});

describe("lastPostedAt", () => {
  it("считает и заливку в работе: два инстанса не должны разгонять темп вдвоём", () => {
    const posting = { ...base, status: "posting" as const, postingAt: new Date(NOW - 60_000).toISOString() };
    expect(lastPostedAt([posting])).toBe(NOW - 60_000);
  });

  it("берёт самую свежую отметку", () => {
    const old = { ...base, itemId: "a", postedAt: new Date(NOW - 3 * 3_600_000).toISOString() };
    const recent = { ...base, itemId: "b", postedAt: new Date(NOW - 60_000).toISOString() };
    expect(lastPostedAt([old, recent])).toBe(NOW - 60_000);
  });

  it("без отметок — null, а не ноль: иначе гэп считался бы от 1970 года", () => {
    expect(lastPostedAt([base])).toBeNull();
  });
});

describe("publishGapMs", () => {
  it("половина ритма: заливка занимает минуты, и полный ритм копил бы отставание", () => {
    expect(publishGapMs(45)).toBe(22.5 * 60_000);
  });

  it("выше получаса не поднимается — редкий ритм не должен ещё и тормозить добор", () => {
    expect(publishGapMs(180)).toBe(25 * 60_000);
  });

  it("мусор на входе выключает ограничение, а не ломает заливку", () => {
    expect(publishGapMs(NaN)).toBe(0);
  });
});

describe("rateBlockedItems", () => {
  const killed = { ...base, status: "failed" as const, error: BLOCK };

  it("находит роликов, убитых блоком до появления паузы", () => {
    expect(rateBlockedItems([killed]).map((i) => i.itemId)).toEqual(["i1"]);
  });

  it("не трогает упавших на сборке: у них видео нет, им нужен рендер", () => {
    expect(rateBlockedItems([{ ...killed, videoUrl: null }])).toEqual([]);
  });

  it("не трогает прочих упавших на заливке: там повтор рискует дублем в ленте", () => {
    expect(rateBlockedItems([{ ...killed, error: "IG отбраковал ролик (ERROR): битый файл" }])).toEqual([]);
  });
});
