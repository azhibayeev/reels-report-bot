// Ежедневная сводка по приложению: сообщение (DAU, MAU, установки, топ функций) и
// график за 14 дней. Общий код для дневного крона (/api/report) и ручного прогона
// (/api/app-report).

import { APP_SERIES_DAYS, getAppStats } from "./app-stats";
import { appChartSkipReason, buildAppChart, renderChartPng } from "./chart";
import { formatAppCaption, formatAppMessage } from "./format";
import { getStoreDownloads } from "./store-downloads";
import { sendMessage, sendPhoto } from "./telegram";

export interface AppReportResult {
  day: string;
  dau: number;
  /** Что стало с графиком: его сбой не роняет уже отправленное сообщение, но должен быть виден. */
  chart: string;
}

export async function sendAppReport(now: Date): Promise<AppReportResult> {
  // Сторы не бросают: сбой или отсутствие ключей становится строкой в сообщении.
  const [stats, stores] = await Promise.all([getAppStats(now), getStoreDownloads(now)]);
  await sendMessage(formatAppMessage(stats, stores));

  let chart: string;
  try {
    const skip = appChartSkipReason(stats.dauSeries);
    if (skip) {
      chart = `пропущен: ${skip}`;
    } else {
      const days = stats.dauSeries.map((p) => p.date);
      const png = await renderChartPng(buildAppChart(days, stats.dauSeries, stats.installSeries));
      await sendPhoto(png, formatAppCaption(stats, APP_SERIES_DAYS));
      chart = `отправлен (${days.length} дн.)`;
    }
  } catch (e) {
    console.error("app chart failed:", e);
    chart = `ошибка: ${e instanceof Error ? e.message : String(e)}`;
  }

  return { day: stats.day, dau: stats.dau, chart };
}
