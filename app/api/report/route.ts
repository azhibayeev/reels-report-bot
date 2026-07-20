import { NextRequest, NextResponse } from "next/server";
import { computeReport } from "../../../lib/diff";
import { escapeHtml, formatCsv, formatMessage } from "../../../lib/format";
import { fetchAllReels, fetchViews, refreshLongLivedToken } from "../../../lib/instagram";
import {
  jakartaDateKey,
  loadPreviousSnapshot,
  loadTokenState,
  saveSnapshot,
  saveTokenState,
} from "../../../lib/storage";
import { sendDocument, sendMessage } from "../../../lib/telegram";
import { Snapshot } from "../../../lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TOKEN_REFRESH_AGE_H = 24;

async function resolveToken(): Promise<string> {
  const stored = await loadTokenState();
  const envToken = process.env.IG_ACCESS_TOKEN;
  if (!stored) {
    if (!envToken) throw new Error("IG_ACCESS_TOKEN is not set");
    await saveTokenState({ token: envToken, refreshedAt: new Date().toISOString() });
    return envToken;
  }
  const ageH = (Date.now() - Date.parse(stored.refreshedAt)) / 3_600_000;
  if (ageH < TOKEN_REFRESH_AGE_H) return stored.token;
  try {
    const fresh = await refreshLongLivedToken(stored.token);
    await saveTokenState({ token: fresh, refreshedAt: new Date().toISOString() });
    return fresh;
  } catch (e) {
    // Продление не удалось — работаем на старом токене, ошибка видна в логах.
    console.error("token refresh failed:", e);
    return stored.token;
  }
}

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const token = await resolveToken();

    const media = await fetchAllReels(token);
    const views = await fetchViews(token, media.map((m) => m.id));

    const now = new Date();
    const current: Snapshot = {
      takenAt: now.toISOString(),
      reels: media.map((m) => ({
        id: m.id,
        permalink: m.permalink,
        publishedAt: m.timestamp,
        caption: m.caption,
        views: views.get(m.id) ?? 0,
      })),
    };

    const todayKey = jakartaDateKey(now);
    const prev = await loadPreviousSnapshot(todayKey);
    await saveSnapshot(todayKey, current);

    const report = computeReport(current, prev);
    await sendMessage(formatMessage(report));
    await sendDocument(
      `reels-${todayKey}.csv`,
      formatCsv(report),
      "Полная таблица по всем рилсам"
    );

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
      await sendMessage(`⚠️ Не удалось сформировать отчёт по рилсам:\n<code>${escapeHtml(msg)}</code>`);
    } catch {
      // Telegram тоже недоступен — остаётся лог Vercel.
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
