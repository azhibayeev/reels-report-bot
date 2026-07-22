import { NextRequest, NextResponse } from "next/server";
import { computeReport } from "../../../lib/diff";
import { escapeHtml, formatCsv, formatMessage } from "../../../lib/format";
import { fetchAllReels, fetchViews, refreshLongLivedToken } from "../../../lib/instagram";
import {
  jakartaDateKey,
  loadLastReportKey,
  loadPreviousSnapshot,
  loadTokenState,
  saveLastReportKey,
  saveSnapshot,
  saveTokenState,
  sha256Hex,
} from "../../../lib/storage";
import { sendDocument, sendMessage } from "../../../lib/telegram";
import { Snapshot } from "../../../lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TOKEN_REFRESH_AGE_H = 24;

async function resolveToken(): Promise<string> {
  const stored = await loadTokenState();
  const envToken = process.env.IG_ACCESS_TOKEN;

  if (envToken) {
    const envHash = sha256Hex(envToken);
    if (!stored || stored.seedHash !== envHash) {
      const now = new Date().toISOString();
      await saveTokenState({ token: envToken, refreshedAt: now, seedHash: envHash });
      return envToken;
    }
    const ageH = (Date.now() - Date.parse(stored.refreshedAt)) / 3_600_000;
    if (ageH < TOKEN_REFRESH_AGE_H) return stored.token;
    try {
      const fresh = await refreshLongLivedToken(stored.token);
      await saveTokenState({ token: fresh, refreshedAt: new Date().toISOString(), seedHash: envHash });
      return fresh;
    } catch (e) {
      // Продление не удалось — работаем на старом токене, ошибка видна в логах.
      console.error("token refresh failed:", e);
      return stored.token;
    }
  }

  if (!stored) throw new Error("IG_ACCESS_TOKEN is not set");
  const ageH = (Date.now() - Date.parse(stored.refreshedAt)) / 3_600_000;
  if (ageH < TOKEN_REFRESH_AGE_H) return stored.token;
  try {
    const fresh = await refreshLongLivedToken(stored.token);
    await saveTokenState({ token: fresh, refreshedAt: new Date().toISOString(), seedHash: stored.seedHash });
    return fresh;
  } catch (e) {
    console.error("token refresh failed:", e);
    return stored.token;
  }
}

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

    const now = new Date();
    const todayKey = jakartaDateKey(now);
    const prev = await loadPreviousSnapshot(todayKey);

    const prevViews = new Map((prev?.reels ?? []).map((r) => [r.id, r.views]));

    const current: Snapshot = {
      takenAt: now.toISOString(),
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
    await sendMessage(formatMessage(report));
    await sendDocument(
      `reels-${todayKey}.csv`,
      formatCsv(report),
      "Таблица: все рилсы со ссылками, отсортированы по приросту. Строки 1–10 = ТОП-10 🏆"
    );
    await saveLastReportKey(todayKey);

    return NextResponse.json({
      ok: true,
      reels: current.reels.length,
      newReels: report.newReels.length,
      totalGain: report.totalGain,
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
