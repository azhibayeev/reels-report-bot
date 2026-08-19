import { NextRequest, NextResponse } from "next/server";
import { AccountConfig, accountUserId, accountsToRun } from "../../../lib/accounts";
import { buildTrendChart, chartSkipReason, computeDailyViewGains, renderChartPng } from "../../../lib/chart";
import { computeReport } from "../../../lib/diff";
import { escapeHtml, formatClicksMessage, formatMessage, formatTargetMessage } from "../../../lib/format";
import { getLeadLevels } from "../../../lib/leads";
import { getAdInsights } from "../../../lib/meta";
import { getClicksStats, getDailyClicks, lastSprintStart } from "../../../lib/posthog";
import { sheetsConfigured } from "../../../lib/sheets";
import { syncAccountSheets } from "../../../lib/sheet-sync";
import {
  fetchAllReels,
  fetchFollowersCount,
  fetchFollowsAndUnfollows,
  fetchViews,
} from "../../../lib/instagram";
import {
  jakartaDateKey,
  loadLastReportKey,
  loadPreviousSnapshot,
  loadRecentSnapshots,
  saveLastReportKey,
  saveSnapshot,
} from "../../../lib/storage";
import { sendMessage, sendPhoto } from "../../../lib/telegram";
import { resolveToken } from "../../../lib/token";
import { Snapshot } from "../../../lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface AccountResult {
  account: string;
  reels: number;
  newReels: number;
  totalGain: number;
  followers: number | null;
  /** Что стало с графиком и таблицей: их ошибки не роняют отчёт, но должны быть видны. */
  chart: string;
  sheet: string;
}

// Отчёт по одному аккаунту: замер → снапшот → сообщение → график → таблица.
// График и таблица изолированы: их сбой не отменяет уже отправленный отчёт.
async function runAccountReport(acc: AccountConfig, now: Date): Promise<AccountResult> {
  const igUserId = accountUserId(acc);
  const token = await resolveToken(acc);

  const media = await fetchAllReels(igUserId, token);
  const views = await fetchViews(token, media.map((m) => m.id));
  const followersCount = await fetchFollowersCount(igUserId, token);

  const todayKey = jakartaDateKey(now);
  const prev = await loadPreviousSnapshot(todayKey, acc);

  // Окно follows/unfollows = период отчёта (от прошлого замера до текущего),
  // чтобы валовые цифры относились к тому же промежутку, что и чистый прирост.
  const followerChanges = await fetchFollowsAndUnfollows(
    igUserId,
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

  await saveSnapshot(todayKey, current, acc);

  const report = computeReport(current, prev);
  await sendMessage(formatMessage(report, followerChanges, acc.label));

  // График динамики (просмотры/день + заходы по ссылке этого аккаунта) за 14 дней.
  // Изолирован: любая ошибка (QuickChart/PostHog/мало данных) не роняет отчёт.
  let chart: string;
  try {
    const snaps = await loadRecentSnapshots(15, acc); // 15 снапшотов → до 14 приростов
    const viewsSeries = computeDailyViewGains(snaps).slice(-14);
    const clicksSince = Math.floor((now.getTime() - 14 * 86_400_000) / 1000);
    const clicksSeries = acc.clicksCondition ? await getDailyClicks(clicksSince, acc.clicksCondition) : [];
    const skip = chartSkipReason(viewsSeries, clicksSeries);
    if (skip) {
      chart = `пропущен: ${skip}`;
    } else {
      const png = await renderChartPng(
        buildTrendChart(viewsSeries, clicksSeries, `Динамика за 14 дней · ${acc.label}`)
      );
      await sendPhoto(png, `📈 Динамика за 14 дней · ${escapeHtml(acc.label)}`);
      chart = `отправлен (просмотры: ${viewsSeries.length} дн., заходы: ${clicksSeries.length} дн.)`;
    }
  } catch (e) {
    console.error(`trend chart failed (${acc.key}):`, e);
    chart = `ошибка: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Google-таблица со статистикой по всем рилсам. Отдельного планировщика не заводим —
  // обновляемся вместе с ежедневным отчётом. Изолировано: ошибка Sheets не должна
  // ронять уже отправленный отчёт.
  let sheet: string;
  try {
    if (!sheetsConfigured()) {
      sheet = "пропущена: доступ к таблице не настроен";
    } else {
      const synced = await syncAccountSheets(acc, igUserId, token);
      sheet = `обновлена (${synced.reels} рилсов, ${synced.historyDays} дн. истории)`;
    }
  } catch (e) {
    console.error(`sheet sync failed (${acc.key}):`, e);
    sheet = `ошибка: ${e instanceof Error ? e.message : String(e)}`;
  }

  return {
    account: acc.key,
    reels: current.reels.length,
    newReels: report.newReels.length,
    totalGain: report.totalGain,
    followers: followersCount,
    chart,
    sheet,
  };
}

async function reportAccountFailure(acc: AccountConfig, e: unknown): Promise<void> {
  const msg = e instanceof Error ? e.message : String(e);
  try {
    if (/OAuth|access.?token|Session has expired|code.? ?190/i.test(msg)) {
      await sendMessage(
        `⚠️ Токен Instagram для ${escapeHtml(acc.label)}, похоже, истёк или отозван. Перевыпустите токен по инструкции в SETUP.md (раздел 1) и обновите переменную ${acc.tokenEnv} в Vercel.\n<code>${escapeHtml(msg)}</code>`
      );
    } else {
      await sendMessage(
        `⚠️ Не удалось сформировать отчёт по рилсам ${escapeHtml(acc.label)}:\n<code>${escapeHtml(msg)}</code>`
      );
    }
  } catch {
    // Telegram тоже недоступен — остаётся лог Vercel.
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // ?only=<ключ аккаунта> — ручной прогон по одному аккаунту: без дедупликации и без
    // общих сводок, чтобы проверка не съедала дневной запуск и не дублировала клики.
    const only = req.nextUrl.searchParams.get("only");
    const accounts = accountsToRun(only);
    if (accounts.length === 0) {
      return NextResponse.json({ ok: false, error: "нет настроенных аккаунтов" }, { status: 500 });
    }

    // Дедупликация: внешний планировщик и запасной крон Vercel могут сработать
    // в один день оба — второй запуск молча пропускается. ?force=1 — для ручных тестов.
    const force = req.nextUrl.searchParams.get("force") === "1";
    const now = new Date();
    const todayKey = jakartaDateKey(now);
    if (!only && !force && (await loadLastReportKey()) === todayKey) {
      return NextResponse.json({ ok: true, skipped: true, reason: `report for ${todayKey} already sent` });
    }

    // Аккаунты идут по очереди и каждый со своей защитой: упавший Instagram по одному
    // аккаунту не должен лишать команду отчёта по второму.
    const results: AccountResult[] = [];
    const failures: Array<{ account: string; error: string }> = [];
    for (const acc of accounts) {
      try {
        results.push(await runAccountReport(acc, now));
      } catch (e) {
        console.error(`report failed (${acc.key}):`, e);
        failures.push({ account: acc.key, error: e instanceof Error ? e.message : String(e) });
        await reportAccountFailure(acc, e);
      }
    }

    // Ключ дня ставим, только если хоть один отчёт ушёл: иначе запасной крон должен
    // получить свой шанс повторить прогон.
    if (!only && results.length > 0) await saveLastReportKey(todayKey);

    if (!only) {
      // Сводка кликов по ссылке в шапке → в ту же тему, что и рилс-отчёт («Daily»,
      // env TELEGRAM_THREAD_ID). Ошибка тут не должна ронять уже отправленные
      // рилс-отчёты, поэтому изолируем в свой try.
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
    }

    return NextResponse.json({
      ok: failures.length === 0,
      accounts: results,
      ...(failures.length > 0 ? { failures } : {}),
    });
  } catch (e) {
    console.error("report failed:", e);
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await sendMessage(`⚠️ Не удалось сформировать отчёт по рилсам:\n<code>${escapeHtml(msg)}</code>`);
    } catch {
      // Telegram тоже недоступен — остаётся лог Vercel.
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
