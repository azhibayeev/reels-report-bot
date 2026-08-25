import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Ин-мемори Blob вместо @vercel/blob: путь данных настоящий (store.ts читает
// содержимое через fetch по url, как в проде), но без сети.
const store = vi.hoisted(() => {
  const BASE = "https://qa1.public.blob.vercel-storage.com/";
  const files = new Map<string, { pathname: string; url: string; body: string; uploadedAt: Date; size: number }>();
  let clock = { now: Date.parse("2026-08-19T00:00:00.000Z") };
  return { BASE, files, clock };
});

vi.mock("@vercel/blob", () => ({
  put: async (
    pathname: string,
    body: string | Uint8Array | Buffer,
    opts: { addRandomSuffix?: boolean }
  ) => {
    const finalPath = opts?.addRandomSuffix ? `${pathname}-${store.files.size}` : pathname;
    const text = typeof body === "string" ? body : Buffer.from(body).toString("binary");
    const entry = {
      pathname: finalPath,
      url: store.BASE + finalPath,
      body: text,
      uploadedAt: new Date(store.clock.now),
      size: text.length,
    };
    store.files.set(finalPath, entry);
    return { url: entry.url, pathname: finalPath, downloadUrl: entry.url, contentType: "application/json" };
  },
  list: async ({ prefix }: { prefix?: string } = {}) => ({
    blobs: [...store.files.values()]
      .filter((b) => !prefix || b.pathname.startsWith(prefix))
      .map((b) => ({ pathname: b.pathname, url: b.url, uploadedAt: b.uploadedAt, size: b.size })),
    hasMore: false,
    cursor: undefined,
  }),
  del: async (urlOrPathname: string | string[]) => {
    for (const key of Array.isArray(urlOrPathname) ? urlOrPathname : [urlOrPathname]) {
      const path = key.startsWith(store.BASE) ? key.slice(store.BASE.length) : key;
      store.files.delete(path);
    }
  },
  head: async (url: string) => {
    const path = url.startsWith(store.BASE) ? url.slice(store.BASE.length) : url;
    const entry = store.files.get(path);
    if (!entry) throw new Error("BlobNotFound");
    return { pathname: entry.pathname, url: entry.url, size: entry.size, uploadedAt: entry.uploadedAt };
  },
}));

import { handleCallback, handleEditReply, ApproveDeps } from "../lib/farm/approve";
import { createTrialContainer, fetchPermalink, publishContainer, waitForContainer } from "../lib/farm/instagram";
import { parseBlocks } from "../lib/farm/parse";
import { PostTickDeps, postOne, runPostTick } from "../lib/farm/post";
import { forgetHandedOutSlots, queueRendered } from "../lib/farm/queue";
import { nextFreeSlot, DEFAULT_SLOTS } from "../lib/farm/slots";
import { startBatch } from "../lib/farm/start";
import { deleteBlobQuiet, listItems, loadItem, saveBatch, saveItem } from "../lib/farm/store";
import { loadJournal, recordPublication } from "../lib/farm/journal";
import { formatSlot } from "../lib/farm/commands";
import { sendVideoWithButtons, answerCallback, askForReply, dropKeyboard, editCaption } from "../lib/farm/telegram";
import { runRenderTick, RenderTickDeps } from "../lib/farm/tick";
import { runDaily, DailyDeps } from "../lib/farm/daily";
import { Item } from "../lib/farm/types";

// ── Сеть: Telegram, Graph API и чтение блобов.
interface TgCall {
  method: string;
  body: Record<string, unknown>;
}
let tg: TgCall[] = [];
let graph: { url: string; body: Record<string, string> }[] = [];
let messageSeq = 0;
let mediaSeq = 0;
let tgFail: ((method: string, body: Record<string, unknown>) => string | null) | null = null;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);

  if (url.startsWith(store.BASE)) {
    const path = url.slice(store.BASE.length).split("?")[0];
    const entry = store.files.get(decodeURIComponent(path));
    if (!entry) return new Response("not found", { status: 404 });
    return new Response(entry.body, { status: 200 });
  }

  if (url.includes("api.telegram.org")) {
    const method = url.split("/").pop() as string;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    tg.push({ method, body });
    const failure = tgFail?.(method, body) ?? null;
    if (failure) return new Response(failure, { status: 400 });
    if (method === "sendVideo" || method === "sendMessage") {
      return jsonResponse({ ok: true, result: { message_id: ++messageSeq } });
    }
    return jsonResponse({ ok: true, result: true });
  }

  if (url.includes("graph.facebook.com")) {
    const body = init?.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : {};
    graph.push({ url, body });
    if (url.includes("/media_publish")) return jsonResponse({ id: `M${++mediaSeq}` });
    if (url.endsWith("/media")) return jsonResponse({ id: `C${graph.length}` });
    if (url.includes("fields=status_code")) return jsonResponse({ status_code: "FINISHED" });
    if (url.includes("fields=permalink")) return jsonResponse({ permalink: "https://instagram.com/reel/OK" });
    if (url.includes("debug_token")) {
      return jsonResponse({ data: { is_valid: true, expires_at: 0, scopes: ["instagram_content_publish"] } });
    }
    return jsonResponse({});
  }

  throw new Error(`unexpected fetch: ${url}`);
}

const CHAT = -1002200000000;

beforeEach(() => {
  store.files.clear();
  store.clock.now = Date.parse("2026-08-19T00:00:00.000Z");
  tg = [];
  graph = [];
  messageSeq = 0;
  mediaSeq = 0;
  tgFail = null;
  process.env.TELEGRAM_BOT_TOKEN = "T";
  process.env.TELEGRAM_CHAT_ID = String(CHAT);
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

// ── Кусочки прода, собранные так же, как в роутах.
function uploadSource(name: string, bytes = 5_000_000): { url: string; bytes: number } {
  const path = `farm/sources/${name}`;
  store.files.set(path, {
    pathname: path,
    url: store.BASE + path,
    body: "SOURCE",
    uploadedAt: new Date(store.clock.now),
    size: bytes,
  });
  return { url: store.BASE + path, bytes };
}

// Повторяет renderItem из app/api/farm/render/route.ts: кладёт готовый ролик в
// Blob по farm/out/<itemId>.mp4 и отдаёт публичный url.
async function fakeRenderItem(item: Item): Promise<string> {
  const path = `farm/out/${item.itemId}.mp4`;
  store.files.set(path, {
    pathname: path,
    url: store.BASE + path,
    body: "VIDEO",
    uploadedAt: new Date(store.clock.now),
    size: 8_000_000,
  });
  return store.BASE + path;
}

function renderDeps(over: Partial<RenderTickDeps> = {}): RenderTickDeps {
  return {
    now: () => store.clock.now,
    listItems,
    saveItem,
    renderItem: fakeRenderItem,
    queueRendered: (item) =>
      queueRendered(item, {
        now: () => store.clock.now,
        listItems,
        saveItem,
        nextFreeSlot: (taken, nowMs) => nextFreeSlot(taken, nowMs, DEFAULT_SLOTS),
      }),
    formatSlot: (iso: string) => iso,
    sendVideoWithButtons,
    deleteBlobQuiet,
    notify: async (text: string) => {
      tg.push({ method: "notify", body: { text } });
    },
    triggerRender: async () => {},
    ...over,
  };
}

function approveDeps(over: Partial<ApproveDeps> = {}): ApproveDeps {
  return {
    now: () => store.clock.now,
    loadItem,
    listItems,
    saveItem,
    deleteBlobQuiet,
    nextFreeSlot: (taken, nowMs) => nextFreeSlot(taken, nowMs, DEFAULT_SLOTS),
    answerCallback,
    dropKeyboard,
    editCaption,
    askForReply,
    sendVideoWithButtons,
    notify: async (text: string) => {
      tg.push({ method: "notify", body: { text } });
    },
    formatSlot: (iso) => formatSlot(iso),
    ...over,
  };
}

const IG = { token: "TOK", igUserId: "17841400000000000", sleep: async () => {} };

function postDeps(over: Partial<PostTickDeps> = {}): PostTickDeps {
  return {
    now: () => store.clock.now,
    loadItem,
    saveItem,
    listItems,
    loadCooldown: async () => null,
    loadPace: async () => null,
    savePace: async () => {},
    saveCooldown: async () => {},
    // Настоящая запись в журнал, а не заглушка: сквозной тест обязан ловить
    // разрыв между публикацией и журналом — ради него журнал и существует.
    recordPublication,
    createTrialContainer: (videoUrl, caption) => createTrialContainer(videoUrl, caption, IG),
    waitForContainer: (id) => waitForContainer(id, IG),
    publishContainer: (id) => publishContainer(id, IG),
    fetchPermalink: (id) => fetchPermalink(id, IG),
    deleteBlobQuiet,
    notify: async (text: string) => {
      tg.push({ method: "notify", body: { text } });
    },
    ...over,
  };
}

async function newBatch(text: string, files: { url: string; bytes: number }[]): Promise<string> {
  const { pairs, errors } = parseBlocks(text);
  expect(errors).toEqual([]);
  let n = 0;
  const { batchId } = await startBatch(
    { chatId: CHAT, threadId: null, pairs, files, position: "top" },
    {
      saveItem,
      saveBatch,
      deleteBlobQuiet,
      now: () => new Date(store.clock.now),
      newId: () => `id-${++n}-${store.clock.now}`,
      triggerRender: async () => {},
    }
  );
  return batchId;
}

const TEXT_TWO = "Хук один\nОписание первого\n---\nХук два\nОписание второго";

// Память о выданных слотах живёт на весь процесс — между тестами её чистим.
beforeEach(forgetHandedOutSlots);

describe("сквозной путь: загрузка → рендер → апрув → заливка → уборка", () => {
  it("доходит до posted, чистит исходник и готовый ролик", async () => {
    const files = [uploadSource("a.mp4"), uploadSource("b.mp4")];
    const batchId = await newBatch(TEXT_TWO, files);

    await runRenderTick(batchId, renderDeps());

    // Апрув руками отменён: собранный ролик встаёт в очередь сам, и каждому
    // достаётся свой слот — 09:00 и 09:45 по Джакарте.
    const afterRender = await listItems();
    expect(afterRender.map((i) => i.status)).toEqual(["queued", "queued"]);
    expect(afterRender.map((i) => i.scheduledAt).sort()).toEqual([
      "2026-08-19T02:00:00.000Z",
      "2026-08-19T02:45:00.000Z",
    ]);
    expect(tg.filter((c) => c.method === "sendVideo")).toHaveLength(2);
    expect([...store.files.keys()].filter((k) => k.startsWith("farm/sources/"))).toEqual([]);

    const first = afterRender.find((i) => i.index === 1)!;
    const queued = await loadItem(first.itemId);
    expect(queued?.status).toBe("queued");
    expect(queued?.scheduledAt).toBe("2026-08-19T02:00:00.000Z");

    store.clock.now = Date.parse("2026-08-19T02:00:00.000Z");
    const taken = await runPostTick(postDeps(), 1);
    expect(taken).toBe(1);

    const posted = await loadItem(first.itemId);
    expect(posted?.status).toBe("posted");
    expect(posted?.permalink).toBe("https://instagram.com/reel/OK");
    expect(posted?.igMediaId).toBe("M1");
    // Готовый ролик удалён после публикации (Global Constraints).
    expect(store.files.has(`farm/out/${first.itemId}.mp4`)).toBe(false);
    // Описание уехало в IG целиком.
    const container = graph.find((g) => g.url.endsWith("/media"))!;
    expect(container.body.caption).toBe("Описание первого");
    expect(JSON.parse(container.body.trial_params)).toEqual({ graduation_strategy: "MANUAL" });

    // Через четыре дня уборка сносит запись.
    store.clock.now = Date.parse("2026-08-23T02:00:00.000Z");
    const daily = await dailyDeps();
    const result = await runDaily(daily);
    expect(result.purged).toBe(1);
    expect(store.files.has(`farm/items/${first.itemId}.json`)).toBe(false);
  });

  it("правка описания возвращает ролик в очередь и уходит в IG новым текстом", async () => {
    const files = [uploadSource("a.mp4")];
    const batchId = await newBatch("Хук один\nСтарое описание", files);
    await runRenderTick(batchId, renderDeps());

    const [item] = await listItems();
    await handleCallback({ id: "cb", data: `e:${item.itemId}`, chatId: CHAT }, approveDeps());
    const editing = await loadItem(item.itemId);
    expect(editing?.status).toBe("editing");
    expect(editing?.editPromptId).not.toBeNull();

    const handled = await handleEditReply(
      { chatId: CHAT, threadId: null, text: "Новое описание", replyToMessageId: editing!.editPromptId! },
      approveDeps()
    );
    expect(handled).toBe(true);
    // Возврат именно в очередь: при автозаливке review стал бы тупиком, из
    // которого ролик уже никто не достанет.
    const back = await loadItem(item.itemId);
    expect(back?.status).toBe("queued");
    expect(back?.scheduledAt).toBe("2026-08-19T02:00:00.000Z");
    expect(back?.caption).toBe("Новое описание");

    store.clock.now = Date.parse("2026-08-19T02:00:00.000Z");
    await runPostTick(postDeps(), 1);

    const container = graph.find((g) => g.url.endsWith("/media"))!;
    expect(container.body.caption).toBe("Новое описание");
  });
});

async function dailyDeps(over: Partial<DailyDeps> = {}): Promise<DailyDeps> {
  const { list } = await import("@vercel/blob");
  return {
    now: () => store.clock.now,
    listItems,
    saveItem,
    deleteBlobQuiet,
    deleteItemRecord: async (id) => deleteBlobQuiet(`farm/items/${id}.json`),
    listSources: async () => {
      const { blobs } = await list({ prefix: "farm/sources/" });
      return blobs.map((b) => ({ url: b.url, uploadedAt: b.uploadedAt }));
    },
    checkToken: async () => ({ valid: true, expiresAt: null, scopes: [] }),
    catchUpDue: async () => runPostTick(postDeps(), 1),
    notify: async (text: string) => {
      tg.push({ method: "notify", body: { text } });
    },
    ...over,
  };
}

describe("разрывы между слоями", () => {
  it("отвал Telegram на sendVideo не отменяет публикацию: ролик остаётся в очереди", async () => {
    // Прежде карточка была разрешением, и не ушедшая карточка означала
    // потерянный ролик: его помечали failed и тут же сносили видео. С отменой
    // ручного апрува карточка стала уведомлением — слот выдан раньше отправки,
    // и недоступный мессенджер не повод срывать назначенную публикацию.
    const files = [uploadSource("a.mp4")];
    const batchId = await newBatch("Хук один\nОписание", files);
    tgFail = (method) => (method === "sendVideo" ? "Bad Request: video is too big" : null);

    await runRenderTick(batchId, renderDeps());

    const [item] = await listItems();
    expect(item.status).toBe("queued");
    expect(item.scheduledAt).toBe("2026-08-19T02:00:00.000Z");
    expect(item.videoUrl).not.toBeNull();
    // Карточки в чате нет, а ролик есть — именно так и задумано.
    expect(item.messageId).toBeNull();
    expect(store.files.has(`farm/out/${item.itemId}.mp4`)).toBe(true);

    // И он действительно выходит в свой слот, без всякого участия человека.
    store.clock.now = Date.parse("2026-08-19T02:00:00.000Z");
    tgFail = () => null;
    expect(await runPostTick(postDeps(), 1)).toBe(1);
    expect((await loadItem(item.itemId))?.status).toBe("posted");
  });

  it("два тика заливки, идущие внахлёст, публикуют один ролик дважды", async () => {
    const files = [uploadSource("a.mp4")];
    const batchId = await newBatch("Хук один\nОписание", files);
    await runRenderTick(batchId, renderDeps());
    const [item] = await listItems();
    store.clock.now = Date.parse("2026-08-19T01:30:00.000Z");
    await handleCallback({ id: "cb", data: `a:${item.itemId}`, chatId: CHAT }, approveDeps());
    store.clock.now = Date.parse("2026-08-19T02:00:00.000Z");

    const fresh = await loadItem(item.itemId);
    // Внешний таймер (/api/farm/post) и суточный крон (catchUpDue) могут попасть
    // в один и тот же просроченный слот: оба читают "queued" до того, как первый
    // успел записать "posting".
    await Promise.all([postOne(fresh!, postDeps()), postOne(fresh!, postDeps())]);

    const publishes = graph.filter((g) => g.url.includes("/media_publish"));
    expect(publishes).toHaveLength(1);
  });

  // Документирует пробел, а не требование спеки: список уборки в Global Constraints
  // статуса pending не упоминает вовсе.
  it("пачка, чья цепочка рендера умерла, не убирается никогда", async () => {
    const files = [uploadSource("a.mp4")];
    await newBatch("Хук один\nОписание", files);
    const [item] = await listItems();
    expect(item.status).toBe("pending");

    // Месяц спустя: ни purge, ни expire, ни unstick её не видят.
    store.clock.now = Date.parse("2026-09-19T02:00:00.000Z");
    const result = await runDaily(await dailyDeps());
    expect(result).toMatchObject({ purged: 0, expired: 0, unstuck: 0 });
    expect(store.files.has(`farm/items/${item.itemId}.json`)).toBe(true);
    expect([...store.files.keys()].filter((k) => k.startsWith("farm/sources/"))).toHaveLength(1);
  });

  it("временная ошибка Graph не выдаётся за отзыв токена", async () => {
    const { checkToken } = await import("../lib/farm/token");
    // Graph отдал 500 — про токен мы ничего не узнали.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("debug_token")) return new Response("server error", { status: 500 });
        return fakeFetch(input, init);
      })
    );

    const deps = await dailyDeps({ checkToken: () => checkToken("TOK") });
    await runDaily(deps);

    const alarms = tg.filter((c) => c.method === "notify" && String(c.body.text).includes("недействителен"));
    expect(alarms).toHaveLength(0);
  });

  it("сбой удаления видео при отклонении по сроку не лишает чат уведомления", async () => {
    const files = [uploadSource("a.mp4")];
    const batchId = await newBatch("Хук один\nОписание", files);
    await runRenderTick(batchId, renderDeps());
    const [rendered] = await listItems();
    // Ролик кладём обратно в review руками: сам он туда больше не попадает —
    // апрув отменён, — а проверяем мы уборку просроченного review, и она
    // остаётся нужной для роликов, снятых с очереди правкой описания.
    await saveItem({ ...rendered, status: "review", scheduledAt: null });
    const item = rendered;

    // Восемь дней спустя: review истёк.
    store.clock.now = Date.parse("2026-08-27T02:00:00.000Z");
    const deps = await dailyDeps({
      deleteBlobQuiet: async () => {
        throw new Error("blob down");
      },
    });
    const result = await runDaily(deps);

    const saved = await loadItem(item.itemId);
    expect(saved?.status).toBe("rejected");
    // Задача уже отклонена — молчать про это нельзя.
    expect(tg.filter((c) => c.method === "notify" && String(c.body.text).includes("Отклонены по сроку"))).toHaveLength(1);
    expect(result.expired).toBe(1);
  });
});
