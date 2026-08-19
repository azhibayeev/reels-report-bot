import { farmCaption } from "./telegram";
import { tickKey } from "./tokens";
import { Item } from "./types";

// Нет отдельного lib/farm/config.ts — так что requireEnv и baseUrl живут здесь,
// как единственном месте, где нужен само-вызов.
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function baseUrl(): string {
  const explicit = process.env.FARM_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (host) return `https://${host}`;
  throw new Error("FARM_BASE_URL is not set");
}

export const INVOCATION_BUDGET_MS = 240_000;
// Ролик на 90 секунд занимает до 120 с процессорного времени: с меньшим резервом
// он упёрся бы в лимит вызова уже с отметкой rendering.
export const ITEM_RESERVE_MS = 150_000;
// Ни один вызов не живёт дольше 300 с, значит работа с более старой отметкой
// точно мертва — её можно перехватить, а живую этот порог не перехватит никогда.
export const TAKEOVER_MS = 300_000;

export function isAbandoned(at: string | null, nowMs: number): boolean {
  if (!at) return true;
  const started = Date.parse(at);
  if (Number.isNaN(started)) return true;
  return nowMs - started > TAKEOVER_MS;
}

export function pickNext(items: Item[], batchId: string, nowMs: number): Item | null {
  const mine = items.filter((i) => i.batchId === batchId);
  const pending = mine.filter((i) => i.status === "pending");
  const stuck = mine.filter((i) => i.status === "rendering" && isAbandoned(i.renderingAt, nowMs));
  return [...pending, ...stuck].sort((a, b) => a.index - b.index)[0] ?? null;
}

export interface RenderTickDeps {
  now: () => number;
  listItems: () => Promise<Item[]>;
  saveItem: (item: Item) => Promise<void>;
  renderItem: (item: Item) => Promise<string>;
  sendVideoWithButtons: (args: {
    chatId: number;
    threadId: number | null;
    videoUrl: string;
    caption: string;
    itemId: string;
  }) => Promise<number>;
  deleteBlobQuiet: (url: string) => Promise<void>;
  notify: (text: string, threadId: number | null) => Promise<void>;
  triggerRender: (batchId: string) => Promise<void>;
}

export async function runRenderTick(batchId: string, deps: RenderTickDeps): Promise<void> {
  const startedAt = deps.now();
  for (;;) {
    if (deps.now() - startedAt > INVOCATION_BUDGET_MS - ITEM_RESERVE_MS) {
      await deps.triggerRender(batchId);
      return;
    }
    const item = pickNext(await deps.listItems(), batchId, deps.now());
    if (!item) return;
    await deps.saveItem({ ...item, status: "rendering", renderingAt: new Date(deps.now()).toISOString() });
    try {
      const videoUrl = await deps.renderItem(item);
      const caption = farmCaption(item.index, item.total, item.hook, item.caption);
      const messageId = await deps.sendVideoWithButtons({
        chatId: item.chatId,
        threadId: item.threadId,
        videoUrl,
        caption,
        itemId: item.itemId,
      });
      await deps.saveItem({ ...item, status: "review", videoUrl, messageId, renderingAt: null });
      // Исходник больше не нужен: публикуется готовый ролик, а квота Blob на Hobby
      // при превышении отключает хранилище на 30 дней.
      await deps.deleteBlobQuiet(item.sourceUrl);
    } catch (error) {
      const message = (error as Error).message;
      await deps.saveItem({ ...item, status: "failed", renderingAt: null, error: message });
      try {
        await deps.notify(`Ролик ${item.index}/${item.total} не собрался: ${message}`, item.threadId);
      } catch (notifyError) {
        // Отвалившийся Telegram не должен обрывать пачку: остальные ролики важнее письма.
        console.error("farm notify failed", item.itemId, notifyError);
      }
    }
  }
}

// Роут возвращает 202 сразу, поэтому вызов дешёвый: он лишь запускает
// следующее звено цепочки рендера.
export async function triggerRender(batchId: string): Promise<void> {
  const key = tickKey(`render:${batchId}`, requireEnv("FARM_TOKEN_SECRET"));
  const url = `${baseUrl()}/api/farm/render?batch=${encodeURIComponent(batchId)}&key=${key}`;
  const res = await fetch(url, { method: "POST", cache: "no-store" });
  // fetch не падает на 4xx/5xx: кривой FARM_BASE_URL или чужой ключ без этой
  // проверки выглядели бы как успех, а цепочка рендера молча умирала бы.
  if (!res.ok) throw new Error(`Не удалось запустить рендер: /api/farm/render вернул ${res.status}`);
}
