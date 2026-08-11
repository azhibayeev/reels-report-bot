import { NextRequest, NextResponse } from "next/server";
import { buildTrendChart, computeDailyViewGains, renderChartPng } from "../../../lib/chart";
import { computeReport } from "../../../lib/diff";
import { escapeHtml, formatClicksMessage, formatMessage, formatTargetMessage } from "../../../lib/format";
import { getLeadLevels } from "../../../lib/leads";
import { getAdInsights } from "../../../lib/meta";
import { getClicksStats, getDailyClicks, lastSprintStart } from "../../../lib/posthog";
import {
  buildRows,
  fetchAllReelsDetailed,
  HEADERS,
  HEATMAP_FIRST_COL,
  HEATMAP_LAST_COL,
  fetchReelInsights,
  resolveDurations,
  toSheetValues,
} from "../../../lib/reels-table";
import {
  buildHistory,
  HISTORY_HEADERS,
  HISTORY_TOTAL_COL,
  MAX_DAYS,
  toHistoryValues,
} from "../../../lib/reels-history";
import { historyTab, reelsTab, sheetsConfigured, syncSheet } from "../../../lib/sheets";
import {
  fetchAllReels,
  fetchFollowersCount,
  fetchFollowsAndUnfollows,
  fetchViews,
} from "../../../lib/instagram";
import {
  jakartaDateKey,
  loadDurations,
  loadLastReportKey,
  loadPreviousSnapshot,
  loadRecentSnapshots,
  saveDurations,
  saveLastReportKey,
  saveSnapshot,
} from "../../../lib/storage";
import { sendMessage, sendPhoto } from "../../../lib/telegram";
import { resolveToken } from "../../../lib/token";
import { Snapshot } from "../../../lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    if (!process.env.IG_USER_ID) throw new Error("IG_USER_ID is not set");

    // Дедупликация: внешний планировщик и запасной крон Vercel могут сработать
    // в один день оба — второй запуск молча пропускается. ?force=1 — для ручных тестов.
    const force = req.nextUrl.searchParams.get("force") === "1";
    const todayKeyNow = jakartaDateKey(new Date());
    if (!force && (await loadLastReportKey()) === todayKeyNow) {
      return NextResponse.json({ ok: true, skipped: true, reason: `report for ${todayKeyNow} already sent` });
    }

    const token = await resolveToken();

    const media = await fetchAllReels(process.env.IG_USER_ID, token);
    const views = await fetchViews(token, media.map((m) => m.id));
    const followersCount = await fetchFollowersCount(process.env.IG_USER_ID, token);

    const now = new Date();
    const todayKey = jakartaDateKey(now);
    const prev = await loadPreviousSnapshot(todayKey);

    // Окно follows/unfollows = период отчёта (от прошлого замера до текущего),
    // чтобы валовые цифры относились к тому же промежутку, что и чистый прирост.
    const followerChanges = await fetchFollowsAndUnfollows(
      process.env.IG_USER_ID,
      token,
      prev ? Date.parse(prev.takenAt) : undefined,
      now.getTime()
    );

    const prevViews = new Map((prev?.reels ?? []).map((r) => [r.id, r.views]));

    const current: Snapshot = {
      takenAt: now.toISOString(),
      ...(followersCount != null ? { followersCount } : {}),
      reels: media.map((m) => ({
        id: m.id,
        permalink: m.permalink,
        publishedAt: m.timestamp,
        caption: m.caption,
        views: views.get(m.id) ?? prevViews.get(m.id) ?? 0,
      })),
    };

    await saveSnapshot(todayKey, current);

    const report = computeReport(current, prev);
    await sendMessage(formatMessage(report, followerChanges));
    await saveLastReportKey(todayKey);

    // Сводка кликов по ссылке в шапке → в ту же тему, что и рилс-отчёт («Daily»,
    // env TELEGRAM_THREAD_ID). Ошибка тут не должна ронять уже отправленный
    // рилс-отчёт, поэтому изолируем в свой try.
    try {
      // Окно = завершившийся суточный спринт (пред. 12:30 → сейчас). Берём границу от
      // now−1ч, чтобы крон в 12:30 брал ВЧЕРАШНЮЮ границу, а не сегодняшнюю (иначе окно ~0).
      const since = Math.floor(lastSprintStart(new Date(now.getTime() - 3600_000)).getTime() / 1000);
      const clicks = await getClicksStats(since);
      await sendMessage(formatClicksMessage(clicks, "Заходы по ссылкам · за сутки"));
    } catch (e) {
      console.error("clicks report failed:", e);
    }

    // Сводка по таргету (реклама Meta + разбивка лидов по уровню инвестора) → тема Daily.
    // Рекламные цифры — за вчерашний рекламный день (Insights не умеет скользящее 24ч);
    // разбивка лидов — за суточный спринт (с 12:30). Изолировано: ошибка не роняет отчёт.
    try {
      const ads = await getAdInsights("yesterday");
      const sprintStart = lastSprintStart(new Date(now.getTime() - 3600_000));
      const levels = await getLeadLevels(sprintStart.toISOString());
      await sendMessage(
        formatTargetMessage(ads, levels, "за сутки", "🗓 Реклама — вчерашние сутки · лиды — с 12:30 вчера")
      );
    } catch (e) {
      console.error("target report failed:", e);
    }

    // График динамики (просмотры/день + заходы/день) за 14 дней → тема Daily.
    // Изолирован: любая ошибка (QuickChart/PostHog/мало данных) не роняет отчёт.
    try {
      const snaps = await loadRecentSnapshots(15); // 15 снапшотов → до 14 приростов
      const viewsSeries = computeDailyViewGains(snaps).slice(-14);
      const clicksSince = Math.floor((now.getTime() - 14 * 86_400_000) / 1000);
      const clicksSeries = await getDailyClicks(clicksSince);
      if (viewsSeries.length >= 2 || clicksSeries.length >= 2) {
        const png = await renderChartPng(buildTrendChart(viewsSeries, clicksSeries));
        await sendPhoto(png, "📈 Динамика за 14 дней");
      }
    } catch (e) {
      console.error("trend chart failed:", e);
    }

    // Google-таблица со статистикой по всем рилсам. Отдельного планировщика не заводим —
    // обновляемся вместе с ежедневным отчётом. Данные берём своим запросом: здесь нужны
    // лайки/комменты/репосты/охват, которых нет в снапшоте отчёта. Изолировано: ошибка
    // Sheets не должна ронять уже отправленный отчёт.
    try {
      if (sheetsConfigured()) {
        const detailed = await fetchAllReelsDetailed(process.env.IG_USER_ID, token);
        const insights = await fetchReelInsights(token, detailed.map((m) => m.id));
        const cachedDurations = await loadDurations();
        const durations = await resolveDurations(detailed, cachedDurations);
        if (Object.keys(durations).length > Object.keys(cachedDurations).length) {
          await saveDurations(durations);
        }
        const at = new Date();
        // Свежий снапшот уже сохранён выше, так что история включает сегодняшний день.
        const history = buildHistory(await loadRecentSnapshots(MAX_DAYS + 1));
        const reelRows = buildRows(detailed, insights, durations);
        await syncSheet(toSheetValues(reelRows, at), reelsTab(), 0, [
          {
            kind: "column",
            startRowIndex: 1,
            rowCount: reelRows.length,
            startColumnIndex: HEADERS.indexOf(HEATMAP_FIRST_COL),
            endColumnIndex: HEADERS.indexOf(HEATMAP_LAST_COL) + 1,
            scale: "redYellowGreen",
          },
        ]);
        await syncSheet(toHistoryValues(history, at, durations), historyTab(), 5, [
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
      }
    } catch (e) {
      console.error("sheet sync failed:", e);
    }

    return NextResponse.json({
      ok: true,
      reels: current.reels.length,
      newReels: report.newReels.length,
      totalGain: report.totalGain,
      followers: followersCount,
    });
  } catch (e) {
    console.error("report failed:", e);
    const msg = e instanceof Error ? e.message : String(e);
    try {
      if (/OAuth|access.?token|Session has expired|code.? ?190/i.test(msg)) {
        await sendMessage(
          `⚠️ Токен Instagram, похоже, истёк или отозван. Перевыпустите токен по инструкции в SETUP.md (раздел 1) и обновите переменную IG_ACCESS_TOKEN в Vercel.\n<code>${escapeHtml(msg)}</code>`
        );
      } else {
        await sendMessage(`⚠️ Не удалось сформировать отчёт по рилсам:\n<code>${escapeHtml(msg)}</code>`);
      }
    } catch {
      // Telegram тоже недоступен — остаётся лог Vercel.
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
