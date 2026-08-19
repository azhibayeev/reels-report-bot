import { describe, expect, it, vi } from "vitest";
import {
  CATCH_UP_RESERVE_MS,
  classifyForCleanup,
  DAILY_BUDGET_MS,
  DailyDeps,
  ORPHAN_GRACE_MS,
  PURGE_AFTER_MS,
  REVIEW_EXPIRY_MS,
  runDaily,
  STUCK_AFTER_MS,
  TOKEN_WARN_MS,
} from "../lib/farm/daily";
import { Item } from "../lib/farm/types";

const base: Item = {
  itemId: "i1", batchId: "b1", chatId: -1, threadId: null, index: 1, total: 3,
  hook: "Хук", caption: "Описание", sourceUrl: "https://x/s.mp4", videoUrl: "https://out/v.mp4",
  messageId: null, editPromptId: null, status: "queued",
  renderingAt: null, postingAt: null, scheduledAt: null,
  igMediaId: null, permalink: null, error: null, createdAt: "2026-08-19T00:00:00.000Z",
};
const NOW = Date.parse("2026-08-19T12:00:00.000Z");

describe("classifyForCleanup", () => {
  it("завершённые старше 3 дней уходят в purge, свежие нет", () => {
    const old = { ...base, itemId: "old", status: "posted" as const, createdAt: new Date(NOW - PURGE_AFTER_MS - 1).toISOString() };
    const fresh = { ...base, itemId: "fresh", status: "posted" as const, createdAt: new Date(NOW - 1000).toISOString() };
    const { purge } = classifyForCleanup([old, fresh], NOW);
    expect(purge.map((i) => i.itemId)).toEqual(["old"]);
  });

  it("активные (queued) в purge не попадают никогда, даже старые", () => {
    const oldQueued = { ...base, itemId: "q", status: "queued" as const, createdAt: new Date(NOW - PURGE_AFTER_MS - 1).toISOString() };
    const { purge } = classifyForCleanup([oldQueued], NOW);
    expect(purge).toHaveLength(0);
  });

  it("review/editing старше 7 дней уходят в expire", () => {
    const oldReview = { ...base, itemId: "r", status: "review" as const, createdAt: new Date(NOW - REVIEW_EXPIRY_MS - 1).toISOString() };
    const oldEditing = { ...base, itemId: "e", status: "editing" as const, createdAt: new Date(NOW - REVIEW_EXPIRY_MS - 1).toISOString() };
    const freshReview = { ...base, itemId: "fr", status: "review" as const, createdAt: new Date(NOW - 1000).toISOString() };
    const { expire } = classifyForCleanup([oldReview, oldEditing, freshReview], NOW);
    expect(expire.map((i) => i.itemId).sort()).toEqual(["e", "r"]);
  });

  it("застрявшие rendering/posting старше 30 минут уходят в unstick", () => {
    const stuckRendering = { ...base, itemId: "sr", status: "rendering" as const, renderingAt: new Date(NOW - STUCK_AFTER_MS - 1).toISOString() };
    const stuckPosting = { ...base, itemId: "sp", status: "posting" as const, postingAt: new Date(NOW - STUCK_AFTER_MS - 1).toISOString() };
    const aliveRendering = { ...base, itemId: "ar", status: "rendering" as const, renderingAt: new Date(NOW - 1000).toISOString() };
    const { unstick } = classifyForCleanup([stuckRendering, stuckPosting, aliveRendering], NOW);
    expect(unstick.map((i) => i.itemId).sort()).toEqual(["sp", "sr"]);
  });

  it("пустая отметка времени падает обратно на createdAt", () => {
    const stuckByCreated = { ...base, itemId: "sc", status: "rendering" as const, renderingAt: null, createdAt: new Date(NOW - STUCK_AFTER_MS - 1).toISOString() };
    const freshByCreated = { ...base, itemId: "fc", status: "posting" as const, postingAt: null, createdAt: new Date(NOW - 1000).toISOString() };
    const { unstick } = classifyForCleanup([stuckByCreated, freshByCreated], NOW);
    expect(unstick.map((i) => i.itemId)).toEqual(["sc"]);
  });
});

function makeDailyDeps(overrides: Partial<DailyDeps> = {}): DailyDeps {
  return {
    now: () => NOW,
    listItems: vi.fn(async () => []),
    saveItem: vi.fn(async () => {}),
    deleteBlobQuiet: vi.fn(async () => {}),
    deleteItemRecord: vi.fn(async () => {}),
    listSources: vi.fn(async () => []),
    checkToken: vi.fn(async () => ({ valid: true, expiresAt: null, scopes: [] })),
    catchUpDue: vi.fn(async () => 0),
    notify: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("runDaily", () => {
  it("purge удаляет videoUrl, sourceUrl и запись задачи", async () => {
    const old = { ...base, itemId: "old", status: "posted" as const, createdAt: new Date(NOW - PURGE_AFTER_MS - 1).toISOString() };
    const deps = makeDailyDeps({ listItems: async () => [old] });

    const result = await runDaily(deps);

    expect(deps.deleteBlobQuiet).toHaveBeenCalledWith(old.videoUrl);
    expect(deps.deleteBlobQuiet).toHaveBeenCalledWith(old.sourceUrl);
    expect(deps.deleteItemRecord).toHaveBeenCalledWith("old");
    expect(result.purged).toBe(1);
  });

  it("expire шлёт ровно одно сообщение со списком номеров, а не N сообщений", async () => {
    const r1 = { ...base, itemId: "r1", index: 5, total: 12, status: "review" as const, createdAt: new Date(NOW - REVIEW_EXPIRY_MS - 1).toISOString() };
    const r2 = { ...base, itemId: "r2", index: 8, total: 12, status: "editing" as const, createdAt: new Date(NOW - REVIEW_EXPIRY_MS - 1).toISOString() };
    const deps = makeDailyDeps({ listItems: async () => [r1, r2] });

    const result = await runDaily(deps);

    expect(result.expired).toBe(2);
    const expireCalls = vi
      .mocked(deps.notify)
      .mock.calls.filter(([text]) => text.includes("5/12") || text.includes("8/12"));
    expect(expireCalls).toHaveLength(1);
    expect(expireCalls[0][0]).toContain("5/12");
    expect(expireCalls[0][0]).toContain("8/12");
    expect(deps.saveItem).toHaveBeenCalledWith(expect.objectContaining({ itemId: "r1", status: "rejected" }));
    expect(deps.deleteBlobQuiet).toHaveBeenCalledWith(r1.videoUrl);
  });

  it("expire в разных темах шлёт отдельное сообщение на каждую тему", async () => {
    const r1 = { ...base, itemId: "r1", index: 5, total: 12, threadId: 100, status: "review" as const, createdAt: new Date(NOW - REVIEW_EXPIRY_MS - 1).toISOString() };
    const r2 = { ...base, itemId: "r2", index: 8, total: 12, threadId: 200, status: "editing" as const, createdAt: new Date(NOW - REVIEW_EXPIRY_MS - 1).toISOString() };
    const deps = makeDailyDeps({ listItems: async () => [r1, r2] });

    const result = await runDaily(deps);

    expect(result.expired).toBe(2);
    const expireCalls = vi
      .mocked(deps.notify)
      .mock.calls.filter(([text]) => text.includes("5/12") || text.includes("8/12"));
    expect(expireCalls).toHaveLength(2);
    const call100 = expireCalls.find(([, threadId]) => threadId === 100);
    const call200 = expireCalls.find(([, threadId]) => threadId === 200);
    expect(call100?.[0]).toContain("5/12");
    expect(call200?.[0]).toContain("8/12");
  });

  it("saveItem падает у одного из двух просроченных в разных темах — уведомление только про выжившего", async () => {
    const r1 = { ...base, itemId: "r1", index: 5, total: 12, threadId: 100, status: "review" as const, createdAt: new Date(NOW - REVIEW_EXPIRY_MS - 1).toISOString() };
    const r2 = { ...base, itemId: "r2", index: 8, total: 12, threadId: 200, status: "editing" as const, createdAt: new Date(NOW - REVIEW_EXPIRY_MS - 1).toISOString() };
    const deps = makeDailyDeps({
      listItems: async () => [r1, r2],
      saveItem: vi.fn(async (item: Item) => {
        if (item.itemId === "r1") throw new Error("blob save failed");
      }),
    });

    const result = await runDaily(deps);

    expect(result.expired).toBe(1);
    const expireCalls = vi
      .mocked(deps.notify)
      .mock.calls.filter(([text]) => text.includes("Отклонены по сроку"));
    expect(expireCalls).toHaveLength(1);
    expect(expireCalls[0][1]).toBe(200);
    expect(expireCalls[0][0]).toContain("8/12");
    expect(expireCalls[0][0]).not.toContain("5/12");
  });

  it("saveItem падает у всех просроченных — уведомлений об отклонении по сроку нет", async () => {
    const r1 = { ...base, itemId: "r1", index: 5, total: 12, threadId: 100, status: "review" as const, createdAt: new Date(NOW - REVIEW_EXPIRY_MS - 1).toISOString() };
    const r2 = { ...base, itemId: "r2", index: 8, total: 12, threadId: 200, status: "editing" as const, createdAt: new Date(NOW - REVIEW_EXPIRY_MS - 1).toISOString() };
    const deps = makeDailyDeps({
      listItems: async () => [r1, r2],
      saveItem: vi.fn(async () => {
        throw new Error("blob save failed");
      }),
    });

    const result = await runDaily(deps);

    expect(result.expired).toBe(0);
    const expireCalls = vi
      .mocked(deps.notify)
      .mock.calls.filter(([text]) => text.includes("Отклонены по сроку"));
    expect(expireCalls).toHaveLength(0);
  });

  it("сообщение по застрявшему posting просит проверить ленту", async () => {
    const stuckPosting = { ...base, itemId: "sp", status: "posting" as const, postingAt: new Date(NOW - STUCK_AFTER_MS - 1).toISOString() };
    const deps = makeDailyDeps({ listItems: async () => [stuckPosting] });

    await runDaily(deps);

    const call = vi.mocked(deps.notify).mock.calls.find(([text]) => text.includes("ленту"));
    expect(call).toBeTruthy();
    expect(deps.saveItem).toHaveBeenCalledWith(expect.objectContaining({ itemId: "sp", status: "failed" }));
  });

  it("сообщение по застрявшему rendering не требует проверять ленту", async () => {
    const stuckRendering = { ...base, itemId: "sr", status: "rendering" as const, renderingAt: new Date(NOW - STUCK_AFTER_MS - 1).toISOString() };
    const deps = makeDailyDeps({ listItems: async () => [stuckRendering] });

    await runDaily(deps);

    const calls = vi.mocked(deps.notify).mock.calls.map(([text]) => text);
    expect(calls.some((t) => t.includes("sr") || t.includes("1/3"))).toBe(true);
    expect(calls.some((t) => t.includes("ленту"))).toBe(false);
  });

  it("осиротевшая подложка старше суток удаляется, свежая — нет", async () => {
    const orphanOld = { url: "https://x/orphan-old.mp4", uploadedAt: new Date(NOW - ORPHAN_GRACE_MS - 1) };
    const orphanFresh = { url: "https://x/orphan-fresh.mp4", uploadedAt: new Date(NOW - 1000) };
    const linked = { url: base.sourceUrl, uploadedAt: new Date(NOW - ORPHAN_GRACE_MS - 1) };
    const activeItem = { ...base, sourceUrl: linked.url };
    const deps = makeDailyDeps({
      listItems: async () => [activeItem],
      listSources: async () => [orphanOld, orphanFresh, linked],
    });

    await runDaily(deps);

    expect(deps.deleteBlobQuiet).toHaveBeenCalledWith(orphanOld.url);
    expect(deps.deleteBlobQuiet).not.toHaveBeenCalledWith(orphanFresh.url);
    expect(deps.deleteBlobQuiet).not.toHaveBeenCalledWith(linked.url);
  });

  it("исключение из checkToken говорит о недоступности проверки и не утверждает, что токен отозван", async () => {
    const deps = makeDailyDeps({
      checkToken: vi.fn(async () => {
        throw new Error("fetch failed: ECONNRESET");
      }),
    });

    await runDaily(deps);

    const calls = vi.mocked(deps.notify).mock.calls.map(([text]) => text);
    expect(calls.some((t) => t.includes("ECONNRESET"))).toBe(true);
    expect(calls.some((t) => /отозван/i.test(t))).toBe(false);
  });

  it("valid:false даёт сообщение о недействительном токене", async () => {
    const deps = makeDailyDeps({ checkToken: vi.fn(async () => ({ valid: false, expiresAt: null, scopes: [] })) });

    await runDaily(deps);

    const calls = vi.mocked(deps.notify).mock.calls.map(([text]) => text);
    expect(calls.some((t) => /недействителен/i.test(t))).toBe(true);
  });

  it("истекающий менее чем через 7 дней даёт предупреждение", async () => {
    const expiresAt = NOW + TOKEN_WARN_MS - 1000;
    const deps = makeDailyDeps({ checkToken: vi.fn(async () => ({ valid: true, expiresAt, scopes: [] })) });

    await runDaily(deps);

    const calls = vi.mocked(deps.notify).mock.calls.map(([text]) => text);
    expect(calls.some((t) => /истека/i.test(t))).toBe(true);
  });

  it("бессрочный токен (expiresAt = null) не даёт ни предупреждения, ни ошибки", async () => {
    const deps = makeDailyDeps({ checkToken: vi.fn(async () => ({ valid: true, expiresAt: null, scopes: [] })) });

    await runDaily(deps);

    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("токен, истекающий очень нескоро, не даёт предупреждения", async () => {
    const expiresAt = NOW + TOKEN_WARN_MS + 86_400_000;
    const deps = makeDailyDeps({ checkToken: vi.fn(async () => ({ valid: true, expiresAt, scopes: [] })) });

    await runDaily(deps);

    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("caughtUp приходит из catchUpDue", async () => {
    const deps = makeDailyDeps({ catchUpDue: vi.fn(async () => 2) });
    const result = await runDaily(deps);
    expect(result.caughtUp).toBe(2);
  });

  it("уборка съела бюджет — добор не начинается", async () => {
    const catchUpDue = vi.fn(async () => 3);
    const deps = makeDailyDeps({
      now: vi.fn().mockReturnValueOnce(NOW).mockReturnValue(NOW + DAILY_BUDGET_MS - CATCH_UP_RESERVE_MS + 1),
      catchUpDue,
    });

    const result = await runDaily(deps);

    expect(catchUpDue).not.toHaveBeenCalled();
    expect(result.caughtUp).toBe(0);
  });

  it("уборка уложилась в бюджет — добор выполняется", async () => {
    const catchUpDue = vi.fn(async () => 1);
    const deps = makeDailyDeps({
      now: vi.fn().mockReturnValueOnce(NOW).mockReturnValue(NOW + 1000),
      catchUpDue,
    });

    const result = await runDaily(deps);

    expect(catchUpDue).toHaveBeenCalledTimes(1);
    expect(result.caughtUp).toBe(1);
  });

  it("падение одного шага (удаление осиротевшего) не обрывает остальную уборку", async () => {
    const old = { ...base, itemId: "old", status: "posted" as const, createdAt: new Date(NOW - PURGE_AFTER_MS - 1).toISOString() };
    const deps = makeDailyDeps({
      listItems: async () => [old],
      listSources: vi.fn(async () => {
        throw new Error("blob list failed");
      }),
    });

    const result = await runDaily(deps);
    expect(result.purged).toBe(1);
  });
});
