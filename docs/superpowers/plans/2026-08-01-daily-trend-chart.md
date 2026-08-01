# Daily Trend Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ежедневный Telegram-отчёт присылает картинку-график дневной динамики просмотров и кликов за 14 дней, чтобы визуально видеть направление тренда.

**Architecture:** Две чистые функции считают серии (дневной прирост просмотров из снапшотов Blob; дневные заходы из PostHog) и собирают конфиг Chart.js. Конфиг рендерится в PNG внешним сервисом QuickChart, PNG грузится в Telegram новым `sendPhoto`. Всё подключено в `/api/report` отдельным `try/catch`, который не роняет уже отправленный текстовый отчёт.

**Tech Stack:** TypeScript, Next.js 16 (App Router, route handler), Vercel Blob, PostHog Query API (HogQL), QuickChart REST, Telegram Bot API, vitest.

## Global Constraints

- Никаких новых npm-зависимостей — рендер через HTTP-сервис QuickChart, `fetch` встроенный.
- Метрика — **дневной прирост**, не накопленный тотал.
- Единственная тема доставки — «Daily» = дефолтная тема `sendMessage`/`sendPhoto` (env `TELEGRAM_THREAD_ID`); отдельный thread не передаём.
- Весь блок графика в `app/api/report/route.ts` — в изолированном `try/catch`; любая ошибка логируется и не прерывает отчёт.
- PostHog-квирк: в `WHERE` только `event` + `timestamp`; никаких `properties.*` в `WHERE` (иначе `results:null`). `toDate`/`uniq` — не property-фильтры, безопасны.
- Язык подписей на графике и в коде-комментариях — русский, в стиле существующих модулей.
- Тесты: `npm run test` (vitest), файлы `tests/*.test.ts`.

---

### Task 1: Тип `DayPoint` и расчёт дневного прироста просмотров

**Files:**
- Modify: `lib/types.ts` (добавить интерфейс `DayPoint`)
- Create: `lib/chart.ts` (функция `computeDailyViewGains`)
- Test: `tests/chart.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `ReelSnapshot` из `lib/types.ts`; `jakartaDateKey` из `lib/storage.ts`.
- Produces:
  - `interface DayPoint { date: string; value: number }` — `date` в формате `YYYY-MM-DD` (ключ дня Джакарты).
  - `computeDailyViewGains(snaps: Snapshot[]): DayPoint[]` — на вход снапшоты по возрастанию `takenAt`; на выход прирост тотал-просмотров между соседними снапшотами (`date` = день Джакарты второго снапшота в паре). Меньше 2 снапшотов → `[]`.

- [ ] **Step 1: Добавить тип `DayPoint` в `lib/types.ts`**

В конец файла:

```ts
/** Одна точка суточного ряда для графика динамики */
export interface DayPoint {
  /** Ключ дня в формате YYYY-MM-DD */
  date: string;
  /** Значение за этот день (прирост просмотров или заходы) */
  value: number;
}
```

- [ ] **Step 2: Написать падающий тест `tests/chart.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { computeDailyViewGains } from "../lib/chart";
import { Snapshot } from "../lib/types";

function snap(takenAt: string, ...views: number[]): Snapshot {
  return {
    takenAt,
    reels: views.map((v, i) => ({
      id: `r${i}`,
      permalink: `https://www.instagram.com/reel/r${i}/`,
      publishedAt: "2026-07-01T00:00:00Z",
      caption: "",
      views: v,
    })),
  };
}

describe("computeDailyViewGains", () => {
  it("returns daily total-view gains between consecutive snapshots", () => {
    const snaps: Snapshot[] = [
      snap("2026-07-19T05:30:00Z", 100), // total 100
      snap("2026-07-20T05:30:00Z", 180), // total 180 → gain 80
      snap("2026-07-21T05:30:00Z", 200, 50), // total 250 → gain 70
    ];
    expect(computeDailyViewGains(snaps)).toEqual([
      { date: "2026-07-20", value: 80 },
      { date: "2026-07-21", value: 70 },
    ]);
  });

  it("returns [] when fewer than 2 snapshots", () => {
    expect(computeDailyViewGains([])).toEqual([]);
    expect(computeDailyViewGains([snap("2026-07-20T05:30:00Z", 100)])).toEqual([]);
  });
});
```

- [ ] **Step 3: Запустить тест — убедиться, что падает**

Run: `npm run test -- tests/chart.test.ts`
Expected: FAIL (`computeDailyViewGains` не экспортирован из `lib/chart.ts`).

- [ ] **Step 4: Реализовать `computeDailyViewGains` в `lib/chart.ts`**

```ts
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
```

- [ ] **Step 5: Запустить тест — убедиться, что проходит**

Run: `npm run test -- tests/chart.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/chart.ts tests/chart.test.ts
git commit -m "feat: DayPoint type and daily view-gain series for trend chart"
```

---

### Task 2: Конфиг графика Chart.js (`buildTrendChart`)

**Files:**
- Modify: `lib/chart.ts` (добавить `buildTrendChart`)
- Test: `tests/chart.test.ts` (добавить describe-блок)

**Interfaces:**
- Consumes: `DayPoint` из `lib/types.ts`.
- Produces: `buildTrendChart(views: DayPoint[], clicks: DayPoint[]): Record<string, unknown>` — конфиг Chart.js: `type:"line"`, объединённые по всем датам метки `dd.mm`, два датасета (просмотры → `yAxisID:"y"` левая ось; заходы → `yAxisID:"y1"` правая ось). Отсутствующие в серии даты → `null` в data (разрывы линии).

- [ ] **Step 1: Написать падающий тест (добавить в `tests/chart.test.ts`)**

```ts
import { buildTrendChart } from "../lib/chart";

describe("buildTrendChart", () => {
  it("builds a line chart with united date labels and two axes", () => {
    const cfg = buildTrendChart(
      [{ date: "2026-07-20", value: 100 }],
      [{ date: "2026-07-21", value: 5 }]
    ) as any;

    expect(cfg.type).toBe("line");
    expect(cfg.data.labels).toEqual(["20.07", "21.07"]);
    expect(cfg.data.datasets).toHaveLength(2);
    // просмотры на левой оси, заходы на правой
    expect(cfg.data.datasets[0].yAxisID).toBe("y");
    expect(cfg.data.datasets[1].yAxisID).toBe("y1");
    // выравнивание по объединённым датам, пропуски = null
    expect(cfg.data.datasets[0].data).toEqual([100, null]);
    expect(cfg.data.datasets[1].data).toEqual([null, 5]);
    expect(cfg.options.scales.y.position).toBe("left");
    expect(cfg.options.scales.y1.position).toBe("right");
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npm run test -- tests/chart.test.ts`
Expected: FAIL (`buildTrendChart` не экспортирован).

- [ ] **Step 3: Реализовать `buildTrendChart` в `lib/chart.ts`**

```ts
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

// Конфиг Chart.js для QuickChart: две линии (просмотры/заходы) на двух шкалах.
export function buildTrendChart(views: DayPoint[], clicks: DayPoint[]): Record<string, unknown> {
  const dates = Array.from(new Set([...views, ...clicks].map((p) => p.date))).sort();
  return {
    type: "line",
    data: {
      labels: dates.map(ddmm),
      datasets: [
        {
          label: "Просмотры за день",
          data: align(dates, views),
          yAxisID: "y",
          borderColor: "#2563eb",
          backgroundColor: "#2563eb",
          tension: 0.3,
          spanGaps: true,
        },
        {
          label: "Заходы за день",
          data: align(dates, clicks),
          yAxisID: "y1",
          borderColor: "#f59e0b",
          backgroundColor: "#f59e0b",
          tension: 0.3,
          spanGaps: true,
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: "Динамика за 14 дней" },
        legend: { position: "top" },
      },
      scales: {
        y: { type: "linear", position: "left", beginAtZero: true, title: { display: true, text: "Просмотры/день" } },
        y1: {
          type: "linear",
          position: "right",
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          title: { display: true, text: "Заходы/день" },
        },
      },
    },
  };
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npm run test -- tests/chart.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/chart.ts tests/chart.test.ts
git commit -m "feat: buildTrendChart Chart.js config with dual axes"
```

---

### Task 3: Дневные заходы из PostHog (`getDailyClicks`)

**Files:**
- Modify: `lib/posthog.ts` (добавить `getDailyClicks`)
- Test: `tests/posthog.test.ts`

**Interfaces:**
- Consumes: `DayPoint` из `lib/types.ts`; внутренний `phQuery` (уже есть в модуле).
- Produces: `getDailyClicks(sinceEpoch: number): Promise<DayPoint[]>` — уникальные люди с событием `$pageview` по календарным дням начиная с `sinceEpoch`; `date` в формате `YYYY-MM-DD`, по возрастанию.

- [ ] **Step 1: Написать падающий тест `tests/posthog.test.ts` (мок `fetch`)**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDailyClicks } from "../lib/posthog";

describe("getDailyClicks", () => {
  beforeEach(() => {
    process.env.POSTHOG_PERSONAL_API_KEY = "phx_test";
    process.env.POSTHOG_PROJECT_ID = "501630";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("maps daily rows and keeps WHERE free of property filters", async () => {
    let sentBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: any) => {
        sentBody = init.body as string;
        return {
          ok: true,
          json: async () => ({
            results: [
              ["2026-07-30", 5],
              ["2026-07-31", 8],
            ],
          }),
        } as any;
      })
    );

    const res = await getDailyClicks(1_753_800_000);

    expect(res).toEqual([
      { date: "2026-07-30", value: 5 },
      { date: "2026-07-31", value: 8 },
    ]);
    const query = JSON.parse(sentBody).query.query as string;
    expect(query).toContain("event = '$pageview'");
    expect(query).toContain("toDate(timestamp)");
    expect(query).toContain("uniq(person_id)");
    // квирк: никаких property-фильтров в WHERE
    expect(query).not.toContain("properties.");
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npm run test -- tests/posthog.test.ts`
Expected: FAIL (`getDailyClicks` не экспортирован).

- [ ] **Step 3: Реализовать `getDailyClicks` в `lib/posthog.ts`**

Добавить импорт типа в начало файла (рядом с существующими):

```ts
import { DayPoint } from "./types";
```

В конец файла:

```ts
// Заходы (уник. люди с $pageview) по календарным дням начиная с sinceEpoch.
// WHERE держим на event+timestamp (property-фильтры в WHERE ломают PostHog).
export async function getDailyClicks(sinceEpoch: number): Promise<DayPoint[]> {
  const rows = await phQuery(
    `SELECT toDate(timestamp) AS d, uniq(person_id) AS u FROM events ` +
      `WHERE event = '$pageview' AND timestamp >= toDateTime(${Math.floor(sinceEpoch)}) ` +
      `GROUP BY d ORDER BY d`
  );
  return rows.map((row) => ({ date: String(row[0]), value: N(row[1]) }));
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npm run test -- tests/posthog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/posthog.ts tests/posthog.test.ts
git commit -m "feat: getDailyClicks daily unique-visitor series from PostHog"
```

---

### Task 4: Рендер PNG (`renderChartPng`), чтение серии снапшотов (`loadRecentSnapshots`), отправка фото (`sendPhoto`)

Тонкие сетевые обёртки — проверяются typecheck/build; ручная проверка идёт в Task 5.

**Files:**
- Modify: `lib/chart.ts` (добавить `renderChartPng`)
- Modify: `lib/storage.ts` (добавить `loadRecentSnapshots`)
- Modify: `lib/telegram.ts` (добавить `sendPhoto`)

**Interfaces:**
- Produces:
  - `renderChartPng(config: Record<string, unknown>): Promise<Buffer>` — POST конфига в QuickChart, возвращает PNG-байты.
  - `loadRecentSnapshots(limit: number): Promise<Snapshot[]>` — последние `limit` снапшотов по возрастанию даты.
  - `sendPhoto(png: Buffer, caption?: string, opts?: SendOptions): Promise<void>` — multipart-загрузка фото в Telegram.
- Consumes: `Snapshot` (storage), `SendOptions`+`chatId`+`threadId` (telegram, уже в модуле).

- [ ] **Step 1: Добавить `renderChartPng` в `lib/chart.ts`**

```ts
// Рендер конфига Chart.js в PNG через QuickChart. Возвращает байты картинки.
export async function renderChartPng(config: Record<string, unknown>): Promise<Buffer> {
  const res = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chart: config,
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
```

- [ ] **Step 2: Добавить `loadRecentSnapshots` в `lib/storage.ts`**

Использует уже импортированные `list`, `Snapshot`, константу `SNAP_PREFIX`:

```ts
// Последние `limit` снапшотов по возрастанию даты (для рядов динамики).
export async function loadRecentSnapshots(limit: number): Promise<Snapshot[]> {
  const { blobs } = await list({ prefix: SNAP_PREFIX });
  const recent = blobs
    .sort((a, b) => (a.pathname < b.pathname ? -1 : 1)) // по возрастанию даты в имени
    .slice(-limit);
  const snaps: Snapshot[] = [];
  for (const b of recent) {
    const res = await fetch(`${b.url}?ts=${Date.now()}`, { cache: "no-store" });
    if (res.ok) snaps.push((await res.json()) as Snapshot);
  }
  return snaps;
}
```

- [ ] **Step 3: Добавить `sendPhoto` в `lib/telegram.ts`**

По образцу `sendDocument` (multipart), в конец файла:

```ts
export async function sendPhoto(png: Buffer, caption?: string, opts?: SendOptions): Promise<void> {
  const form = new FormData();
  form.append("chat_id", chatId());
  const thread = opts && "thread" in opts ? opts.thread : threadId() ? Number(threadId()) : null;
  if (thread) form.append("message_thread_id", String(thread));
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  form.append("photo", new Blob([png], { type: "image/png" }), "chart.png");
  const res = await fetch(api("sendPhoto"), { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Telegram sendPhoto failed (${res.status}): ${await res.text()}`);
  }
}
```

- [ ] **Step 4: Проверить сборку и типы**

Run: `npx tsc --noEmit -p tsconfig.json && npm run test`
Expected: без ошибок типов; существующие тесты и `tests/chart.test.ts`, `tests/posthog.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/chart.ts lib/storage.ts lib/telegram.ts
git commit -m "feat: renderChartPng (QuickChart), loadRecentSnapshots, telegram sendPhoto"
```

---

### Task 5: Подключение в ежедневный отчёт + ручная проверка на проде

**Files:**
- Modify: `app/api/report/route.ts` (импорты + блок графика после кликов)

**Interfaces:**
- Consumes: `computeDailyViewGains`, `buildTrendChart`, `renderChartPng` из `lib/chart.ts`; `loadRecentSnapshots` из `lib/storage.ts`; `getDailyClicks` из `lib/posthog.ts`; `sendPhoto` из `lib/telegram.ts`.

- [ ] **Step 1: Добавить импорты в `app/api/report/route.ts`**

Расширить существующие импорты:

```ts
import { buildTrendChart, computeDailyViewGains, renderChartPng } from "../../../lib/chart";
import { getDailyClicks } from "../../../lib/posthog"; // добавить к уже импортируемым getClicksStats, lastSprintStart
import { loadRecentSnapshots } from "../../../lib/storage"; // добавить к существующим импортам storage
import { sendMessage, sendPhoto } from "../../../lib/telegram"; // добавить sendPhoto
```

(Слить с уже существующими строками импортов этих модулей — не дублировать `import` из одного файла дважды.)

- [ ] **Step 2: Вставить блок графика после блока кликов**

Сразу после закрывающего `}` catch-блока кликов (перед `return NextResponse.json({ ok: true, ... })`):

```ts
    // График динамики (просмотры/день + заходы/день) за 14 дней → тема Daily.
    // Изолирован: любая ошибка (QuickChart/PostHog/мало данных) не роняет отчёт.
    try {
      const snaps = await loadRecentSnapshots(15); // 15 снапшотов → до 14 приростов
      const viewsSeries = computeDailyViewGains(snaps).slice(-14);
      const clicksSince = Math.floor((now.getTime() - 14 * 86_400_000) / 1000);
      const clicksSeries = await getDailyClicks(clicksSince);
      if (viewsSeries.length >= 2 || clicksSeries.length >= 2) {
        const png = await renderChartPng(buildTrendChart(viewsSeries, clicksSeries));
        await sendPhoto(png, "📈 Динамика за 14 дней");
      }
    } catch (e) {
      console.error("trend chart failed:", e);
    }
```

- [ ] **Step 3: Проверить сборку и типы**

Run: `npx tsc --noEmit -p tsconfig.json && npm run test`
Expected: без ошибок; все тесты PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/report/route.ts
git commit -m "feat: attach 14-day trend chart to daily report (Daily topic)"
```

- [ ] **Step 5: Задеплоить и проверить на проде вручную**

Запушить (триггерит деплой Vercel), дождаться готовности прод-деплоя, затем прогнать отчёт форс-режимом (секрет — в `.superpowers/cron-secret.txt`, 64 hex, НЕ менять):

```bash
git push
# после деплоя:
curl -s -H "Authorization: Bearer $(cat .superpowers/cron-secret.txt)" \
  "https://qurany-eight.vercel.app/api/report?force=1" | head -c 400
```

Expected: JSON `{"ok":true,...}`, и в Telegram-теме **Daily** после текстового отчёта и сводки кликов появляется **фото-график** с двумя линиями (просмотры/заходы) за ~14 дней. Если фото не пришло — смотреть логи Vercel по строке `trend chart failed:`.

- [ ] **Step 6: Финальный commit (если правки после проверки)**

```bash
git add -A && git commit -m "chore: trend chart verified on prod"
```

---

## Self-Review

**Spec coverage:**
- Дневной прирост просмотров → Task 1 (`computeDailyViewGains`). ✓
- Дневные заходы из PostHog (квирк WHERE) → Task 3 (`getDailyClicks`, тест проверяет отсутствие `properties.` в WHERE). ✓
- Один график, 2 линии, 2 шкалы, метки dd.mm → Task 2 (`buildTrendChart`). ✓
- 14 дней → Task 5 (`slice(-14)`, `clicksSince = now − 14д`). ✓
- Рендер через QuickChart → PNG → Task 4 (`renderChartPng`). ✓
- Загрузка фото в Telegram → Task 4 (`sendPhoto`). ✓
- Доставка в Daily (дефолтный thread, без override) → Task 5 (`sendPhoto(png, caption)` без opts). ✓
- Изолированный try/catch, «мало данных» пропускается → Task 5 (`try/catch` + `length >= 2`). ✓
- Никаких новых зависимостей → выполнено (только `fetch`). ✓
- Проверка force-run на проде → Task 5 Step 5. ✓

**Placeholder scan:** плейсхолдеров/TODO нет; весь код приведён явно.

**Type consistency:** `DayPoint {date,value}` определён в Task 1 и одинаково используется в Tasks 2/3/5. Имена функций (`computeDailyViewGains`, `buildTrendChart`, `getDailyClicks`, `renderChartPng`, `loadRecentSnapshots`, `sendPhoto`) совпадают между блоками Produces/Consumes и вызовами в Task 5. `N` и `phQuery` — существующие в `lib/posthog.ts`. `SNAP_PREFIX`, `list`, `Snapshot` — существующие в `lib/storage.ts`. `chatId`, `threadId`, `SendOptions`, `api` — существующие в `lib/telegram.ts`.
