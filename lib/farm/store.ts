import { del, list, put } from "@vercel/blob";
import { Batch, Item } from "./types";

export const ITEMS_PREFIX = "farm/items/";
export const BATCHES_PREFIX = "farm/batches/";
export const SOURCES_PREFIX = "farm/sources/";
export const OUT_PREFIX = "farm/out/";

// list() отдаёт максимум 1000 записей за раз: на ферме больше 1000 роликов
// без дочитывания страниц всё, что за первой, молча теряется. Экспортируем —
// суточной уборке (lib/farm/daily.ts) нужна та же пагинация для farm/sources/.
export async function listAllBlobs(prefix: string): Promise<{ pathname: string; url: string; uploadedAt: Date }[]> {
  const acc: { pathname: string; url: string; uploadedAt: Date }[] = [];
  let cursor: string | undefined;
  for (;;) {
    const opts: { prefix: string; cursor?: string } = { prefix };
    if (cursor) opts.cursor = cursor;
    const page = await list(opts);
    acc.push(...page.blobs);
    // Курсор проверяем ДО присваивания: hasMore:true без курсора (или с тем же
    // курсором, что уже был) — это не следующая страница, а зацикливание на
    // первой, которое молча съест весь бюджет serverless-вызова.
    if (!page.hasMore || !page.cursor || page.cursor === cursor) break;
    cursor = page.cursor;
  }
  return acc;
}

export function itemPath(itemId: string): string {
  return `${ITEMS_PREFIX}${itemId}.json`;
}

// Уборка и /reels обязаны считать активными и правку, и заливку: иначе первая
// удалит файлы у ролика, который человек как раз редактирует.
export function isActive(item: Item): boolean {
  return !["rejected", "posted", "failed"].includes(item.status);
}

export async function saveItem(item: Item): Promise<void> {
  await put(itemPath(item.itemId), JSON.stringify(item), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function saveBatch(batch: Batch): Promise<void> {
  await put(`${BATCHES_PREFIX}${batch.batchId}.json`, JSON.stringify(batch), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

async function fetchOnce<T>(url: string): Promise<T | null> {
  const res = await fetch(`${url}?ts=${Date.now()}`, { cache: "no-store" });
  // 404 значит блоб действительно исчез — это не сбой, а честный ответ "нет задачи".
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`блоб ответил ${res.status}`);
  return (await res.json()) as T;
}

// Blob кэшируется на CDN, поэтому читаем всегда с cache-busting: иначе тик
// увидит устаревший статус и отправит ролик или опубликует его дважды.
// Любой не-404 отказ (не-ok статус или брошенный fetch) — это временное
// моргание CDN, а не пропажа задачи: молча возвращать null в этом случае
// нельзя — вызывающий код принял бы "не смог прочитать" за "задачи нет" и
// выдал бы её слот кому-то другому (см. listItems и lib/farm/daily.ts).
async function readJson<T>(url: string): Promise<T | null> {
  try {
    return await fetchOnce<T>(url);
  } catch (firstError) {
    try {
      return await fetchOnce<T>(url);
    } catch (secondError) {
      const message = secondError instanceof Error ? secondError.message : String(secondError);
      throw new Error(`farm store: не удалось прочитать блоб (после повтора): ${url}: ${message}`);
    }
  }
}

export async function loadItem(itemId: string): Promise<Item | null> {
  const path = itemPath(itemId);
  const { blobs } = await list({ prefix: path });
  const blob = blobs.find((b) => b.pathname === path);
  if (!blob) return null;
  return readJson<Item>(blob.url);
}

// Пул на чтение: Promise.all по всему списку упёрся бы в лимиты соединений на
// тысяче блобов, а чтение по одному — это секунды на каждый /reels, апрув и
// тик заливки (сотни последовательных сетевых round-trip).
const READ_CONCURRENCY = 16;

export async function listItems(): Promise<Item[]> {
  const blobs = await listAllBlobs(ITEMS_PREFIX);
  const items: (Item | null)[] = new Array(blobs.length).fill(null);
  let unread = 0;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= blobs.length) return;
      try {
        const item = await readJson<Item>(blobs[i].url);
        // item === null здесь — это 404 между list() и чтением: readJson уже
        // отличил его от временного сбоя (см. комментарий там) — блоб
        // действительно исчез (уборка удалила задачу, откат startBatch снёс
        // черновик). Это честное "нет задачи", а не потеря слота, поэтому
        // просто оставляем items[i] пустым и не считаем непрочитанной.
        if (item) items[i] = item;
      } catch {
        // Сюда попадает только не-404 отказ после повтора внутри readJson —
        // вот это уже настоящая потеря слота.
        unread += 1;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(READ_CONCURRENCY, blobs.length) }, () => worker())
  );

  if (unread > 0) {
    throw new Error(`farm store: список задач неполон, не прочитано ${unread} из ${blobs.length}`);
  }

  return items.filter((i): i is Item => i !== null);
}

export async function deleteBlobQuiet(url: string): Promise<void> {
  // Упасть на уборке нельзя: ролик уже отправлен или опубликован.
  try {
    await del(url);
  } catch (error) {
    console.error("farm blob delete failed", url, error);
  }
}
