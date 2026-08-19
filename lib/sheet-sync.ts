// ── Обновление Google-таблицы по одному аккаунту: вкладка Reels (метрики по каждому
// ролику) и вкладка History (прирост просмотров по дням из снапшотов бота).
// Живёт отдельно, потому что вызывается из двух мест: ежедневного отчёта и ручного
// /api/sheet, — и должно вести себя там одинаково.

import { AccountConfig, historyTabOf, reelsTabOf } from "./accounts";
import {
  buildHistory,
  HISTORY_HEADERS,
  HISTORY_TOTAL_COL,
  MAX_DAYS,
  toHistoryValues,
} from "./reels-history";
import {
  buildRows,
  fetchAllReelsDetailed,
  fetchReelInsights,
  HEADERS,
  HEATMAP_FIRST_COL,
  HEATMAP_LAST_COL,
  resolveDurations,
  toSheetValues,
} from "./reels-table";
import { syncSheet } from "./sheets";
import { loadDurations, loadRecentSnapshots, saveDurations } from "./storage";

export interface SheetSyncResult {
  account: string;
  reels: number;
  withInsights: number;
  withDuration: number;
  newlyMeasured: number;
  historyDays: number;
  historyRows: number;
  /** true — данные собраны, но в таблицу не писали (?dry=1). */
  dry: boolean;
}

export async function syncAccountSheets(
  acc: AccountConfig,
  igUserId: string,
  token: string,
  opts: { dry?: boolean } = {}
): Promise<SheetSyncResult> {
  const media = await fetchAllReelsDetailed(igUserId, token);
  const insights = await fetchReelInsights(token, media.map((m) => m.id));

  // Длительности кэшируются в Blob: щупаем mp4 только у роликов, которых там нет.
  const cached = await loadDurations(acc);
  const durations = await resolveDurations(media, cached);
  const newlyMeasured = Object.keys(durations).length - Object.keys(cached).length;
  if (newlyMeasured > 0 && !opts.dry) await saveDurations(durations, acc);

  // MAX_DAYS приростов требует MAX_DAYS+1 снапшотов (прирост считается между парами).
  const history = buildHistory(await loadRecentSnapshots(MAX_DAYS + 1, acc));
  const rows = buildRows(media, insights, durations);

  const result: SheetSyncResult = {
    account: acc.key,
    reels: rows.length,
    withInsights: insights.size,
    withDuration: rows.filter((r) => r.durationSec != null).length,
    newlyMeasured,
    historyDays: history.dates.length,
    historyRows: history.rows.length,
    dry: Boolean(opts.dry),
  };
  if (opts.dry) return result;

  const updatedAt = new Date();
  await syncSheet(toSheetValues(rows, updatedAt), reelsTabOf(acc), 0, [
    {
      kind: "column",
      startRowIndex: 1,
      rowCount: rows.length,
      startColumnIndex: HEADERS.indexOf(HEATMAP_FIRST_COL),
      endColumnIndex: HEADERS.indexOf(HEATMAP_LAST_COL) + 1,
      scale: "redYellowGreen",
    },
  ]);
  await syncSheet(toHistoryValues(history, updatedAt, durations), historyTabOf(acc), 5, [
    {
      kind: "row",
      startRowIndex: 1,
      rowCount: history.rows.length,
      startColumnIndex: HISTORY_HEADERS.length,
      endColumnIndex: HISTORY_HEADERS.length + history.dates.length,
      scale: "green",
    },
    {
      kind: "column",
      startRowIndex: 1,
      rowCount: history.rows.length,
      startColumnIndex: HISTORY_HEADERS.indexOf(HISTORY_TOTAL_COL),
      endColumnIndex: HISTORY_HEADERS.indexOf(HISTORY_TOTAL_COL) + 1,
      scale: "redYellowGreen",
    },
  ]);

  return result;
}
