import { Report } from "./types";

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

export function formatMessage(r: Report): string {
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
