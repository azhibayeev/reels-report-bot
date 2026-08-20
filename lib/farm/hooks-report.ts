import { escapeHtml } from "../format";
import { TELEGRAM_TEXT_LIMIT } from "./commands";
import type { ReelMetrics } from "./insights";
import type { PublicationRecord } from "./journal";

export interface HookStats {
  hook: string;
  n: number;
  views: number[];
  median: number;
  geoMean: number;
  best: number;
  permalinks: string[];
}

const nf = new Intl.NumberFormat("ru-RU");

// Реальные цифры аккаунта @daristeppe на август 2026, по ним и построены все
// оценки ниже. Держим их константами, а не вшиваем в текст: если разброс
// пересчитают на новых данных, менять придётся одно место, а не пять фраз.
const MEDIAN_VIEWS = 3668;
const MAX_VIEWS = 2_498_516;
// Сигма ЛОГАРИФМОВ просмотров. Именно она, а не сигма самих просмотров, —
// распределение просмотров логнормальное: медиана 3 668 при максимуме 2,5 млн.
const SIGMA_LOG = 0.945;
// Во сколько раз хук должен быть лучше, чтобы отрыв нельзя было списать на
// разброс, если на хук приходится ОДИН ролик. Отсюда растёт вся шкала ниже.
const DETECTABLE_AT_ONE = 42;

// Порог различимого отрыва падает как 1/sqrt(n): усредняя n логарифмов, мы во
// столько же раз сужаем разброс их среднего. Отсюда ratio(n) = 42^(1/√n) —
// та же кривая, что даёт ×42 при одном ролике и ~×5 при пяти.
function detectableRatio(n: number): number {
  return Math.exp(Math.log(DETECTABLE_AT_ONE) / Math.sqrt(n));
}

function fmtRatio(r: number): string {
  // Ниже ×3 округление до целого съедает разницу между ×2,1 и ×2,9 — а это
  // как раз тот диапазон, ради которого человек и досматривает отчёт.
  return r >= 3 ? String(Math.round(r)) : r.toFixed(1).replace(".", ",");
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function reelsWord(n: number): string {
  return plural(n, "ролик", "ролика", "роликов");
}

// Просмотры ролика или null, если цифр нет. Три разных «нет цифр» — отсутствие
// записи в карте (ролик удалён из аккаунта, Graph о нём молчит), error от Graph
// и пустая метрика — одинаково опасны: любая из них, посчитанная за ноль,
// превратила бы хороший хук в провальный. Поэтому все три уходят в null.
function viewsOf(m: ReelMetrics | undefined): number | null {
  if (!m || m.error !== null) return null;
  return typeof m.views === "number" ? m.views : null;
}

function median(sortedDesc: number[]): number {
  const mid = Math.floor(sortedDesc.length / 2);
  if (sortedDesc.length % 2 === 1) return sortedDesc[mid];
  return Math.round((sortedDesc[mid - 1] + sortedDesc[mid]) / 2);
}

// Среднее геометрическое через логарифмы. Арифметическое здесь бесполезно:
// один ролик на 2,5 млн при медиане 3,7 тыс. утащит среднее в свою сторону, и
// хук «победит» из-за одного попадания, а не из-за качества. В логарифмах
// такой выброс — это +5 к сумме, а не ×700, и остальные ролики его слышно.
function geoMean(values: number[]): number {
  if (values.length === 0) return 0;
  // Ролик с нулём просмотров дал бы log(0) = -Infinity и обнулил бы хук целиком.
  // На шкале просмотров разница между 0 и 1 не значит ничего, поэтому дно — 1.
  const sum = values.reduce((acc, v) => acc + Math.log(Math.max(v, 1)), 0);
  return Math.round(Math.exp(sum / values.length));
}

/**
 * Группирует публикации по ТОЧНОМУ тексту хука и сортирует по среднему
 * геометрическому просмотров.
 *
 * n — сколько роликов вышло с этим хуком, views — просмотры только тех, у кого
 * цифры есть. Расхождение n и views.length намеренно сохранено: именно оно
 * показывает, сколько роликов выпало из расчёта, и отчёт печатает это вслух.
 */
export function rankHooks(records: PublicationRecord[], metrics: Map<string, ReelMetrics>): HookStats[] {
  interface Bucket {
    hook: string;
    n: number;
    entries: Array<{ views: number; permalink: string | null }>;
    unmeasuredLinks: string[];
  }
  const buckets = new Map<string, Bucket>();

  for (const rec of records) {
    let b = buckets.get(rec.hook);
    if (!b) {
      b = { hook: rec.hook, n: 0, entries: [], unmeasuredLinks: [] };
      buckets.set(rec.hook, b);
    }
    b.n += 1;
    const views = viewsOf(metrics.get(rec.igMediaId));
    if (views === null) {
      if (rec.permalink) b.unmeasuredLinks.push(rec.permalink);
    } else {
      b.entries.push({ views, permalink: rec.permalink });
    }
  }

  const stats: HookStats[] = [];
  for (const b of buckets.values()) {
    // Сортируем пары «просмотры + ссылка» вместе, чтобы permalinks[0] вёл
    // именно на лучший ролик: ради него в отчёт и ходят.
    const entries = [...b.entries].sort((x, y) => y.views - x.views);
    const views = entries.map((e) => e.views);
    const permalinks = entries.map((e) => e.permalink).filter((p): p is string => Boolean(p));
    stats.push({
      hook: b.hook,
      n: b.n,
      views,
      median: views.length > 0 ? median(views) : 0,
      geoMean: geoMean(views),
      best: views.length > 0 ? views[0] : 0,
      // Хук, у которого цифр нет вовсе, всё равно должен давать ссылки: иначе
      // из отчёта не дойти до ролика, чтобы проверить, жив ли он.
      permalinks: permalinks.length > 0 ? permalinks : b.unmeasuredLinks,
    });
  }

  // Хуки без цифр (geoMean = 0) естественно уезжают в конец. Тай-брейк по числу
  // роликов и тексту — чтобы порядок не плясал от порядка чтения журнала.
  return stats.sort(
    (a, b) => b.geoMean - a.geoMean || b.views.length - a.views.length || a.hook.localeCompare(b.hook, "ru")
  );
}

/**
 * Честная приписка о том, что вообще можно прочитать в этой таблице. Считается
 * по САМОМУ бедному хуку: рейтинг ровно настолько надёжен, насколько надёжна
 * его слабейшая строка.
 */
export function reliabilityNote(stats: HookStats[]): string {
  const measured = stats.filter((s) => s.views.length > 0);
  if (measured.length === 0) {
    return "⚠️ Ни у одного ролика нет цифр: метрики не прочитались, сравнивать хуки не по чему.";
  }
  const minN = Math.min(...measured.map((s) => s.views.length));

  if (minN === 1) {
    return (
      "⚠️ <b>Это ранжирование шума, а не хуков.</b> На часть хуков приходится один ролик, " +
      `а разброс просмотров на аккаунте огромен: медиана ${nf.format(MEDIAN_VIEWS)}, ` +
      `максимум ${nf.format(MAX_VIEWS)}, σ логарифмов ${String(SIGMA_LOG).replace(".", ",")}. ` +
      `При одном ролике хук должен быть примерно в ×${DETECTABLE_AT_ONE} раза лучше, чтобы отрыв ` +
      "нельзя было объяснить случайностью; выбирая лучший хук по одному ролику, попадаешь в " +
      "действительно лучший примерно в 10% случаев. Принимать решения по этой таблице нельзя — " +
      "сначала нужно набрать хотя бы по 5 роликов на хук. Цифры порогов — оценка, а не точный тест."
    );
  }

  if (minN <= 4) {
    return (
      `⚠️ Данных мало: у самого бедного хука ${minN} ${reelsWord(minN)}. На таком объёме различимы ` +
      // Порог берём из той же формулы, что даёт ×42 при одном ролике. Круглое
      // «×5» стояло тут зашитым и занижало требование втрое: при двух роликах
      // формула требует ×14. Занижение опаснее завышения — оно делает человека
      // увереннее, чем позволяют данные, ради чего этот модуль и написан.
      `только отрывы примерно от ×${fmtRatio(detectableRatio(minN))} — всё, что ближе, объясняется разбросом просмотров ` +
      `(σ логарифмов ${String(SIGMA_LOG).replace(".", ",")}, медиана ${nf.format(MEDIAN_VIEWS)}). ` +
      "Смотреть на таблицу стоит, ставить на неё бюджет — рано. Порог — оценка, а не точный тест."
    );
  }

  return (
    `ℹ️ Данных хватает на грубое сравнение: у самого бедного хука ${minN} ${reelsWord(minN)}. ` +
    `Различимым стоит считать отрыв примерно от ×${fmtRatio(detectableRatio(minN))}; меньшие разницы ` +
    `объясняются разбросом просмотров (σ логарифмов ${String(SIGMA_LOG).replace(".", ",")} на данных ` +
    "аккаунта). Порог — оценка, а не точный тест."
  );
}

// Сколько хуков показываем по умолчанию: дальше первой десятки список читают
// уже не глазами, а поиском, а лимит Telegram один на всё сообщение.
const DEFAULT_LIMIT = 10;
// Хуки бывают длинными предложениями; в строку таблицы влезает начало.
const MAX_HOOK_CHARS = 90;

function hookLabel(hook: string): string {
  // Режем ДО экранирования: срез по готовому HTML легко приходится внутрь
  // «&amp;», и Telegram отвечает 400 «can't parse entities».
  const cut = hook.length > MAX_HOOK_CHARS ? `${hook.slice(0, MAX_HOOK_CHARS)}…` : hook;
  return escapeHtml(cut);
}

function bestCell(s: HookStats): string {
  const link = s.permalinks[0];
  const value = nf.format(s.best);
  return link ? `<a href="${escapeHtml(link)}">${value}</a>` : value;
}

function row(s: HookStats, place: number): string {
  const missing = s.n - s.views.length;
  const tail = missing > 0 ? ` · без цифр: ${missing}` : "";
  return (
    `${place}. «${hookLabel(s.hook)}» — <b>${nf.format(s.geoMean)}</b> ср.геом · ` +
    `медиана ${nf.format(s.median)} · лучший ${bestCell(s)} · ` +
    `${s.n} ${reelsWord(s.n)}${tail}`
  );
}

function blindRow(s: HookStats): string {
  return `«${hookLabel(s.hook)}» — ${s.n} ${reelsWord(s.n)}, цифр нет`;
}

/**
 * Собирает сообщение для Telegram. Предупреждение и итог — несущие части: их
 * не выбрасывает никакая обрезка, потому что таблица без оговорки о значимости
 * опаснее, чем отсутствие таблицы.
 */
export function formatHooksReport(stats: HookStats[], opts?: { limit?: number }): string {
  if (stats.length === 0) {
    return "🎣 <b>Хуки → просмотры</b>\n\nЖурнал публикаций пуст: сравнивать хуки пока не по чему.";
  }

  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const measured = stats.filter((s) => s.views.length > 0);
  const blind = stats.filter((s) => s.views.length === 0);
  const reels = stats.reduce((acc, s) => acc + s.n, 0);
  const withViews = stats.reduce((acc, s) => acc + s.views.length, 0);
  const missing = reels - withViews;

  const header = "🎣 <b>Хуки → просмотры</b>";
  const note = reliabilityNote(stats);
  const totals =
    `Итого: ${stats.length} ${plural(stats.length, "хук", "хука", "хуков")}, ` +
    `${withViews} ${reelsWord(withViews)} с цифрами` +
    (missing > 0 ? `, ещё ${missing} без цифр (ролик удалён или Graph не отдал метрики)` : "");

  const wanted = measured.slice(0, limit).map((s, i) => row(s, i + 1));
  // Слепые хуки идут отдельным хвостом: смешивать их с рейтингом — значит
  // выдавать «нет данных» за «ноль просмотров».
  // Хвост слепых хуков режем по СВОЕЙ квоте, а не по limit: limit задаёт
  // вызывающий, и при большом значении эта «фиксированная» часть перерастала
  // весь лимит сообщения (проверено: 200 слепых хуков давали 21 тысячу знаков
  // при лимите в 4096, Telegram отвечает на такое 400).
  const blindLines = buildBlindTail(blind, blindRow);

  // Марку обрезки резервируем ЗАРАНЕЕ и по максимальной длине: добавлять её
  // после того, как строки уже заняли весь лимит, — значит вылезти за него.
  const cutNote = `…показаны ${measured.length} из ${measured.length} хуков`;
  const fixed = [header, "", note, "", ...blindLines, blindLines.length > 0 ? "" : null, totals]
    .filter((x): x is string => x !== null)
    .join("\n");
  let budget = TELEGRAM_TEXT_LIMIT - fixed.length - cutNote.length - 2;

  const shown: string[] = [];
  for (const line of wanted) {
    if (budget - (line.length + 1) < 0) break;
    shown.push(line);
    budget -= line.length + 1;
  }

  const body: string[] = [header, ""];
  if (shown.length > 0) body.push(...shown);
  else body.push("Ни одна строка рейтинга не влезла в сообщение.");
  if (shown.length < measured.length) {
    body.push(`…показаны ${shown.length} из ${measured.length} хуков`);
  }
  body.push("");
  body.push(note);
  body.push("");
  if (blindLines.length > 0) {
    body.push(...blindLines);
    body.push("");
  }
  body.push(totals);

  const text = body.join("\n");
  // Последняя черта. Всё выше считает бюджет заранее, но любая будущая правка
  // заголовка или итога может снова его переполнить, а цена ошибки — Telegram
  // отвечает 400 и человек не получает отчёт вообще. Обрезаем так, чтобы
  // предупреждение выжило: без него отчёт врёт, а без хвоста таблицы — нет.
  return text.length <= TELEGRAM_TEXT_LIMIT ? text : clampKeepingNote(text, note);
}

// Слепым хукам отводим не больше пятой части сообщения: это справка «данных
// нет», а не рейтинг, и вытеснять ею таблицу с цифрами нельзя.
const BLIND_TAIL_BUDGET = Math.floor(TELEGRAM_TEXT_LIMIT / 5);

function buildBlindTail(blind: HookStats[], blindRow: (s: HookStats) => string): string[] {
  if (blind.length === 0) return [];
  const parts: string[] = [];
  let used = 0;
  for (const s of blind) {
    const piece = blindRow(s);
    if (used + piece.length + 2 > BLIND_TAIL_BUDGET) break;
    parts.push(piece);
    used += piece.length + 2;
  }
  const hidden = blind.length - parts.length;
  if (parts.length === 0) return [`Без цифр вовсе: ${blind.length} ${plural(blind.length, "хук", "хука", "хуков")}`];
  const tail = hidden > 0 ? `; …и ещё ${hidden} без цифр` : "";
  return [`Без цифр вовсе: ${parts.join("; ")}${tail}`];
}

function clampKeepingNote(text: string, note: string): string {
  const marker = "\n\n⟨сообщение обрезано⟩";
  const room = TELEGRAM_TEXT_LIMIT - marker.length - note.length - 2;
  if (room <= 0) return note.slice(0, TELEGRAM_TEXT_LIMIT);
  return `${text.slice(0, room)}${marker}\n\n${note}`;
}
