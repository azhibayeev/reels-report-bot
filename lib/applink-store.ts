// ── Учёт переходов по ссылке установки.
// Google Play и App Store отдают установки с задержкой в сутки-двое, а во время
// недели нужно видеть движение сегодня. Поэтому каждый переход кладём отдельным
// объектом в Blob: запись без чтения — значит два одновременных клика не затирают
// друг друга. Всё, что нужно для подсчёта, лежит в имени файла, так что сводка
// собирается одним листингом, без скачивания тел.

import { list, put } from "@vercel/blob";
import { Platform } from "./applink";
import { jakartaDateKey } from "./storage";

const PREFIX = "applink/";

export interface SlugStats {
  total: number;
  byPlatform: Record<Platform, number>;
  byDay: Record<string, number>;
}

export async function recordAppLinkClick(slug: string, platform: Platform, at: Date): Promise<void> {
  const day = jakartaDateKey(at);
  await put(`${PREFIX}${slug}/${day}/${platform}-${at.getTime()}.json`, JSON.stringify({ slug, platform, at: at.toISOString() }), {
    access: "public",
    contentType: "application/json",
    // Уникальный суффикс — единственная защита от совпадения по миллисекунде.
    addRandomSuffix: true,
  });
}

export async function loadAppLinkStats(): Promise<Record<string, SlugStats>> {
  const { blobs } = await list({ prefix: PREFIX });
  const out: Record<string, SlugStats> = {};

  for (const b of blobs) {
    const rest = b.pathname.slice(PREFIX.length).split("/");
    if (rest.length !== 3) continue;
    const [slug, day, file] = rest;
    const platform = file.split("-")[0] as Platform;
    if (platform !== "android" && platform !== "ios" && platform !== "other") continue;

    const s = (out[slug] ??= { total: 0, byPlatform: { android: 0, ios: 0, other: 0 }, byDay: {} });
    s.total += 1;
    s.byPlatform[platform] += 1;
    s.byDay[day] = (s.byDay[day] ?? 0) + 1;
  }

  return out;
}
