import { FollowerChanges, FollowerStats, Report, Snapshot } from "./types";

const nf = new Intl.NumberFormat("ru-RU");

const dtf = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function fmtDateTime(iso: string): string {
  return dtf.format(new Date(iso));
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function signed(n: number): string {
  return (n > 0 ? "+" : "") + nf.format(n);
}

function followersLine(f: FollowerStats, deltaLabel: string): string {
  const base = `👥 Подписчиков: <b>${nf.format(f.count)}</b>`;
  return f.delta === null ? base : `${base} (<b>${signed(f.delta)}</b> ${deltaLabel})`;
}

function followerChangesLine(c: FollowerChanges): string {
  return `➕ Подписалось: <b>${nf.format(c.follows)}</b> · ➖ Отписалось: <b>${nf.format(c.unfollows)}</b> (за сутки, данные Instagram)`;
}

export function formatMessage(r: Report, changes?: FollowerChanges | null): string {
  const lines: string[] = [];
  lines.push("📊 <b>Отчёт по рилсам</b>");
  if (r.periodStart) {
    lines.push(`Период: с ${fmtDateTime(r.periodStart)} по ${fmtDateTime(r.periodEnd)} (время Джакарты)`);
  } else {
    lines.push(`Первый замер: ${fmtDateTime(r.periodEnd)} (время Джакарты)`);
  }
  lines.push("");

  if (r.isBaseline) {
    lines.push(`🆕 Новых рилсов за последние 24 часа: <b>${r.newReels.length}</b>`);
    lines.push("");
    lines.push(`👁 ТОТАЛ просмотров по ${nf.format(r.all.length)} рилсам: <b>${nf.format(r.totalViews)}</b>`);
    lines.push("ℹ️ Это базовый замер — прирост за сутки появится в завтрашнем отчёте.");
  } else {
    const newGain = r.newReels.reduce((s, reel) => s + reel.gain, 0);
    lines.push(`🆕 Новых рилсов за период: <b>${r.newReels.length}</b>`);
    lines.push(`⚡️ Новые рилсы набрали за эти 24 часа: <b>${nf.format(newGain)}</b> просмотров`);
    lines.push("");
    lines.push(`▶️ Прирост ТОТАЛ просмотров за последние 24 часа: <b>${signed(r.totalGain)}</b>`);
    lines.push(`👁 ТОТАЛ просмотров по ${nf.format(r.all.length)} рилсам: <b>${nf.format(r.totalViews)}</b>`);
  }

  if (r.followers) {
    lines.push("");
    lines.push(followersLine(r.followers, "за период"));
    if (changes) lines.push(followerChangesLine(changes));
  }

  return lines.join("\n");
}

// Ответ на команду /info: общая статистика по аккаунту на текущий момент.
export function formatInfoMessage(snap: Snapshot): string {
  const lines: string[] = [];
  lines.push("📈 <b>Общая статистика</b>");
  lines.push(`На ${fmtDateTime(snap.takenAt)} (время Джакарты)`);
  lines.push("");
  if (snap.followersCount != null) {
    lines.push(`👥 Подписчиков: <b>${nf.format(snap.followersCount)}</b>`);
  }
  lines.push(`🎬 Рилсов: <b>${nf.format(snap.reels.length)}</b>`);
  const total = snap.reels.reduce((s, r) => s + r.views, 0);
  lines.push(`👁 ТОТАЛ просмотров: <b>${nf.format(total)}</b>`);
  if (snap.reels.length > 0) {
    lines.push(`📊 В среднем на рилс: <b>${nf.format(Math.round(total / snap.reels.length))}</b>`);
    const best = snap.reels.reduce((a, b) => (b.views > a.views ? b : a));
    lines.push(`🏆 Лучший рилс: <b>${nf.format(best.views)}</b> — <a href="${best.permalink}">открыть</a>`);
    const last = snap.reels.reduce((a, b) => (Date.parse(b.publishedAt) > Date.parse(a.publishedAt) ? b : a));
    lines.push(`📅 Последняя публикация: ${fmtDateTime(last.publishedAt)}`);
  }
  return lines.join("\n");
}

// Ответ на команду /now: период от последнего ежедневного замера (~12:30) до текущего момента.
export function formatNowMessage(r: Report): string {
  const lines: string[] = [];
  lines.push("⚡️ <b>Отчёт на сейчас</b>");
  if (r.isBaseline) {
    lines.push(`На ${fmtDateTime(r.periodEnd)} (время Джакарты)`);
    lines.push("");
    lines.push(`👁 ТОТАЛ просмотров по ${nf.format(r.all.length)} рилсам: <b>${nf.format(r.totalViews)}</b>`);
    lines.push("ℹ️ Базового замера ещё нет — прирост появится после первого ежедневного отчёта.");
    return lines.join("\n");
  }
  lines.push(`С ${fmtDateTime(r.periodStart!)} по ${fmtDateTime(r.periodEnd)} (время Джакарты)`);
  lines.push("");
  const newGain = r.newReels.reduce((s, reel) => s + reel.gain, 0);
  lines.push(`🆕 Выпущено видео: <b>${r.newReels.length}</b>`);
  if (r.newReels.length > 0) {
    lines.push(`⚡️ Новые видео набрали: <b>${nf.format(newGain)}</b> просмотров`);
  }
  lines.push(`▶️ Прирост с 12:30 вчера: <b>${signed(r.totalGain)}</b>`);
  lines.push(`👁 ТОТАЛ просмотров по ${nf.format(r.all.length)} рилсам: <b>${nf.format(r.totalViews)}</b>`);
  if (r.followers) {
    lines.push(followersLine(r.followers, "с 12:30 вчера"));
  }
  return lines.join("\n");
}

function csvCell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function formatCsv(r: Report): string {
  const rows: string[][] = [["№", "Ссылка", "Дата публикации", "Просмотров всего", "Прирост за период"]];
  const sorted = [...r.all].sort((a, b) => b.gain - a.gain);
  sorted.forEach((reel, i) => {
    rows.push([String(i + 1), reel.permalink, fmtDateTime(reel.publishedAt), String(reel.views), String(reel.gain)]);
  });
  return "﻿" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}
