import { Report, ReelReport } from "./types";

const nf = new Intl.NumberFormat("ru-RU");

const dtf = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const dateOnly = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
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

function reelLink(r: ReelReport): string {
  const firstLine = r.caption.trim().split("\n")[0].trim();
  const title = firstLine
    ? firstLine.length > 40
      ? firstLine.slice(0, 40) + "…"
      : firstLine
    : `Рилс от ${dateOnly.format(new Date(r.publishedAt))}`;
  return `<a href="${escapeHtml(r.permalink)}">${escapeHtml(title)}</a>`;
}

const NEW_REELS_LIMIT = 20;

export function formatMessage(r: Report): string {
  const period = r.periodStart
    ? `${fmtDateTime(r.periodStart)} — ${fmtDateTime(r.periodEnd)}`
    : `по состоянию на ${fmtDateTime(r.periodEnd)}`;

  const lines: string[] = [];
  lines.push("📊 <b>Отчёт по рилсам</b>");
  lines.push(`Период: ${period} (время Джакарты)`);
  lines.push("");

  if (r.isBaseline) {
    lines.push(`👁 Всего просмотров по ${nf.format(r.all.length)} рилсам: <b>${nf.format(r.totalViews)}</b>`);
    lines.push("ℹ️ Это базовый замер — прирост за сутки появится в завтрашнем отчёте.");
  } else {
    lines.push(`▶️ Прирост просмотров за период: <b>${signed(r.totalGain)}</b>`);
    lines.push(`👁 Всего просмотров по ${nf.format(r.all.length)} рилсам: <b>${nf.format(r.totalViews)}</b>`);
  }

  lines.push("");
  lines.push(`🆕 Новых рилсов за период: <b>${r.newReels.length}</b>`);
  r.newReels.slice(0, NEW_REELS_LIMIT).forEach((reel, i) => {
    lines.push(`${i + 1}. ${reelLink(reel)} — ${nf.format(reel.views)} просмотров`);
  });
  if (r.newReels.length > NEW_REELS_LIMIT) {
    lines.push(`… и ещё ${r.newReels.length - NEW_REELS_LIMIT} (полный список в CSV)`);
  }

  if (r.top.length > 0) {
    lines.push("");
    lines.push(`🏆 Топ-${r.top.length} по приросту:`);
    r.top.forEach((reel, i) => {
      lines.push(`${i + 1}. ${reelLink(reel)} — ${signed(reel.gain)} (всего ${nf.format(reel.views)})`);
    });
  }

  return lines.join("\n");
}

function csvCell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function formatCsv(r: Report): string {
  const rows: string[][] = [["Ссылка", "Дата публикации", "Просмотров всего", "Прирост за период"]];
  for (const reel of [...r.all].sort((a, b) => b.gain - a.gain)) {
    rows.push([reel.permalink, fmtDateTime(reel.publishedAt), String(reel.views), String(reel.gain)]);
  }
  return "﻿" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}
