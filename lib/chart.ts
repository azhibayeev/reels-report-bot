import { jakartaDateKey, sprintDateKey } from "./storage";
import { DayPoint, FunnelSeries, Snapshot } from "./types";

function totalViews(s: Snapshot): number {
  return s.reels.reduce((sum, r) => sum + r.views, 0);
}

// Дневной прирост тотал-просмотров между соседними снапшотами.
// Вход — снапшоты по возрастанию takenAt; date = день Джакарты второго снапшота пары.
export function computeDailyViewGains(snaps: Snapshot[]): DayPoint[] {
  const out: DayPoint[] = [];
  for (let i = 1; i < snaps.length; i++) {
    out.push({
      date: jakartaDateKey(new Date(snaps[i].takenAt)),
      value: totalViews(snaps[i]) - totalViews(snaps[i - 1]),
    });
  }
  return out;
}

/**
 * Вход воронки: сколько роликов вышло за каждые сутки — по датам публикации, а не по
 * разнице соседних снапшотов (пропущенный день замера слепил бы два дня публикаций
 * в один столбик).
 *
 * Ролики собираются по ВСЕМ снапшотам окна и склеиваются по id. Один свежий снапшот
 * тут не годится: он показывает только то, что висит на аккаунте сейчас, и удалённый
 * (или снятый Instagram за музыку) ролик задним числом укоротил бы столбик того дня,
 * когда он вышел, — вчерашняя картинка перестала бы сходиться с сегодняшней.
 */
export function computeDailyPublished(snaps: Snapshot[]): DayPoint[] {
  const publishedAt = new Map<string, string>();
  for (const s of snaps) {
    for (const r of s.reels) if (!publishedAt.has(r.id)) publishedAt.set(r.id, r.publishedAt);
  }

  const by = new Map<string, number>();
  for (const iso of publishedAt.values()) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) continue;
    const day = sprintDateKey(new Date(ms));
    by.set(day, (by.get(day) ?? 0) + 1);
  }
  return [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, value]) => ({ date, value }));
}

// Метка дня YYYY-MM-DD → dd.mm
function ddmm(dateKey: string): string {
  const [, m, d] = dateKey.split("-");
  return `${d}.${m}`;
}

// Значения серии, выровненные по оси дней (нет точки → null для разрыва линии).
function align(days: string[], series: DayPoint[]): (number | null)[] {
  const by = new Map(series.map((p) => [p.date, p.value]));
  return days.map((d) => (by.has(d) ? (by.get(d) as number) : null));
}

/**
 * Куски конфига, которые обязаны быть функциями: Chart.js умеет условную подпись только
 * так, а конфиг уезжает JSON-ом, где функций нет. QuickChart принимает конфиг строкой с
 * JS — поэтому здесь стоят метки, а renderChartPng подменяет их на функции в теле запроса.
 *
 * HIDE_ZERO — не подписывать нулевые значения: до запуска воронки линия переходов в стор
 * иначе превращается в дорожку из нулей, которая перебивает собой всё остальное.
 *
 * HIDE_LOWEST_TICK — не подписывать нижнее деление у всех этажей, кроме нижнего. Этажи
 * стоят вплотную и делят одну колонку подписей, поэтому «0» верхнего этажа печатается
 * ровно поверх верхнего деления соседнего снизу, и оба числа становятся нечитаемыми.
 * Ноль и так виден по линии стыка, а вот максимум соседа — единственный масштаб этажа.
 */
const HIDE_ZERO = "__hide_zero__";
const HIDE_LOWEST_TICK = "__hide_lowest_tick__";
const JS_BY_MARKER: Record<string, string> = {
  [HIDE_ZERO]: "(v)=>(v===0?'':v)",
  [HIDE_LOWEST_TICK]: "(v,i)=>(i===0?'':v.toLocaleString('en-US'))",
};

const VIOLET = "#7c3aed";
const BLUE = "#2563eb";
const AMBER = "#f59e0b";
const GREEN = "#16a34a";
const GRID = "#eef0f4";

interface SeriesSpec {
  points: DayPoint[];
  label: string;
  color: string;
  bar?: boolean;
  /** Подписывать значения на графике: у семизначных просмотров это только мусор. */
  labelValues?: boolean;
}

interface Level {
  /** Ключ шкалы Chart.js. */
  id: string;
  axisTitle: string;
  /** Доля высоты картинки под этот этаж. */
  weight: number;
  series: SeriesSpec[];
}

// Этажи сверху вниз — в том же порядке, в каком их называют: вход → середина → выход.
function levelsOf(s: FunnelSeries): Level[] {
  return [
    {
      id: "yIn",
      axisTitle: "Ролики/день",
      weight: 1,
      series: [{ points: s.published, label: "Ролики за день", color: VIOLET, bar: true, labelValues: true }],
    },
    {
      id: "yMid",
      axisTitle: "Просмотры/день",
      weight: 1.8,
      series: [{ points: s.views, label: "Просмотры за день", color: BLUE }],
    },
    {
      id: "yOut",
      axisTitle: "Выход/день",
      weight: 1.6,
      series: [
        { points: s.joins, label: "Заходы в сообщество", color: AMBER, labelValues: true },
        { points: s.store, label: "Переходы в стор", color: GREEN, labelValues: true },
      ],
    },
  ]
    // Ряд без единой точки НЕ рисуем: пустая линия в легенде и её шкала с делениями
    // 0–1 читаются как потерянные данные, хотя данных просто ещё нет.
    .map((l) => ({ ...l, series: l.series.filter((x) => x.points.length > 0) }))
    .filter((l) => l.series.length > 0);
}

// Рисовать по одной точке бессмысленно, поэтому графика может не быть —
// причина возвращается текстом, чтобы «график молча пропал» было видно в ответе роута.
export function chartSkipReason(s: FunnelSeries): string | null {
  const counts = [s.published, s.views, s.joins, s.store];
  if (counts.some((c) => c.length >= 2)) return null;
  return (
    `мало данных (дней с роликами: ${s.published.length}, с просмотрами: ${s.views.length}, ` +
    `с заходами: ${s.joins.length}, с переходами в стор: ${s.store.length})`
  );
}

/**
 * Конфиг Chart.js для QuickChart: три этажа воронки на общей оси дней.
 * Этажи — это stacked-шкалы Chart.js v4 (stack + stackWeight): у каждого уровня своя
 * вертикальная область и свой масштаб, иначе 5 роликов и миллион просмотров на одной
 * шкале превращаются в прямую по нулю. Шкалы объявляются СНИЗУ ВВЕРХ, поэтому
 * список этажей разворачивается.
 */
export function buildFunnelChart(
  days: string[],
  s: FunnelSeries,
  title = "Воронка за 14 дней"
): Record<string, unknown> {
  const levels = levelsOf(s);
  const stacked = levels.length > 1;

  const scales: Record<string, unknown> = {
    x: { grid: { color: GRID }, ticks: { font: { size: 11 } } },
  };
  // Снизу вверх: первый объявленный этаж — нижний, ему нижнюю подпись оставляем.
  const bottomUp = [...levels].reverse();
  bottomUp.forEach((l, i) => {
    scales[l.id] = {
      type: "linear",
      position: "left",
      beginAtZero: true,
      grace: "10%",
      ticks: {
        // Не count: он делит диапазон нацело и даёт «7,5 роликов за день». Ограничение
        // сверху оставляет Chart.js его же круглые деления, а precision добивает целые.
        // Шесть — компромисс: делений меньше, и шкала уезжает далеко вверх от данных
        // (просмотры до 3 млн там, где максимум 2,16 млн), а линия жмётся к низу этажа.
        maxTicksLimit: 6,
        precision: 0,
        font: { size: 11 },
        ...(i === 0 ? {} : { callback: HIDE_LOWEST_TICK }),
      },
      title: { display: true, text: l.axisTitle, font: { size: 12 } },
      grid: { color: GRID },
      ...(stacked ? { stack: "funnel", stackWeight: l.weight } : {}),
    };
  });

  const datasets = levels.flatMap((l) =>
    l.series.map((x) => ({
      type: x.bar ? "bar" : "line",
      label: x.label,
      data: align(days, x.points),
      yAxisID: l.id,
      borderColor: x.color,
      backgroundColor: x.color,
      ...(x.bar
        ? { categoryPercentage: 0.62, barPercentage: 0.9 }
        : { tension: 0.3, spanGaps: true, borderWidth: 3, pointRadius: 3 }),
      // Подписи значений — только там, где числа короткие. У просмотров они
      // семизначные и превращают линию в кашу, поэтому их подписывает только шкала.
      // display:"auto" сам прячет подпись, если она налезает на соседнюю.
      datalabels: x.labelValues
        ? {
            display: "auto",
            anchor: "end",
            align: "top",
            offset: 2,
            color: x.color,
            font: { size: 11, weight: "bold" },
            formatter: HIDE_ZERO,
          }
        : { display: false },
    }))
  );

  return {
    // Тип графика — bar: на смешанном графике столбики входа должны стоять
    // по центрам категорий, как и точки линий.
    type: "bar",
    data: { labels: days.map(ddmm), datasets },
    options: {
      plugins: {
        title: { display: true, text: title, font: { size: 18 } },
        subtitle: {
          display: true,
          text: "Вход → ролики · Середина → просмотры · Выход → сообщество и установки",
          color: "#6b7280",
          font: { size: 12 },
          padding: { bottom: 10 },
        },
        legend: { position: "top", labels: { boxWidth: 14, font: { size: 12 } } },
        // Подписи включаются каждому ряду отдельно (см. выше).
        datalabels: { display: false },
      },
      scales,
    },
  };
}

// Рендер конфига Chart.js в PNG через QuickChart. Возвращает байты картинки.
export async function renderChartPng(config: Record<string, unknown>, height = 620): Promise<Buffer> {
  // Конфиг уходит строкой, а не объектом: так QuickChart читает его как JS и понимает
  // подставленные вместо меток функции.
  let chart = JSON.stringify(config);
  for (const [marker, js] of Object.entries(JS_BY_MARKER)) chart = chart.replaceAll(`"${marker}"`, js);
  const res = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chart,
      // Конфиг в синтаксисе Chart.js v3/v4 (шкалы с своими ключами, stack/stackWeight).
      // QuickChart по умолчанию рендерит v2.9.4 и отвергает такой конфиг (HTTP 400) —
      // явно просим v4; этажи воронки живут только в нём.
      version: "4",
      width: 900,
      height,
      backgroundColor: "white",
      format: "png",
      devicePixelRatio: 2,
    }),
  });
  if (!res.ok) throw new Error(`QuickChart failed (${res.status}): ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}
