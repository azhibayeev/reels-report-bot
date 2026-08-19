// QA раунд 2: сквозной путь через настоящие роуты (app/api/farm/*, app/api/telegram),
// а не только через lib. Blob и сеть заменены памятью/диспетчером fetch.
import { beforeEach, describe, expect, it, vi } from "vitest";

// Роут /api/farm/start проверяет хост ссылки регуляркой — база обязана выглядеть
// как настоящий Blob-стор, иначе файлы отвергаются ещё до создания задач.
const BASE = "https://store1.public.blob.vercel-storage.com/";

interface Row {
  pathname: string;
  url: string;
  body: string;
  size: number;
  uploadedAt: Date;
}

const blobs = new Map<string, Row>();
let putFail: ((pathname: string) => boolean) | null = null;

const put = vi.fn(async (pathname: string, body: unknown) => {
  if (putFail?.(pathname)) throw new Error(`put failed: ${pathname}`);
  const text = typeof body === "string" ? body : Buffer.from(body as Uint8Array).toString("utf8");
  const row: Row = {
    pathname,
    url: `${BASE}${pathname}`,
    body: text,
    size: text.length,
    uploadedAt: new Date(),
  };
  blobs.set(pathname, row);
  return { url: row.url, pathname };
});

const list = vi.fn(async ({ prefix }: { prefix: string }) => ({
  blobs: [...blobs.values()].filter((b) => b.pathname.startsWith(prefix)),
  hasMore: false,
  cursor: undefined,
}));

const del = vi.fn(async (urlOrPath: string | string[]) => {
  for (const one of Array.isArray(urlOrPath) ? urlOrPath : [urlOrPath]) {
    const path = one.startsWith(BASE) ? one.slice(BASE.length) : one;
    blobs.delete(path);
  }
});

const head = vi.fn(async (url: string) => {
  const row = [...blobs.values()].find((b) => b.url === url);
  if (!row) throw new Error("not found");
  return { url: row.url, pathname: row.pathname, size: row.size, uploadedAt: row.uploadedAt };
});

vi.mock("@vercel/blob", () => ({ put, list, del, head }));

import { NextRequest } from "next/server";
import { signBatchToken } from "../lib/farm/tokens";
import { Item } from "../lib/farm/types";

// Что улетело наружу за тест: письма в Telegram, вызовы Graph, пинки цепочки рендера.
interface Sent {
  telegram: { method: string; body: Record<string, unknown> }[];
  graph: string[];
  triggers: string[];
}
let sent: Sent;
let telegramFail: ((method: string) => number | null) | null = null;
// Пути блобов, чтение которых отвечает 5xx: так ведёт себя CDN Blob при сбое.
let readFail = new Set<string>();
let graphFail: ((url: string) => number | null) | null = null;

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { method?: string; body?: unknown }) => {
      const url = String(input);

      if (url.startsWith(BASE)) {
        const path = url.slice(BASE.length).split("?")[0];
        if (readFail.has(path)) return new Response("upstream error", { status: 503 });
        const row = blobs.get(path);
        if (!row) return new Response("not found", { status: 404 });
        return new Response(row.body, { status: 200 });
      }

      if (url.includes("api.telegram.org")) {
        const method = url.split("/").pop() as string;
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        sent.telegram.push({ method, body });
        const status = telegramFail?.(method) ?? null;
        if (status) return new Response("telegram is down", { status });
        return new Response(JSON.stringify({ ok: true, result: { message_id: sent.telegram.length } }), {
          status: 200,
        });
      }

      if (url.includes("graph.facebook.com")) {
        sent.graph.push(url);
        const status = graphFail?.(url) ?? null;
        if (status) {
          return new Response(JSON.stringify({ error: { message: "boom", code: status } }), { status });
        }
        if (url.includes("/media_publish")) return new Response(JSON.stringify({ id: "M1" }), { status: 200 });
        if (url.includes("/media")) return new Response(JSON.stringify({ id: "C1" }), { status: 200 });
        if (url.includes("fields=permalink")) {
          return new Response(JSON.stringify({ permalink: "https://instagram.com/reel/X" }), { status: 200 });
        }
        if (url.includes("debug_token")) {
          return new Response(JSON.stringify({ data: { is_valid: true, expires_at: 0 } }), { status: 200 });
        }
        return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
      }

      if (url.includes("/api/farm/render")) {
        sent.triggers.push(url);
        return new Response(JSON.stringify({ ok: true }), { status: 202 });
      }

      throw new Error(`unexpected fetch: ${url}`);
    })
  );
}

function items(): Item[] {
  return [...blobs.values()]
    .filter((b) => b.pathname.startsWith("farm/items/"))
    .map((b) => JSON.parse(b.body) as Item)
    .sort((a, b) => a.index - b.index);
}

function putSource(name: string, bytes = 1024): string {
  const path = `farm/sources/${name}`;
  blobs.set(path, {
    pathname: path,
    url: `${BASE}${path}`,
    body: "x".repeat(bytes),
    size: bytes,
    uploadedAt: new Date(),
  });
  return `${BASE}${path}`;
}

beforeEach(() => {
  blobs.clear();
  putFail = null;
  telegramFail = null;
  graphFail = null;
  readFail = new Set();
  sent = { telegram: [], graph: [], triggers: [] };
  put.mockClear();
  list.mockClear();
  del.mockClear();
  head.mockClear();
  process.env.TELEGRAM_BOT_TOKEN = "T";
  process.env.TELEGRAM_CHAT_ID = "-100500";
  process.env.CRON_SECRET = "cron";
  process.env.FARM_TOKEN_SECRET = "s3cret";
  process.env.FARM_BASE_URL = "https://app.test";
  process.env.FARM_IG_TOKEN = "IGTOKEN";
  process.env.FARM_IG_ID = "17841400000000000";
  delete process.env.TELEGRAM_THREAD_ID;
  installFetch();
});

async function startRoute() {
  return (await import("../app/api/farm/start/route")).POST;
}

function batchToken(threadId: number | null = 42): string {
  return signBatchToken(-100500, threadId, Date.now() + 60_000, "s3cret");
}

function startRequest(body: unknown): NextRequest {
  return new NextRequest("https://app.test/api/farm/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function telegramRoute() {
  return (await import("../app/api/telegram/route")).POST;
}

function telegramRequest(update: unknown): NextRequest {
  return new NextRequest("https://app.test/api/telegram", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "cron" },
    body: JSON.stringify(update),
  });
}

const BASE_ITEM: Item = {
  itemId: "i0",
  batchId: "b1",
  chatId: -100500,
  threadId: 42,
  index: 1,
  total: 2,
  hook: "Хук",
  caption: "Описание",
  sourceUrl: `${BASE}farm/sources/a.mp4`,
  videoUrl: `${BASE}farm/out/i0.mp4`,
  messageId: 1000,
  editPromptId: null,
  status: "review",
  renderingAt: null,
  postingAt: null,
  scheduledAt: null,
  igMediaId: null,
  permalink: null,
  error: null,
  createdAt: new Date().toISOString(),
  position: "top",
};

function seedItem(patch: Partial<Item> & { itemId: string }): Item {
  const item = { ...BASE_ITEM, ...patch };
  const path = `farm/items/${item.itemId}.json`;
  blobs.set(path, {
    pathname: path,
    url: `${BASE}${path}`,
    body: JSON.stringify(item),
    size: 1,
    uploadedAt: new Date(),
  });
  return item;
}

function seedOut(itemId: string): string {
  const path = `farm/out/${itemId}.mp4`;
  blobs.set(path, {
    pathname: path,
    url: `${BASE}${path}`,
    body: "video",
    size: 5,
    uploadedAt: new Date(),
  });
  return `${BASE}${path}`;
}

function item(itemId: string): Item {
  return JSON.parse(blobs.get(`farm/items/${itemId}.json`)!.body) as Item;
}

function lastAnswer(): string {
  const answers = sent.telegram.filter((m) => m.method === "answerCallbackQuery");
  return String(answers[answers.length - 1]?.body.text ?? "");
}

describe("1. вход: POST /api/farm/start создаёт задачи", () => {
  it("пачка из двух роликов доходит до задач с позицией и текстами", async () => {
    const a = putSource("a.mp4");
    const b = putSource("b.mp4");
    const POST = await startRoute();

    const res = await POST(
      startRequest({
        token: batchToken(),
        files: [
          { url: a, bytes: 1 },
          { url: b, bytes: 1 },
        ],
        groups: [{ hooks: ["Хук один", "Хук два"], caption: "Общее описание" }],
        position: "center",
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, total: 2 });
    const saved = items();
    // Порядок публикации перемешивается, поэтому сверяем состав, а не позиции.
    expect(saved.map((i) => i.hook).sort()).toEqual(["Хук два", "Хук один"]);
    expect(saved.every((i) => i.caption === "Общее описание")).toBe(true);
    expect(saved.map((i) => i.sourceUrl).sort()).toEqual([a, b].sort());
    expect(saved.every((i) => i.position === "center")).toBe(true);
    expect(saved.every((i) => i.status === "pending")).toBe(true);
    expect(sent.triggers).toHaveLength(1);
  });

  it("ДЕФЕКТ: сбой на середине создания задач оставляет задачи с уже удалёнными исходниками", async () => {
    const a = putSource("a.mp4");
    const b = putSource("b.mp4");
    const POST = await startRoute();

    // Второй saveItem падает: Blob моргнул на середине пачки.
    let seen = 0;
    putFail = (pathname) => {
      if (!pathname.startsWith("farm/items/")) return false;
      seen += 1;
      return seen === 2;
    };

    const res = await POST(
      startRequest({
        token: batchToken(),
        files: [
          { url: a, bytes: 1 },
          { url: b, bytes: 1 },
        ],
        text: "Хук один\nОписание раз\n---\nХук два\nОписание два",
      })
    );

    expect(res.status).toBe(400);
    expect(String((await res.json()).error)).toContain("Файлы удалены");

    // Исходники действительно удалены...
    expect(blobs.has("farm/sources/a.mp4")).toBe(false);
    // ...а задача на первый ролик осталась и указывает в никуда.
    expect(items()).toHaveLength(0);
  });
});

describe("2. апрув через настоящий роут /api/telegram", () => {
  it("нажатие «Залить» ставит ролик в очередь и называет слот", async () => {
    seedItem({ itemId: "i1", status: "review" });
    seedOut("i1");
    const POST = await telegramRoute();

    const res = await POST(
      telegramRequest({
        callback_query: { id: "cb1", data: "a:i1", message: { message_id: 1000, chat: { id: -100500 } } },
      })
    );

    expect(res.status).toBe(200);
    const saved = item("i1");
    expect(saved.status).toBe("queued");
    expect(saved.scheduledAt).toMatch(/^20\d\d-/);
    expect(lastAnswer()).toBe("В очередь");
  });

  it("ДЕФЕКТ: карточка старше 48 часов — ролик в очереди, а человеку сказано «Ошибка»", async () => {
    seedItem({ itemId: "i2", status: "review" });
    seedOut("i2");
    // Telegram не даёт править сообщения бота старше 48 часов, а апрув по спеке
    // живёт неделю (REVIEW_EXPIRY_MS): снятие кнопок обязано падать на таких карточках.
    telegramFail = (method) => (method === "editMessageReplyMarkup" ? 400 : null);
    const POST = await telegramRoute();

    await POST(
      telegramRequest({
        callback_query: { id: "cb2", data: "a:i2", message: { message_id: 1000, chat: { id: -100500 } } },
      })
    );

    expect(item("i2").status).toBe("queued");
    // Человек видит последним именно это — ролик при этом залит будет.
    expect(lastAnswer()).toBe("В очередь");
  });

  it("ДЕФЕКТ: задача, чей JSON временно не читается, теряет свой слот", async () => {
    seedItem({ itemId: "i3", status: "review" });
    seedItem({ itemId: "i4", status: "review" });
    seedOut("i3");
    seedOut("i4");
    const POST = await telegramRoute();

    await POST(
      telegramRequest({
        callback_query: { id: "cb3", data: "a:i3", message: { message_id: 1000, chat: { id: -100500 } } },
      })
    );
    const first = item("i3").scheduledAt;
    expect(first).not.toBeNull();

    // CDN Blob моргнул ровно на этом файле: listItems молча вернёт список без него.
    readFail.add("farm/items/i3.json");

    await POST(
      telegramRequest({
        callback_query: { id: "cb4", data: "a:i4", message: { message_id: 1000, chat: { id: -100500 } } },
      })
    );

    expect(item("i4").scheduledAt).not.toBe(first);
  });
});

describe("3. заливка: ссылка на рилс", () => {
  it("ДЕФЕКТ: отказ Graph на permalink не оставляет следа в логах", async () => {
    const due = new Date(Date.now() - 60_000).toISOString();
    seedItem({ itemId: "i5", status: "queued", scheduledAt: due, videoUrl: seedOut("i5") });
    graphFail = (url) => (url.includes("fields=permalink") ? 400 : null);
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    const { livePostTickDeps, runPostTick } = await import("../lib/farm/post");
    await runPostTick(livePostTickDeps(), 1);
    spy.mockRestore();

    const saved = item("i5");
    expect(saved.status).toBe("posted");
    expect(saved.igMediaId).toBe("M1");
    const text = sent.telegram.filter((m) => m.method === "sendMessage").map((m) => String(m.body.text));
    expect(text.join("\n")).toContain("ссылку получить не удалось");
    // Ни одной записи в лог о том, ПОЧЕМУ ссылки нет: Graph вернул 400 «boom».
    expect(JSON.stringify(errors)).toContain("boom");
  });
});

describe("4. суточная уборка через настоящий роут /api/farm/daily", () => {
  async function runDailyRoute(): Promise<Response> {
    const { GET } = await import("../app/api/farm/daily/route");
    return GET(
      new NextRequest("https://app.test/api/farm/daily", { headers: { authorization: "Bearer cron" } })
    );
  }

  it("снимает зависшую заливку и просит проверить ленту", async () => {
    seedItem({
      itemId: "i6",
      status: "posting",
      postingAt: new Date(Date.now() - 31 * 60_000).toISOString(),
    });
    const res = await runDailyRoute();
    expect(res.status).toBe(200);
    expect(item("i6").status).toBe("failed");
    const text = sent.telegram.map((m) => String(m.body.text ?? "")).join("\n");
    expect(text).toContain("проверьте ленту");
  });

  it("ДЕФЕКТ: подложка живой задачи удаляется, если её JSON в этот момент не читается", async () => {
    const old = new Date(Date.now() - 2 * 86_400_000);
    const path = "farm/sources/live.mp4";
    blobs.set(path, { pathname: path, url: `${BASE}${path}`, body: "src", size: 3, uploadedAt: old });
    seedItem({
      itemId: "i7",
      status: "pending",
      sourceUrl: `${BASE}${path}`,
      videoUrl: null,
      createdAt: old.toISOString(),
    });
    readFail.add("farm/items/i7.json");

    await runDailyRoute();

    // Задача жива и ждёт рендера, а её подложки в хранилище больше нет.
    expect(blobs.has(path)).toBe(true);
  });
});
