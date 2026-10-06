// Ежедневная сводка по приложению: сообщение (DAU, MAU, установки, топ функций) и
// график за 14 дней. Общий код для дневного крона (/api/report) и ручного прогона
// (/api/app-report).

import { APP_SERIES_DAYS, getAppStats } from "./app-stats";
import { appChartSkipReason, buildAppChart, renderChartPng } from "./chart";
import { escapeHtml, formatAppCaption, formatAppMessage } from "./format";
import { getStoreDownloads } from "./store-downloads";
import { sendMessage, sendPhoto } from "./telegram";

export interface AppReportResult {
  day: string;
  dau: number;
  /** Что стало с графиком: его сбой не роняет уже отправленное сообщение, но должен быть виден. */
  chart: string;
}

/**
 * Сводка не ушла — говорим об этом в чате. Без этого сбой виден только в логах Vercel,
 * а команда видит просто отсутствие сообщения (так и было 2026-10-06: ключ PostHog
 * получил 403 на проект приложения). Сам Telegram недоступен — остаётся лог.
 */
export async function notifyAppReportFailure(e: unknown): Promise<void> {
  const msg = e instanceof Error ? e.message : String(e);
  try {
    await sendMessage(
      "⚠️ Сводка по приложению не ушла. Если ниже 403 от PostHog — проверьте ключ " +
        `POSTHOG_APP_PERSONAL_API_KEY в Vercel (SETUP.md, «Сводка по приложению Qurany»).\n` +
        `<code>${escapeHtml(msg.slice(0, 500))}</code>`
    );
  } catch {
    // Telegram тоже недоступен — остаётся лог Vercel.
  }
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
