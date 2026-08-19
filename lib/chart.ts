import { jakartaDateKey } from "./storage";
import { DayPoint, Snapshot } from "./types";

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

// Метка дня YYYY-MM-DD → dd.mm
function ddmm(dateKey: string): string {
  const [, m, d] = dateKey.split("-");
  return `${d}.${m}`;
}

// Значения серии, выровненные по общему списку дат (нет точки → null для разрыва линии).
function align(dates: string[], series: DayPoint[]): (number | null)[] {
  const by = new Map(series.map((p) => [p.date, p.value]));
  return dates.map((d) => (by.has(d) ? (by.get(d) as number) : null));
}

// Рисовать линию по одной точке бессмысленно, поэтому графика может не быть —
// причина возвращается текстом, чтобы «график молча пропал» было видно в ответе роута.
export function chartSkipReason(views: DayPoint[], clicks: DayPoint[]): string | null {
  if (views.length >= 2 || clicks.length >= 2) return null;
  return `мало данных (дней с просмотрами: ${views.length}, с заходами: ${clicks.length})`;
}

// Конфиг Chart.js для QuickChart: линии просмотров и заходов на своих шкалах.
// Ряд без единой точки НЕ рисуем: пустая линия в легенде и её шкала с делениями
// 0–1 читаются как потерянные данные, хотя данных просто ещё нет (первые дни
// аккаунта: прирост просмотров считается между двумя замерами).
export function buildTrendChart(
  views: DayPoint[],
  clicks: DayPoint[],
  title = "Динамика за 14 дней"
): Record<string, unknown> {
  const dates = Array.from(new Set([...views, ...clicks].map((p) => p.date))).sort();

  const series = [
    { points: views, label: "Просмотры за день", axisTitle: "Просмотры/день", color: "#2563eb" },
    { points: clicks, label: "Заходы за день", axisTitle: "Заходы/день", color: "#f59e0b" },
  ].filter((s) => s.points.length > 0);

  // Одна линия — она же и есть главная шкала слева; две — просмотры слева, заходы справа.
  const axisIds = series.length === 2 ? ["y", "y1"] : ["y"];

  const scales: Record<string, unknown> = {};
  series.forEach((s, i) => {
    const right = axisIds[i] === "y1";
    scales[axisIds[i]] = {
      type: "linear",
      position: right ? "right" : "left",
      beginAtZero: true,
      ...(right ? { grid: { drawOnChartArea: false } } : {}),
      title: { display: true, text: s.axisTitle },
    };
  });

  return {
    type: "line",
    data: {
      labels: dates.map(ddmm),
      datasets: series.map((s, i) => ({
        label: s.label,
        data: align(dates, s.points),
        yAxisID: axisIds[i],
        borderColor: s.color,
        backgroundColor: s.color,
        tension: 0.3,
        spanGaps: true,
      })),
    },
    options: {
      plugins: {
        title: { display: true, text: title },
        legend: { position: "top" },
      },
      scales,
    },
  };
}

// Рендер конфига Chart.js в PNG через QuickChart. Возвращает байты картинки.
export async function renderChartPng(config: Record<string, unknown>): Promise<Buffer> {
  const res = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chart: config,
      // Конфиг в синтаксисе Chart.js v3/v4 (шкалы с ключами y/y1). QuickChart по
      // умолчанию рендерит v2.9.4 и отвергает такой конфиг (HTTP 400) — явно просим v4.
      version: "4",
      width: 900,
      height: 500,
      backgroundColor: "white",
      format: "png",
      devicePixelRatio: 2,
    }),
  });
  if (!res.ok) throw new Error(`QuickChart failed (${res.status}): ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}
