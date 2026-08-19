import { list } from "@vercel/blob";
import { escapeHtml } from "../format";
import { sendMessage } from "../telegram";
import { checkToken } from "./token";
import { livePostTickDeps, runPostTick } from "./post";
import { deleteBlobQuiet, isActive, itemPath, listItems, saveItem, SOURCES_PREFIX } from "./store";
import { requireEnv } from "./tick";
import { Item } from "./types";

export const PURGE_AFTER_MS = 3 * 86_400_000;
export const REVIEW_EXPIRY_MS = 7 * 86_400_000;
export const STUCK_AFTER_MS = 30 * 60_000;
export const ORPHAN_GRACE_MS = 86_400_000;
export const TOKEN_WARN_MS = 7 * 86_400_000;
// Потолок вызова совпадает с maxDuration роута /api/farm/daily — за этим временем
// платформа обрубит функцию посреди работы.
export const DAILY_BUDGET_MS = 300_000;
// Резерв на один цикл postOne: до 240 с ожидания контейнера (CONTAINER_TIMEOUT_MS
// в lib/farm/instagram.ts) плюс создание контейнера, media_publish, запрос ссылки
// и удаление блоба — без этого запаса добор рискует оборваться на media_publish
// и оставить задачу навсегда висящей в статусе posting.
export const CATCH_UP_RESERVE_MS = 250_000;

function ageMs(at: string, nowMs: number): number {
  const started = Date.parse(at);
  return Number.isNaN(started) ? Infinity : nowMs - started;
}

export function classifyForCleanup(
  items: Item[],
  nowMs: number
): { purge: Item[]; expire: Item[]; unstick: Item[] } {
  const purge = items.filter((i) => !isActive(i) && ageMs(i.createdAt, nowMs) > PURGE_AFTER_MS);
  const expire = items.filter(
    (i) => (i.status === "review" || i.status === "editing") && ageMs(i.createdAt, nowMs) > REVIEW_EXPIRY_MS
  );
  const unstick = items.filter((i) => {
    if (i.status === "rendering") return ageMs(i.renderingAt ?? i.createdAt, nowMs) > STUCK_AFTER_MS;
    if (i.status === "posting") return ageMs(i.postingAt ?? i.createdAt, nowMs) > STUCK_AFTER_MS;
    return false;
  });
  return { purge, expire, unstick };
}

export interface DailyDeps {
  now: () => number;
  listItems: () => Promise<Item[]>;
  saveItem: (item: Item) => Promise<void>;
  deleteBlobQuiet: (url: string) => Promise<void>;
  deleteItemRecord: (itemId: string) => Promise<void>;
  listSources: () => Promise<{ url: string; uploadedAt: Date }[]>;
  checkToken: () => Promise<{ valid: boolean; expiresAt: number | null; scopes: string[] }>;
  catchUpDue: () => Promise<number>;
  notify: (text: string, threadId: number | null) => Promise<void>;
}

async function notifyQuiet(deps: DailyDeps, text: string, threadId: number | null): Promise<void> {
  try {
    await deps.notify(text, threadId);
  } catch (error) {
    console.error("farm daily notify failed", error);
  }
}

export async function runDaily(
  deps: DailyDeps
): Promise<{ purged: number; expired: number; unstuck: number; caughtUp: number }> {
  const nowMs = deps.now();
  const items = await deps.listItems();
  const { purge, expire, unstick } = classifyForCleanup(items, nowMs);

  let purged = 0;
  for (const item of purge) {
    try {
      if (item.videoUrl) await deps.deleteBlobQuiet(item.videoUrl);
      if (item.sourceUrl) await deps.deleteBlobQuiet(item.sourceUrl);
      await deps.deleteItemRecord(item.itemId);
      purged += 1;
    } catch (error) {
      console.error("farm daily purge failed", item.itemId, error);
    }
  }

  let expired = 0;
  // Уведомление должно строиться только из роликов, чей saveItem реально прошёл —
  // иначе при сбое Blob ролик остаётся в review, а в чат уже улетело "отклонён".
  const expiredItems: Item[] = [];
  for (const item of expire) {
    try {
      await deps.saveItem({ ...item, status: "rejected" });
      if (item.videoUrl) await deps.deleteBlobQuiet(item.videoUrl);
      expired += 1;
      expiredItems.push(item);
    } catch (error) {
      console.error("farm daily expire failed", item.itemId, error);
    }
  }
  if (expiredItems.length > 0) {
    // Ролики просроченной пачки могут лежать в разных темах форума — уведомление
    // по единственному threadId оставило бы остальные темы без вестей о выкинутых роликах.
    const byThread = new Map<number | null, Item[]>();
    for (const item of expiredItems) {
      const group = byThread.get(item.threadId);
      if (group) group.push(item);
      else byThread.set(item.threadId, [item]);
    }
    for (const [threadId, group] of byThread) {
      const numbers = group.map((i) => `${i.index}/${i.total}`).join(", ");
      await notifyQuiet(deps, `Отклонены по сроку (не одобрены за неделю): ${numbers}`, threadId);
    }
  }

  let unstuck = 0;
  for (const item of unstick) {
    try {
      const wasPosting = item.status === "posting";
      const message = wasPosting ? "заливка зависла" : "сборка зависла";
      await deps.saveItem({ ...item, status: "failed", renderingAt: null, postingAt: null, error: message });
      const text = wasPosting
        // Заливка могла оборваться уже после media_publish — ролик, возможно,
        // уже опубликован, повторно такое не публикуем, поэтому просим проверить руками.
        ? `Ролик ${item.index}/${item.total} завис при заливке и снят с автомата — проверьте ленту, возможно он уже опубликован`
        : `Ролик ${item.index}/${item.total} завис при сборке и снят с автомата`;
      await notifyQuiet(deps, text, item.threadId);
      unstuck += 1;
    } catch (error) {
      console.error("farm daily unstick failed", item.itemId, error);
    }
  }

  try {
    const sources = await deps.listSources();
    const used = new Set(items.map((i) => i.sourceUrl));
    for (const source of sources) {
      // Отсрочка обязательна: файл, залитый минуту назад, ещё не имеет задачи —
      // /api/farm/start создаёт их после загрузки, и без грейса уборка сожрала бы живую пачку.
      if (!used.has(source.url) && nowMs - source.uploadedAt.getTime() > ORPHAN_GRACE_MS) {
        await deps.deleteBlobQuiet(source.url);
      }
    }
  } catch (error) {
    console.error("farm daily orphan cleanup failed", error);
  }

  try {
    const token = await deps.checkToken();
    if (!token.valid) {
      await notifyQuiet(deps, "Токен публикации недействителен (отозван или истёк) — заливка стоит", null);
    } else if (token.expiresAt !== null && token.expiresAt - nowMs < TOKEN_WARN_MS) {
      const date = new Date(token.expiresAt).toISOString();
      await notifyQuiet(deps, `Токен публикации скоро истекает (${date}) — перевыпустите заранее`, null);
    }
  } catch (error) {
    const message = (error as Error).message;
    // Сетевой сбой не означает, что токен мёртв — про отзыв тут говорить нельзя.
    await notifyQuiet(deps, `Не смог проверить токен публикации (сеть или Graph недоступны): ${message}`, null);
  }

  let caughtUp = 0;
  const spentMs = deps.now() - nowMs;
  if (DAILY_BUDGET_MS - spentMs < CATCH_UP_RESERVE_MS) {
    console.warn(
      `farm daily catch-up skipped: cleanup spent ${spentMs}ms of ${DAILY_BUDGET_MS}ms budget, ` +
        "not enough left for a publish cycle — overdue slots will be picked up by /api/farm/post"
    );
  } else {
    try {
      caughtUp = await deps.catchUpDue();
    } catch (error) {
      console.error("farm daily catch-up failed", error);
    }
  }

  return { purged, expired, unstuck, caughtUp };
}

export function liveDailyDeps(): DailyDeps {
  return {
    now: () => Date.now(),
    listItems,
    saveItem,
    deleteBlobQuiet,
    deleteItemRecord: (id) => deleteBlobQuiet(itemPath(id)),
    listSources: async () => {
      const { blobs } = await list({ prefix: SOURCES_PREFIX });
      return blobs.map((b) => ({ url: b.url, uploadedAt: b.uploadedAt }));
    },
    checkToken: () => checkToken(requireEnv("FARM_IG_TOKEN")),
    // Основной путь — внешний таймер по каждому слоту; суточный крон только
    // страхует его отказ. Один цикл публикации упирается в 240-секундный потолок
    // waitForContainer (CONTAINER_TIMEOUT_MS) при бюджете вызова в 300 с — второй
    // ролик туда не влезает, а остальные просроченные слоты подхватит следующий тик /api/farm/post.
    // Второй предохранитель — сам runDaily перед вызовом проверяет остаток бюджета
    // (DAILY_BUDGET_MS/CATCH_UP_RESERVE_MS) и пропускает добор, если уборка съела время.
    catchUpDue: () => runPostTick(livePostTickDeps(), 1),
    notify: (text, threadId) => sendMessage(escapeHtml(text), { thread: threadId }),
  };
}
