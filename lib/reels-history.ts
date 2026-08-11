// ── Матрица истории: строка = рилс, колонка = день, ячейка = прирост просмотров.
// Источник — ежедневные снапшоты бота в Blob (per-reel views). Лайки/репосты в
// снапшотах не хранились, поэтому история существует только по просмотрам.
// Всё чистое, без сети: на вход — снапшоты, на выход — значения для Sheets.

import { jakartaDateKey } from "./storage";
import { Snapshot } from "./types";
import { sheetCaption, jakartaStamp, roundTenth } from "./reels-table";

export interface HistoryRow {
  id: string;
  permalink: string;
  publishedAt: string;
  caption: string;
  totalViews: number;
  /** Прирост по дням, в том же порядке, что HistoryMatrix.dates. null — данных за день нет. */
  gains: Array<number | null>;
}

export interface HistoryMatrix {
  /** Дни (ключи YYYY-MM-DD) от свежего к старому. */
  dates: string[];
  rows: HistoryRow[];
  /**
   * ОЦЕНКА подписчиков, приведённых роликом. Instagram не даёт подписки в разрезе
   * медиа (метрика follows для Reels не поддерживается), поэтому дневной прирост
   * подписчиков аккаунта раскидывается по роликам пропорционально их просмотрам
   * за тот же день. Это модель, а не измерение.
   */
  estFollowers: Record<string, number>;
}

/** Сколько дней истории показываем; дальше таблица разрослась бы вправо без пользы. */
export const MAX_DAYS = 90;

// Прирост за день = views(снапшот дня) − views(предыдущий снапшот).
// Рилса не было в предыдущем снапшоте (только вышел) → весь его счётчик засчитываем
// как прирост этого дня. Отрицательные значения не прячем: Instagram иногда
// пересматривает цифры задним числом, и честнее показать это, чем занулить.
export function buildHistory(snaps: Snapshot[], maxDays: number = MAX_DAYS): HistoryMatrix {
  const ordered = [...snaps].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  if (ordered.length < 2) return { dates: [], rows: [], estFollowers: {} };

  const dates: string[] = [];
  const gainsByReel = new Map<string, Map<string, number>>();
  const estFollowers: Record<string, number> = {};

  for (let i = 1; i < ordered.length; i++) {
    const date = jakartaDateKey(new Date(ordered[i].takenAt));
    if (dates.includes(date)) continue; // два снапшота за один день — берём первую пару
    dates.push(date);

    const prev = new Map(ordered[i - 1].reels.map((r) => [r.id, r.views]));
    let dayTotal = 0;
    const dayGains: Array<[string, number]> = [];
    for (const r of ordered[i].reels) {
      const before = prev.get(r.id);
      const gain = before == null ? r.views : r.views - before;
      let byDate = gainsByReel.get(r.id);
      if (!byDate) gainsByReel.set(r.id, (byDate = new Map()));
      byDate.set(date, gain);
      if (gain > 0) {
        dayGains.push([r.id, gain]);
        dayTotal += gain;
      }
    }

    // Раскидываем прирост подписчиков за день пропорционально просмотрам этого дня.
    // Дни без followersCount (снапшоты до появления поля) и дни чистого оттока
    // пропускаем: делить убыль между роликами смысла нет.
    const before = ordered[i - 1].followersCount;
    const after = ordered[i].followersCount;
    if (before != null && after != null && after > before && dayTotal > 0) {
      const delta = after - before;
      for (const [id, gain] of dayGains) {
        estFollowers[id] = (estFollowers[id] ?? 0) + (delta * gain) / dayTotal;
      }
    }
  }

  for (const id of Object.keys(estFollowers)) estFollowers[id] = Math.round(estFollowers[id]);

  // Свежие дни слева: так последняя активность видна без прокрутки вправо.
  const shown = dates.slice(-maxDays).reverse();

  // Метаданные и итог берём из последнего снапшота, где рилс встречался.
  const meta = new Map<string, { permalink: string; publishedAt: string; caption: string; views: number }>();
  for (const s of ordered) {
    for (const r of s.reels) {
      meta.set(r.id, { permalink: r.permalink, publishedAt: r.publishedAt, caption: r.caption, views: r.views });
    }
  }

  const rows: HistoryRow[] = [...meta.entries()]
    .map(([id, m]) => ({
      id,
      permalink: m.permalink,
      publishedAt: m.publishedAt,
      caption: m.caption,
      totalViews: m.views,
      gains: shown.map((d) => gainsByReel.get(id)?.get(d) ?? null),
    }))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  return { dates: shown, rows, estFollowers };
}

// Ключ дня YYYY-MM-DD → заголовок колонки дд.мм. Ведущий апостроф заставляет Sheets
// хранить это как текст: без него «11.08» распознаётся датой и отображение зависит
// от локали таблицы.
export function dayHeader(dateKey: string): string {
  const [, m, d] = dateKey.split("-");
  return `'${d}.${m}`;
}

export const HISTORY_HEADERS = [
  "№",
  "Дата публикации",
  "Ссылка",
  "Описание",
  "Длительность, с",
  "Всего просмотров",
] as const;

export function toHistoryValues(
  matrix: HistoryMatrix,
  updatedAt: Date,
  durations: Record<string, number> = {}
): Array<Array<string | number>> {
  return [
    [...HISTORY_HEADERS, ...matrix.dates.map(dayHeader)],
    ...matrix.rows.map((r, i) => [
      i + 1,
      jakartaStamp(r.publishedAt),
      r.permalink,
      sheetCaption(r.caption),
      durations[r.id] == null ? "" : roundTenth(durations[r.id]),
      r.totalViews,
      ...r.gains.map((g) => (g == null ? "" : g)),
    ]),
    [`Прирост просмотров за день · обновлено: ${jakartaStamp(updatedAt.toISOString())} (WIB)`],
  ];
}
