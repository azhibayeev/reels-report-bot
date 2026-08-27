import { ambassadorLabel } from "./applink";
import type { StoreClicks } from "./applink-store";
import type { AdInsights } from "./meta";
import type { LeadLevels } from "./leads";
import type { ClicksStats } from "./posthog";
import { DayPoint, FollowerChanges, FollowerStats, FunnelSeries, Report, Snapshot } from "./types";

const nf = new Intl.NumberFormat("ru-RU");

// Деньги: сумма + валюта аккаунта. USD → «$1 234.56», иначе «1 234.56 EUR».
const money = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtMoney(amount: number, currency: string): string {
  const n = money.format(amount);
  return currency === "USD" ? `$${n}` : `${n} ${escapeHtml(currency)}`;
}

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
  return `➕ Подписалось: <b>${nf.format(c.follows)}</b> · ➖ Отписалось: <b>${nf.format(c.unfollows)}</b> (валовые данные Instagram за период; их разница может не совпадать с чистым приростом выше)`;
}

// Подпись аккаунта в заголовке: в чат приходят отчёты по нескольким аккаунтам подряд,
// без метки их не различить. Пусто — заголовок как раньше.
function withAccount(title: string, account?: string): string {
  return account ? `${title} · ${escapeHtml(account)}` : title;
}

export function formatMessage(r: Report, changes?: FollowerChanges | null, account?: string): string {
  const lines: string[] = [];
  lines.push(`📊 <b>${withAccount("Отчёт по рилсам", account)}</b>`);
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
export function formatInfoMessage(snap: Snapshot, account?: string): string {
  const lines: string[] = [];
  lines.push(`📈 <b>${withAccount("Общая статистика", account)}</b>`);
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
export function formatNowMessage(r: Report, account?: string): string {
  const lines: string[] = [];
  lines.push(`⚡️ <b>${withAccount("Отчёт на сейчас", account)}</b>`);
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

// Подпись к графику воронки. Картинку в Telegram смотрят с телефона, и мелкие цифры
// на ней читаются плохо — поэтому последний день воронки дублируем текстом.
// «—» вместо нуля значит «за этот день данных нет»: у уровня может не быть источника.
function dayValue(series: DayPoint[], day: string): number | null {
  const point = series.find((p) => p.date === day);
  return point ? point.value : null;
}

export function formatFunnelCaption(account: string, day: string, s: FunnelSeries): string {
  const n = (series: DayPoint[]): string => {
    const v = dayValue(series, day);
    return v === null ? "—" : `<b>${nf.format(v)}</b>`;
  };
  return (
    `📈 <b>Воронка за 14 дней · ${escapeHtml(account)}</b>\n` +
    `За сутки: вход ${n(s.published)} роликов → ${n(s.views)} просмотров → ` +
    `выход ${n(s.joins)} заходов в сообщество · ${n(s.store)} переходов в стор`
  );
}

// Сводка заходов по ссылкам. Метрика — уникальные люди. title/период задаёт вызывающий.
export function formatClicksMessage(s: ClicksStats, title: string): string {
  const now = new Date();
  const period =
    s.sinceEpoch <= 0
      ? "За всё время"
      : `С ${fmtDateTime(new Date(s.sinceEpoch * 1000).toISOString())} по ${fmtDateTime(now.toISOString())} (Джакарта)`;

  // источники категории с уник. > 0, по убыванию, в строку «name — N»
  const inline = (cat: string): string =>
    s.sources
      .filter((x) => x.category === cat && x.uniq > 0)
      .sort((a, b) => b.uniq - a.uniq)
      .map((x) => `${escapeHtml(x.name)} — <b>${nf.format(x.uniq)}</b>`)
      .join(" · ");

  const lines: string[] = [`📊 <b>${title}</b>`, period, ""];

  const bio = inline("bio");
  const inf = inline("inf");
  const other = inline("other");
  const direct = s.sources.filter((x) => x.category === "direct" && x.uniq > 0).reduce((sum, x) => sum + x.uniq, 0);

  if (bio) lines.push(`<b>Шапки:</b> ${bio}`);
  if (inf) lines.push(`<b>Инфлюенсеры:</b> ${inf}`);
  if (direct) lines.push(`<b>Прямые:</b> <b>${nf.format(direct)}</b>`);
  if (other) lines.push(`<b>Другое:</b> ${other}`);
  if (!bio && !inf && !direct && !other) lines.push("Пока нет заходов за период.");

  return lines.join("\n");
}

// Сводка переходов в стор по коротким ссылкам амбассадоров (/go/<слаг>).
// Метрика — переходы, не уникальные люди: у редиректа нет ни куки, ни person_id,
// а установки всё равно считают консоли Play и App Store, только сутками позже.
export function formatStoreClicksMessage(rows: StoreClicks[], title: string, from: Date, to: Date): string {
  const period = `С ${fmtDateTime(from.toISOString())} по ${fmtDateTime(to.toISOString())} (Джакарта)`;
  const lines: string[] = [`📲 <b>${escapeHtml(title)}</b>`, period, ""];

  const store = (r: StoreClicks): number => r.android + r.ios;
  const total = rows.reduce((s, r) => s + store(r), 0);
  const desktop = rows.reduce((s, r) => s + r.desktop, 0);

  if (total === 0) {
    lines.push("Пока нет переходов за период.");
    return lines.join("\n");
  }

  for (const r of rows) {
    // Разбивку показываем только по той витрине, куда кто-то дошёл: «App Store 0»
    // в строке — шум, из-за которого не видно живых цифр.
    const split = [
      r.android > 0 ? `Play ${nf.format(r.android)}` : null,
      r.ios > 0 ? `App Store ${nf.format(r.ios)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const tail = split ? ` (${split})` : "";
    lines.push(`${escapeHtml(ambassadorLabel(r.slug))} — <b>${nf.format(store(r))}</b>${tail}`);
  }

  lines.push("");
  lines.push(`Σ ТОТАЛ — <b>${nf.format(total)}</b>`);
  if (desktop > 0) {
    lines.push(
      `<i>Ещё ${nf.format(desktop)} открыли с компьютера — там страница выбора, в стор не считаем.</i>`
    );
  }

  return lines.join("\n");
}

// Сводка по таргету: рекламные метрики + разбивка лидов по уровню инвестора.
// periodLabel задаёт вызывающий (напр. «за вчерашние сутки» / «за всё время»).
// levels = null — база лидов квиза не подключена. Рекламную часть это не отменяет:
// цифры Meta приходят своим путём, и терять их из-за отсутствующей разбивки нельзя.
export function formatTargetMessage(
  ads: AdInsights,
  levels: LeadLevels | null,
  title: string,
  periodLabel: string
): string {
  const lines: string[] = [`🎯 <b>Таргет · ${escapeHtml(title)}</b>`, periodLabel, ""];

  lines.push(`💵 Потрачено: <b>${fmtMoney(ads.spend, ads.currency)}</b>`);
  lines.push(`🧲 Лидов (результатов): <b>${nf.format(ads.leads)}</b>`);
  lines.push(
    `💲 Цена за результат: <b>${ads.costPerResult == null ? "—" : fmtMoney(ads.costPerResult, ads.currency)}</b>`
  );
  lines.push(`👁 Показы: <b>${nf.format(ads.impressions)}</b>`);
  lines.push(`🖱 Клики: <b>${nf.format(ads.clicks)}</b>`);
  lines.push(`📣 Охват: <b>${nf.format(ads.reach)}</b>`);
  if (!ads.hasData) lines.push("<i>За период не было открутки — цифры нулевые.</i>");

  lines.push("");
  if (!levels) {
    lines.push("<i>Разбивка по лидам не настроена: квиз пишет заявки мимо базы, читать нечего.</i>");
    return lines.join("\n");
  }
  lines.push("<b>Потенциал инвестора</b> (дошли до конца квиза):");
  lines.push(`🔥 Высокий: <b>${nf.format(levels.high)}</b>`);
  lines.push(`🟡 Средний: <b>${nf.format(levels.medium)}</b>`);
  lines.push(`⚪ Низкий: <b>${nf.format(levels.low)}</b>`);
  lines.push(`Σ Всего лидов: <b>${nf.format(levels.total)}</b>`);

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
