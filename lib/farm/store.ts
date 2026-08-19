import { del, list, put } from "@vercel/blob";
import { Batch, Item } from "./types";

export const ITEMS_PREFIX = "farm/items/";
export const BATCHES_PREFIX = "farm/batches/";
export const SOURCES_PREFIX = "farm/sources/";
export const OUT_PREFIX = "farm/out/";

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

// Blob кэшируется на CDN, поэтому читаем всегда с cache-busting: иначе тик
// увидит устаревший статус и отправит ролик или опубликует его дважды.
async function readJson<T>(url: string): Promise<T | null> {
  const res = await fetch(`${url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadItem(itemId: string): Promise<Item | null> {
  const path = itemPath(itemId);
  const { blobs } = await list({ prefix: path });
  const blob = blobs.find((b) => b.pathname === path);
  if (!blob) return null;
  return readJson<Item>(blob.url);
}

export async function listItems(): Promise<Item[]> {
  const { blobs } = await list({ prefix: ITEMS_PREFIX });
  const items: Item[] = [];
  for (const blob of blobs) {
    const item = await readJson<Item>(blob.url);
    if (item) items.push(item);
  }
  return items;
}

export async function deleteBlobQuiet(url: string): Promise<void> {
  // Упасть на уборке нельзя: ролик уже отправлен или опубликован.
  try {
    await del(url);
  } catch (error) {
    console.error("farm blob delete failed", url, error);
  }
}
