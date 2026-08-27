// ── Учёт переходов по ссылке установки.
// Google Play и App Store отдают установки с задержкой в сутки-двое, а во время
// недели нужно видеть движение сегодня. Поэтому каждый переход кладём отдельным
// объектом в Blob: запись без чтения — значит два одновременных клика не затирают
// друг друга. Всё, что нужно для подсчёта, лежит в имени файла, так что сводка
// собирается одним листингом, без скачивания тел.

import { list, put } from "@vercel/blob";
import { AMBASSADORS, Platform } from "./applink";
import { jakartaDateKey, sprintDateKey } from "./storage";
import { DayPoint } from "./types";

const PREFIX = "applink/";

/** Один листинг отдаёт максимум тысячу имён; у Бары это неполная неделя кликов. */
async function listAllPaths(prefix: string): Promise<string[]> {
  const paths: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor });
    for (const b of page.blobs) paths.push(b.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return paths;
}

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
  const paths = await listAllPaths(PREFIX);
  const out: Record<string, SlugStats> = {};

  for (const path of paths) {
    const rest = path.slice(PREFIX.length).split("/");
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

// ── Переходы за окно отчёта.
// Сутки отчёта кончаются в 12:30 Джакарты, а папки в Blob разложены по календарным
// дням — поэтому день папки только сужает поиск, а отбирает клики метка времени
// из имени файла. Иначе половина вчерашних кликов уехала бы в сегодняшний отчёт.

export interface StoreClicks {
  slug: string;
  /** Ушли в Google Play. */
  android: number;
  /** Ушли в App Store. */
  ios: number;
  /** Открыли с компьютера: там страница выбора, в стор человека никто не увёл. */
  desktop: number;
}

/** Календарные дни Джакарты, задевающие окно: по ним лежат папки в Blob. */
function jakartaDaysOfWindow(from: Date, to: Date): string[] {
  const days = new Set<string>();
  // Сутки Джакарты ровно по 24 часа (UTC+7 без перевода стрелок) — шаг ни одного дня не перепрыгнет.
  for (let t = from.getTime(); t < to.getTime(); t += 86_400_000) days.add(jakartaDateKey(new Date(t)));
  days.add(jakartaDateKey(to));
  return [...days];
}

/** Слаги, по которым вообще есть клики: папки первого уровня под applink/. */
async function slugsInBlob(): Promise<string[]> {
  const { folders } = await list({ prefix: PREFIX, mode: "folded" });
  return (folders ?? []).map((f) => f.slice(PREFIX.length).replace(/\/$/, "")).filter(Boolean);
}

/**
 * Переходы по ссылкам за окно [from, to). Амбассадоры из реестра попадают в ответ
 * всегда, даже с нулём; найденные в Blob чужие слаги — только если в окне что-то
 * было. Порядок: по переходам в стор, от большего.
 */
export async function loadStoreClicks(from: Date, to: Date): Promise<StoreClicks[]> {
  const known = AMBASSADORS.map((a) => a.slug);
  const slugs = [...new Set([...known, ...(await slugsInBlob())])];
  const days = jakartaDaysOfWindow(from, to);
  const fromMs = from.getTime();
  const toMs = to.getTime();

  const rows: StoreClicks[] = [];
  for (const slug of slugs) {
    const row: StoreClicks = { slug, android: 0, ios: 0, desktop: 0 };
    for (const day of days) {
      const prefix = `${PREFIX}${slug}/${day}/`;
      for (const path of await listAllPaths(prefix)) {
        // Имя файла: <платформа>-<мс>-<случайный хвост>.json
        const [platform, ms] = path.slice(prefix.length).split("-");
        const at = Number(ms);
        if (!Number.isFinite(at) || at < fromMs || at >= toMs) continue;
        if (platform === "android") row.android += 1;
        else if (platform === "ios") row.ios += 1;
        else if (platform === "other") row.desktop += 1;
      }
    }
    // Чужой слаг без единого клика в окне — шум: в отчёте ему делать нечего.
    if (known.includes(slug) || row.android + row.ios + row.desktop > 0) rows.push(row);
  }

  // Сортировка по переходам в стор: компьютерные заходы никого наверх не поднимают.
  return rows.sort((a, b) => b.android + b.ios - (a.android + a.ios));
}

/** Суточные спринты, попадающие в окно: по ним раскладываем переходы на графике. */
function sprintDaysOfWindow(from: Date, to: Date): string[] {
  const days = new Set<string>();
  for (let t = from.getTime(); t < to.getTime(); t += 86_400_000) days.add(sprintDateKey(new Date(t)));
  return [...days].sort();
}

/**
 * Выход воронки по дням: переходы в стор с коротких ссылок `slugs` за окно [from, to).
 * Считаем только android+ios — с компьютера человек попадает на страницу выбора, и в
 * стор его никто не увёл. Дни разложены по суточным спринтам 12:30→12:30, как просмотры.
 *
 * Дни без единого перехода возвращаются нулями: разрыв в линии читался бы как «не
 * мерили», хотя мерили и не было ничего. Календарные папки Blob только сужают поиск —
 * попадание в окно решает метка времени из имени файла.
 */
export async function loadDailyStoreClicks(slugs: string[], from: Date, to: Date): Promise<DayPoint[]> {
  const counts = new Map<string, number>(sprintDaysOfWindow(from, to).map((d) => [d, 0]));
  const fromMs = from.getTime();
  const toMs = to.getTime();

  await Promise.all(
    slugs.flatMap((slug) =>
      jakartaDaysOfWindow(from, to).map(async (day) => {
        const prefix = `${PREFIX}${slug}/${day}/`;
        for (const path of await listAllPaths(prefix)) {
          // Имя файла: <платформа>-<мс>-<случайный хвост>.json
          const [platform, ms] = path.slice(prefix.length).split("-");
          if (platform !== "android" && platform !== "ios") continue;
          const at = Number(ms);
          if (!Number.isFinite(at) || at < fromMs || at >= toMs) continue;
          const key = sprintDateKey(new Date(at));
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      })
    )
  );

  return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, value]) => ({ date, value }));
}
