// ── Аналитика приложения Qurany (PostHog, проект приложения): DAU, MAU, новые установки,
// какие функции люди трогали за день.
//
// Человек = установка. В production приложение шлёт события анонимно (personProfiles:
// 'never' в qurany-rn/lib/analytics.ts), поэтому считаем уникальные distinct_id: каждая
// установка — свой id, переустановка — новый.
//
// Staging и production пишут в один проект и различаются свойством `environment`,
// которое приложение кладёт в КАЖДОЕ событие. Фильтр стоит внутри агрегатов (uniqIf /
// minIf), а не в WHERE: в этом проекте property-фильтр в WHERE отдаёт results:null —
// см. lib/posthog.ts.

import { phQuery } from "./posthog";
import { jakartaDateKey, lastDayKeys } from "./storage";
import { DayPoint } from "./types";

const PROD = "properties.environment = 'production'";

/** Ширина окна графика и рядов в сутках. Та же, что у воронки рилсов. */
export const APP_SERIES_DAYS = 14;

const DAY_S = 86_400;

/**
 * Функции приложения → события, по которым видно, что ими пользовались. Событие
 * попадает в первую подходящую строку. Чего здесь нет (навигация, тапы по вкладкам,
 * вход, тема, ошибки), то функцией не считается.
 *
 * Имена событий — договор с приложением: qurany-rn/lib/analytics.ts (allowlist) и
 * qurany-rn/lib/reader-messages.ts (тапы в читалке). Переименование там без правки
 * здесь молча обнулит строку.
 *
 * Тафсир, заметка и слово считаются по ОТКРЫТИЮ (тап в меню аята / двойной тап по
 * слову), а не по результату: «Заметка к аяту» — открыли редактор, не обязательно
 * сохранили. Двойной тап по слову приходит как word_long_press — имя осталось от
 * прежнего жеста.
 */
export const APP_FEATURES: ReadonlyArray<{ name: string; when: string }> = [
  { name: "Чтение", when: "event = 'reading_started'" },
  { name: "Аудио", when: "event = 'audio_started'" },
  { name: "Тафсир", when: "event = 'ui_tapped' AND properties.element = 'ayah_tafsir'" },
  { name: "Заметка к аяту", when: "event = 'ui_tapped' AND properties.element = 'ayah_note'" },
  {
    name: "Поделиться аятом",
    when: "event = 'ayah_shared' OR (event = 'ui_tapped' AND properties.element = 'ayah_share')",
  },
  { name: "Произношение слова", when: "event = 'ui_tapped' AND properties.element = 'word_long_press'" },
  {
    name: "Хатм",
    when: "event IN ('day_marked_read', 'khatam_created', 'khatam_joined', 'khatam_started', 'khatam_completed')",
  },
  // Режимы чтения (Mushaf / Guided / Suflor) здесь намеренно нет: у них своя строка
  // в сводке — см. READER_MODES ниже.
  {
    // Khatam Lock + Prayer Lock одной строкой: включили, открыли настройки или
    // упёрлись в экран заблокированного приложения.
    name: "Пауза приложений",
    when:
      "event IN ('focus_lock_enabled', 'shield_opened') OR " +
      "(event = 'screen_viewed' AND properties.screen IN ('focus_lock', 'prayer_lock', 'blocked'))",
  },
  { name: "Виджеты", when: "event = 'widget_opened'" },
  { name: "Настроение", when: "event = 'mood_selected'" },
  { name: "Поиск", when: "event = 'search_performed'" },
  { name: "Избранное", when: "event = 'favorite_toggled'" },
  { name: "Напоминания", when: "event = 'reminder_opened'" },
  { name: "Время намаза", when: "event = 'screen_viewed' AND properties.screen = 'prayer_times'" },
];

/**
 * Режимы читалки: значение свойства `mode` → подпись. Человек «пользовался режимом»,
 * если открыл в нём читалку, переключился на него, начал в нём читать или включил
 * аудио. Один человек может попасть в несколько режимов за день.
 */
const READER_MODES: Record<string, string> = { mushaf: "Mushaf", guided: "Guided", suflor: "Suflor" };
const MODE_EVENTS = "event IN ('reader_opened', 'reader_mode_changed', 'reading_started', 'audio_started')";

/** Метка функции для события прямо в HogQL; '' — событие не функция. */
export function featureLabelSql(): string {
  const branches = APP_FEATURES.map((f) => `(${f.when}), '${f.name}'`).join(", ");
  return `multiIf(${branches}, '')`;
}

export interface FeatureUsage {
  name: string;
  /** Уникальных людей за день. */
  users: number;
}

export interface AppStats {
  /** Отчётный день Джакарты, YYYY-MM-DD. */
  day: string;
  dau: number;
  /** DAU предыдущего дня — для сравнения. */
  prevDau: number;
  /** Уникальные люди за 30 суток, заканчивая отчётным днём. */
  mau: number;
  newInstalls: number;
  prevNewInstalls: number;
  /** Все функции, которыми пользовались за день, по убыванию людей. */
  features: FeatureUsage[];
  /** Режимы чтения за день (Mushaf / Guided / Suflor), по убыванию людей. */
  modes: FeatureUsage[];
  /** Ряды за APP_SERIES_DAYS суток, заканчивая отчётным днём; дни без событий — 0. */
  dauSeries: DayPoint[];
  installSeries: DayPoint[];
}

/**
 * Отчётные сутки — вчерашний календарный день Джакарты, целиком. Не спринт 12:30→12:30,
 * как у рилсов: DAU и MAU — календарные метрики, и цифры должны сходиться с тем, что
 * PostHog показывает на своих графиках (в часовом поясе проекта).
 */
export function appReportDay(now: Date): { day: string; from: number; to: number } {
  const day = jakartaDateKey(new Date(now.getTime() - DAY_S * 1000));
  const from = Date.parse(`${day}T00:00:00+07:00`) / 1000;
  return { day, from, to: from + DAY_S };
}

const N = (v: unknown): number => Number(v) || 0;
const at = (from: number, to: number) =>
  `timestamp >= toDateTime(${from}) AND timestamp < toDateTime(${to})`;

// Ряд из ответа «день → число» на полную ось дней: дня нет в ответе — значит ноль.
function onAxis(days: string[], rows: unknown[][]): DayPoint[] {
  const by = new Map(rows.map((r) => [String(r[0]), N(r[1])]));
  return days.map((date) => ({ date, value: by.get(date) ?? 0 }));
}

export async function getAppStats(now: Date): Promise<AppStats> {
  const project = process.env.POSTHOG_APP_PROJECT_ID || process.env.POSTHOG_PROJECT_ID;
  const q = (hogql: string) => phQuery(hogql, project);

  const { day, from, to } = appReportDay(now);
  const days = lastDayKeys(new Date(to * 1000 - 1000), APP_SERIES_DAYS);
  const seriesFrom = to - APP_SERIES_DAYS * DAY_S;
  const jakartaDay = (col: string) => `toDate(toTimeZone(${col}, 'Asia/Jakarta'))`;

  const [dauRows, installRows, mauRows, featureRows, modeRows] = await Promise.all([
    q(
      `SELECT ${jakartaDay("timestamp")} AS d, uniqIf(distinct_id, ${PROD}) AS u FROM events ` +
        `WHERE ${at(seriesFrom, to)} GROUP BY d ORDER BY d`
    ),
    // Новая установка = первое production-событие этой установки за всю историю.
    // У установки без production-событий minIf вернёт 1970 год — окно её отсечёт.
    q(
      `SELECT ${jakartaDay("first")} AS d, count() AS n FROM ` +
        `(SELECT distinct_id, minIf(timestamp, ${PROD}) AS first FROM events GROUP BY distinct_id) ` +
        `WHERE first >= toDateTime(${seriesFrom}) AND first < toDateTime(${to}) GROUP BY d ORDER BY d`
    ),
    q(`SELECT uniqIf(distinct_id, ${PROD}) AS u FROM events WHERE ${at(to - 30 * DAY_S, to)}`),
    q(
      `SELECT ${featureLabelSql()} AS f, uniqIf(distinct_id, ${PROD}) AS u FROM events ` +
        `WHERE ${at(from, to)} GROUP BY f`
    ),
    q(
      `SELECT properties.mode AS m, uniqIf(distinct_id, ${PROD}) AS u FROM events ` +
        `WHERE ${at(from, to)} AND ${MODE_EVENTS} GROUP BY m`
    ),
  ]);

  const dauSeries = onAxis(days, dauRows);
  const installSeries = onAxis(days, installRows);
  const last = (s: DayPoint[], back: number) => s[s.length - 1 - back]?.value ?? 0;

  // Ничья — по алфавиту, чтобы порядок не прыгал от запуска к запуску.
  const byUsers = (a: FeatureUsage, b: FeatureUsage) => b.users - a.users || a.name.localeCompare(b.name, "ru");
  const features = featureRows
    .map((r) => ({ name: String(r[0]), users: N(r[1]) }))
    .filter((f) => f.name !== "" && f.users > 0)
    .sort(byUsers);
  const modes = modeRows
    .map((r) => ({ name: READER_MODES[String(r[0])] ?? "", users: N(r[1]) }))
    .filter((m) => m.name !== "" && m.users > 0)
    .sort(byUsers);

  return {
    day,
    dau: last(dauSeries, 0),
    prevDau: last(dauSeries, 1),
    mau: N(mauRows[0]?.[0]),
    newInstalls: last(installSeries, 0),
    prevNewInstalls: last(installSeries, 1),
    features,
    modes,
    dauSeries,
    installSeries,
  };
}
