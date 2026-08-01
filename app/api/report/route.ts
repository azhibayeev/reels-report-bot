import { NextRequest, NextResponse } from "next/server";
import { computeReport } from "../../../lib/diff";
import { escapeHtml, formatClicksMessage, formatMessage } from "../../../lib/format";
import { getClicksStats, lastSprintStart } from "../../../lib/posthog";
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
  saveLastReportKey,
  saveSnapshot,
} from "../../../lib/storage";
import { sendMessage } from "../../../lib/telegram";
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
