# Instagram Reels Daily Telegram Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Vercel-hosted cron job that every day at 12:30 Jakarta time (05:30 UTC) collects view counts for all Instagram Reels, computes 24h gains vs. yesterday's snapshot, and sends a Russian-language report (summary + top-10 + new reels + full CSV) to a Telegram group chat.

**Architecture:** Next.js App Router project, API-only (one route handler `app/api/report/route.ts`), triggered by Vercel Cron. Daily snapshots and the auto-refreshed Instagram token live in Vercel Blob. Pure logic (diff, formatting) is isolated in `lib/` and unit-tested with Vitest; IO wrappers (Instagram, Telegram, Blob) are thin and verified by build + manual run.

**Tech Stack:** TypeScript, Next.js 16 (App Router), @vercel/blob, Vitest, Instagram Graph API ("Instagram API with Instagram Login", host `graph.instagram.com`), Telegram Bot API.

## Global Constraints

- Report language: **Russian**. All user-visible strings in messages/CSV are Russian.
- Cron schedule: `30 5 * * *` (UTC) = 12:30 Asia/Jakarta (WIB, UTC+7, no DST).
- All dates shown to the user are formatted in the `Asia/Jakarta` timezone.
- Env var names (exactly): `IG_ACCESS_TOKEN`, `IG_USER_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN` (auto-set by Vercel Blob).
- Endpoint auth: `/api/report` requires header `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sends it automatically when `CRON_SECRET` is set).
- Insights metric for reel views: `views`.
- No database. Snapshots are JSON files in Vercel Blob under `snapshots/YYYY-MM-DD.json` (date key in Jakarta time). Token state is AES-256-GCM-encrypted at `state/token.enc` (key derived from `CRON_SECRET`).
- Message limit: list at most 20 new reels in the message ("… и ещё N" for the rest); top list is max 10. Full data always goes in the CSV.
- Imports between local modules use relative paths (no path aliases).

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `vercel.json`, `app/layout.tsx`, `app/page.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: a building Next.js project; `npm test` runs Vitest; `vercel.json` cron entry `GET /api/report` at `30 5 * * *`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "reels-report-bot",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "test": "vitest run"
  },
  "dependencies": {
    "@vercel/blob": "^2.0.0",
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/react": "^19.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "types": ["node"],
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
.next/
.env*
.vercel
*.tsbuildinfo
next-env.d.ts
```

- [ ] **Step 5: Create `vercel.json`**

```json
{
  "crons": [
    {
      "path": "/api/report",
      "schedule": "30 5 * * *"
    }
  ]
}
```

- [ ] **Step 6: Create minimal `app/layout.tsx` and `app/page.tsx`**

`app/layout.tsx`:

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
```

`app/page.tsx`:

```tsx
export default function Home() {
  return <main>Reels report bot. Отчёты уходят в Telegram по расписанию.</main>;
}
```

- [ ] **Step 7: Install and verify build**

Run: `npm install && npm run build`
Expected: build completes without errors ("Compiled successfully").

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js project with Vercel cron config"
```

---

### Task 2: Types and gain-calculation logic (`lib/diff.ts`)

**Files:**
- Create: `lib/types.ts`, `lib/diff.ts`
- Test: `tests/diff.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 3, 4, 7):
  - `interface ReelSnapshot { id: string; permalink: string; publishedAt: string; caption: string; views: number }`
  - `interface Snapshot { takenAt: string; reels: ReelSnapshot[] }`
  - `interface ReelReport extends ReelSnapshot { gain: number; isNew: boolean }`
  - `interface Report { periodStart: string | null; periodEnd: string; isBaseline: boolean; totalViews: number; totalGain: number; newReels: ReelReport[]; top: ReelReport[]; all: ReelReport[] }`
  - `function computeReport(current: Snapshot, prev: Snapshot | null): Report`

- [ ] **Step 1: Create `lib/types.ts`**

```ts
export interface ReelSnapshot {
  id: string;
  permalink: string;
  /** ISO timestamp of publication (as returned by Instagram) */
  publishedAt: string;
  caption: string;
  views: number;
}

export interface Snapshot {
  /** ISO timestamp when the snapshot was taken */
  takenAt: string;
  reels: ReelSnapshot[];
}

export interface ReelReport extends ReelSnapshot {
  gain: number;
  isNew: boolean;
}

export interface Report {
  periodStart: string | null;
  periodEnd: string;
  isBaseline: boolean;
  totalViews: number;
  totalGain: number;
  newReels: ReelReport[];
  top: ReelReport[];
  all: ReelReport[];
}
```

- [ ] **Step 2: Write the failing tests — `tests/diff.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { computeReport } from "../lib/diff";
import { ReelSnapshot, Snapshot } from "../lib/types";

function reel(id: string, views: number, publishedAt: string): ReelSnapshot {
  return {
    id,
    views,
    publishedAt,
    permalink: `https://www.instagram.com/reel/${id}/`,
    caption: `Рилс ${id}`,
  };
}

const T0 = "2026-07-19T05:30:00Z"; // вчера 12:30 WIB
const T1 = "2026-07-20T05:30:00Z"; // сегодня 12:30 WIB

describe("computeReport", () => {
  it("computes per-reel gain and total gain vs previous snapshot", () => {
    const prev: Snapshot = { takenAt: T0, reels: [reel("a", 100, "2026-07-01T00:00:00Z"), reel("b", 50, "2026-07-02T00:00:00Z")] };
    const curr: Snapshot = { takenAt: T1, reels: [reel("a", 180, "2026-07-01T00:00:00Z"), reel("b", 55, "2026-07-02T00:00:00Z")] };
    const r = computeReport(curr, prev);
    expect(r.isBaseline).toBe(false);
    expect(r.all.find((x) => x.id === "a")?.gain).toBe(80);
    expect(r.all.find((x) => x.id === "b")?.gain).toBe(5);
    expect(r.totalGain).toBe(85);
    expect(r.totalViews).toBe(235);
    expect(r.periodStart).toBe(T0);
    expect(r.periodEnd).toBe(T1);
  });

  it("marks reels published inside the window and absent from prev as new; gain = all their views", () => {
    const prev: Snapshot = { takenAt: T0, reels: [reel("a", 100, "2026-07-01T00:00:00Z")] };
    const curr: Snapshot = {
      takenAt: T1,
      reels: [reel("a", 120, "2026-07-01T00:00:00Z"), reel("n", 900, "2026-07-19T10:00:00Z")],
    };
    const r = computeReport(curr, prev);
    const n = r.all.find((x) => x.id === "n")!;
    expect(n.isNew).toBe(true);
    expect(n.gain).toBe(900);
    expect(r.newReels.map((x) => x.id)).toEqual(["n"]);
    expect(r.totalGain).toBe(920);
  });

  it("does not mark an old reel missing from prev snapshot as new", () => {
    const prev: Snapshot = { takenAt: T0, reels: [] };
    const curr: Snapshot = { takenAt: T1, reels: [reel("old", 500, "2026-01-01T00:00:00Z")] };
    const r = computeReport(curr, prev);
    expect(r.all[0].isNew).toBe(false);
    expect(r.all[0].gain).toBe(500);
  });

  it("baseline mode when prev is null: zero gains, empty top, new reels by last-24h window", () => {
    const curr: Snapshot = {
      takenAt: T1,
      reels: [reel("a", 100, "2026-07-01T00:00:00Z"), reel("n", 10, "2026-07-19T10:00:00Z")],
    };
    const r = computeReport(curr, null);
    expect(r.isBaseline).toBe(true);
    expect(r.periodStart).toBeNull();
    expect(r.totalGain).toBe(0);
    expect(r.top).toEqual([]);
    expect(r.newReels.map((x) => x.id)).toEqual(["n"]);
  });

  it("top is sorted by gain descending and capped at 10", () => {
    const prev: Snapshot = {
      takenAt: T0,
      reels: Array.from({ length: 12 }, (_, i) => reel(`r${i}`, 0, "2026-07-01T00:00:00Z")),
    };
    const curr: Snapshot = {
      takenAt: T1,
      reels: Array.from({ length: 12 }, (_, i) => reel(`r${i}`, i * 10, "2026-07-01T00:00:00Z")),
    };
    const r = computeReport(curr, prev);
    expect(r.top).toHaveLength(10);
    expect(r.top[0].id).toBe("r11");
    expect(r.top[1].id).toBe("r10");
  });

  it("new reels are sorted newest first", () => {
    const prev: Snapshot = { takenAt: T0, reels: [] };
    const curr: Snapshot = {
      takenAt: T1,
      reels: [reel("older", 1, "2026-07-19T08:00:00Z"), reel("newer", 2, "2026-07-20T01:00:00Z")],
    };
    const r = computeReport(curr, prev);
    expect(r.newReels.map((x) => x.id)).toEqual(["newer", "older"]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/diff.test.ts`
Expected: FAIL — cannot resolve `../lib/diff`.

- [ ] **Step 4: Implement `lib/diff.ts`**

```ts
import { Report, ReelReport, Snapshot } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeReport(current: Snapshot, prev: Snapshot | null): Report {
  const prevViews = new Map<string, number>();
  for (const r of prev?.reels ?? []) prevViews.set(r.id, r.views);

  const endMs = Date.parse(current.takenAt);
  const startMs = prev ? Date.parse(prev.takenAt) : endMs - DAY_MS;

  const all: ReelReport[] = current.reels.map((r) => {
    const publishedMs = Date.parse(r.publishedAt);
    const isNew = !prevViews.has(r.id) && publishedMs >= startMs && publishedMs <= endMs;
    const gain = prev ? r.views - (prevViews.get(r.id) ?? 0) : 0;
    return { ...r, gain, isNew };
  });

  const newReels = all
    .filter((r) => r.isNew)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  const top = prev ? [...all].sort((a, b) => b.gain - a.gain).slice(0, 10) : [];

  return {
    periodStart: prev?.takenAt ?? null,
    periodEnd: current.takenAt,
    isBaseline: !prev,
    totalViews: all.reduce((s, r) => s + r.views, 0),
    totalGain: all.reduce((s, r) => s + r.gain, 0),
    newReels,
    top,
    all,
  };
}
```

Note the baseline nuance covered by tests: when `prev` is null, gains are 0 (nothing to diff against) but `newReels` still uses a synthetic last-24h window so the first report is useful.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/diff.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/diff.ts tests/diff.test.ts
git commit -m "feat: report diff logic (gains, new reels, top-10)"
```

---

### Task 3: Russian message and CSV formatting (`lib/format.ts`)

**Files:**
- Create: `lib/format.ts`
- Test: `tests/format.test.ts`

**Interfaces:**
- Consumes: `Report`, `ReelReport` from `lib/types.ts` (Task 2).
- Produces (used by Task 7):
  - `function formatMessage(r: Report): string` — Telegram HTML, Russian.
  - `function formatCsv(r: Report): string` — CSV with BOM, `;` delimiter, columns: Ссылка; Дата публикации; Просмотров всего; Прирост за период. Rows sorted by gain desc.
  - `function escapeHtml(s: string): string` — also used for the error message in Task 7.

- [ ] **Step 1: Write the failing tests — `tests/format.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { formatMessage, formatCsv, escapeHtml } from "../lib/format";
import { computeReport } from "../lib/diff";
import { ReelSnapshot, Snapshot } from "../lib/types";

function reel(id: string, views: number, publishedAt: string, caption = `Рилс ${id}`): ReelSnapshot {
  return { id, views, publishedAt, caption, permalink: `https://www.instagram.com/reel/${id}/` };
}

const T0 = "2026-07-19T05:30:00Z";
const T1 = "2026-07-20T05:30:00Z";

function sampleReport() {
  const prev: Snapshot = { takenAt: T0, reels: [reel("a", 100, "2026-07-01T00:00:00Z")] };
  const curr: Snapshot = {
    takenAt: T1,
    reels: [reel("a", 180, "2026-07-01T00:00:00Z"), reel("n", 900, "2026-07-19T10:00:00Z")],
  };
  return computeReport(curr, prev);
}

describe("formatMessage", () => {
  it("includes Russian header, totals, new reels and top with links", () => {
    const msg = formatMessage(sampleReport());
    expect(msg).toContain("Отчёт по рилсам");
    expect(msg).toContain("время Джакарты");
    expect(msg).toContain("Новых рилсов за период: <b>1</b>");
    expect(msg).toContain('href="https://www.instagram.com/reel/n/"');
    expect(msg).toContain("Топ-2 по приросту");
    // top sorted: new reel n (gain 900) before a (gain 80)
    expect(msg.indexOf("reel/n/")).toBeLessThan(msg.lastIndexOf("reel/a/"));
  });

  it("baseline report explains that gains start tomorrow and has no top section", () => {
    const curr: Snapshot = { takenAt: T1, reels: [reel("a", 100, "2026-07-01T00:00:00Z")] };
    const msg = formatMessage(computeReport(curr, null));
    expect(msg).toContain("базовый замер");
    expect(msg).not.toContain("Топ-");
  });

  it("caps the new-reels list at 20 with a remainder line", () => {
    const prev: Snapshot = { takenAt: T0, reels: [] };
    const curr: Snapshot = {
      takenAt: T1,
      reels: Array.from({ length: 25 }, (_, i) => reel(`n${i}`, i, "2026-07-19T10:00:00Z")),
    };
    const msg = formatMessage(computeReport(curr, prev));
    expect(msg).toContain("… и ещё 5");
  });

  it("escapes HTML in captions", () => {
    const prev: Snapshot = { takenAt: T0, reels: [] };
    const curr: Snapshot = { takenAt: T1, reels: [reel("x", 5, "2026-07-19T10:00:00Z", "<b>жирный & смелый</b>")] };
    const msg = formatMessage(computeReport(curr, prev));
    expect(msg).toContain("&lt;b&gt;жирный &amp; смелый&lt;/b&gt;");
  });
});

describe("formatCsv", () => {
  it("has BOM, Russian header and one row per reel, sorted by gain desc", () => {
    const csv = formatCsv(sampleReport());
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("Ссылка;Дата публикации;Просмотров всего;Прирост за период");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("reel/n/"); // gain 900 first
    expect(lines[2]).toContain("reel/a/");
  });

  it("quotes cells containing the delimiter", () => {
    expect(formatCsv(sampleReport())).not.toContain('""'); // sanity: no accidental quoting
  });
});

describe("escapeHtml", () => {
  it("escapes &, <, >", () => {
    expect(escapeHtml('a & <b> "q"')).toBe('a &amp; &lt;b&gt; "q"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/format.test.ts`
Expected: FAIL — cannot resolve `../lib/format`.

- [ ] **Step 3: Implement `lib/format.ts`**

```ts
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
  return `<a href="${r.permalink}">${escapeHtml(title)}</a>`;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/format.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/format.ts tests/format.test.ts
git commit -m "feat: Russian Telegram message and CSV formatting"
```

---

### Task 4: Blob storage — snapshots, token state, Jakarta date key (`lib/storage.ts`)

**Files:**
- Create: `lib/storage.ts`
- Test: `tests/storage.test.ts` (pure `jakartaDateKey` only; Blob IO is verified in the manual integration run)

**Interfaces:**
- Consumes: `Snapshot` from `lib/types.ts`.
- Produces (used by Task 7):
  - `function jakartaDateKey(d: Date): string` — `YYYY-MM-DD` in Asia/Jakarta.
  - `function saveSnapshot(key: string, snap: Snapshot): Promise<void>`
  - `function loadPreviousSnapshot(todayKey: string): Promise<Snapshot | null>` — latest snapshot with key < todayKey.
  - `interface TokenState { token: string; refreshedAt: string }`
  - `function saveTokenState(state: TokenState): Promise<void>` / `function loadTokenState(): Promise<TokenState | null>` — AES-256-GCM encrypted with key `sha256(CRON_SECRET)`.

- [ ] **Step 1: Write the failing test — `tests/storage.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { jakartaDateKey } from "../lib/storage";

describe("jakartaDateKey", () => {
  it("formats a UTC instant as a date in Asia/Jakarta (UTC+7)", () => {
    // 2026-07-20 05:30 UTC = 12:30 WIB same day
    expect(jakartaDateKey(new Date("2026-07-20T05:30:00Z"))).toBe("2026-07-20");
    // 2026-07-20 20:00 UTC = 03:00 WIB next day
    expect(jakartaDateKey(new Date("2026-07-20T20:00:00Z"))).toBe("2026-07-21");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage.test.ts`
Expected: FAIL — cannot resolve `../lib/storage`.

- [ ] **Step 3: Implement `lib/storage.ts`**

```ts
import crypto from "node:crypto";
import { list, put } from "@vercel/blob";
import { Snapshot } from "./types";

const SNAP_PREFIX = "snapshots/";
const TOKEN_PATH = "state/token.enc";

const dateKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function jakartaDateKey(d: Date): string {
  return dateKeyFmt.format(d); // en-CA => YYYY-MM-DD
}

export async function saveSnapshot(key: string, snap: Snapshot): Promise<void> {
  await put(`${SNAP_PREFIX}${key}.json`, JSON.stringify(snap), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function loadPreviousSnapshot(todayKey: string): Promise<Snapshot | null> {
  const { blobs } = await list({ prefix: SNAP_PREFIX });
  const prev = blobs
    .filter((b) => b.pathname < `${SNAP_PREFIX}${todayKey}.json`)
    .sort((a, b) => (a.pathname < b.pathname ? 1 : -1))[0];
  if (!prev) return null;
  const res = await fetch(`${prev.url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as Snapshot;
}

export interface TokenState {
  token: string;
  refreshedAt: string;
}

// Токен хранится в Blob в зашифрованном виде: blob-URL публичный,
// а ключ шифрования выводится из CRON_SECRET, который есть только в env.
function encryptionKey(): Buffer {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set");
  return crypto.createHash("sha256").update(secret).digest();
}

export async function saveTokenState(state: TokenState): Promise<void> {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
  await put(TOKEN_PATH, payload, {
    access: "public",
    contentType: "text/plain",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function loadTokenState(): Promise<TokenState | null> {
  const { blobs } = await list({ prefix: TOKEN_PATH });
  const blob = blobs.find((b) => b.pathname === TOKEN_PATH);
  if (!blob) return null;
  const res = await fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  try {
    const buf = Buffer.from(await res.text(), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
    return JSON.parse(json) as TokenState;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass, plus typecheck via build**

Run: `npx vitest run tests/storage.test.ts && npm run build`
Expected: test PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add lib/storage.ts tests/storage.test.ts
git commit -m "feat: blob storage for snapshots and encrypted token state"
```

---

### Task 5: Instagram API client (`lib/instagram.ts`)

**Files:**
- Create: `lib/instagram.ts`

**Interfaces:**
- Consumes: nothing local.
- Produces (used by Task 7):
  - `interface IgMedia { id: string; permalink: string; timestamp: string; caption: string }`
  - `function fetchAllReels(token: string): Promise<IgMedia[]>` — all media of type REELS, paginated.
  - `function fetchViews(token: string, mediaIds: string[]): Promise<Map<string, number>>` — insights `views` per media, concurrency 10, missing/erroring insights → 0.
  - `function refreshLongLivedToken(token: string): Promise<string>`

- [ ] **Step 1: Implement `lib/instagram.ts`**

```ts
const G = "https://graph.instagram.com";

export interface IgMedia {
  id: string;
  permalink: string;
  timestamp: string;
  caption: string;
}

interface RawMedia {
  id: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  caption?: string;
}

export async function fetchAllReels(token: string): Promise<IgMedia[]> {
  const out: RawMedia[] = [];
  let url: string | null =
    `${G}/me/media?fields=id,media_product_type,permalink,timestamp,caption&limit=100&access_token=${encodeURIComponent(token)}`;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Instagram: не удалось получить список медиа (${res.status}): ${await res.text()}`);
    }
    const data: { data?: RawMedia[]; paging?: { next?: string } } = await res.json();
    out.push(...(data.data ?? []));
    url = data.paging?.next ?? null;
  }
  return out
    .filter((m) => m.media_product_type === "REELS")
    .map((m) => ({
      id: m.id,
      permalink: m.permalink ?? "",
      timestamp: m.timestamp ?? "",
      caption: m.caption ?? "",
    }));
}

const INSIGHTS_CONCURRENCY = 10;

export async function fetchViews(token: string, mediaIds: string[]): Promise<Map<string, number>> {
  const views = new Map<string, number>();
  let i = 0;
  async function worker(): Promise<void> {
    while (i < mediaIds.length) {
      const id = mediaIds[i++];
      try {
        const res = await fetch(
          `${G}/${id}/insights?metric=views&access_token=${encodeURIComponent(token)}`
        );
        if (!res.ok) {
          // Инсайты бывают недоступны для отдельных медиа — не роняем весь отчёт.
          console.error(`insights failed for ${id}: ${res.status} ${await res.text()}`);
          views.set(id, 0);
          continue;
        }
        const data: {
          data?: Array<{ total_value?: { value?: number }; values?: Array<{ value?: number }> }>;
        } = await res.json();
        const metric = data.data?.[0];
        views.set(id, metric?.total_value?.value ?? metric?.values?.[0]?.value ?? 0);
      } catch (e) {
        console.error(`insights error for ${id}:`, e);
        views.set(id, 0);
      }
    }
  }
  const workers = Array.from({ length: Math.min(INSIGHTS_CONCURRENCY, mediaIds.length) }, worker);
  await Promise.all(workers);
  return views;
}

export async function refreshLongLivedToken(token: string): Promise<string> {
  const res = await fetch(
    `${G}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`
  );
  if (!res.ok) {
    throw new Error(`Instagram: не удалось продлить токен (${res.status}): ${await res.text()}`);
  }
  const data: { access_token?: string } = await res.json();
  if (!data.access_token) throw new Error("Instagram: пустой ответ при продлении токена");
  return data.access_token;
}
```

- [ ] **Step 2: Typecheck via build and run full test suite (no regressions)**

Run: `npm run build && npm test`
Expected: build succeeds; all existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add lib/instagram.ts
git commit -m "feat: Instagram Graph API client (reels list, views insights, token refresh)"
```

---

### Task 6: Telegram client (`lib/telegram.ts`)

**Files:**
- Create: `lib/telegram.ts`

**Interfaces:**
- Consumes: env `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- Produces (used by Task 7):
  - `function sendMessage(html: string): Promise<void>` — parse_mode HTML, link previews off.
  - `function sendDocument(filename: string, content: string, caption?: string): Promise<void>`

- [ ] **Step 1: Implement `lib/telegram.ts`**

```ts
function api(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return `https://api.telegram.org/bot${token}/${method}`;
}

function chatId(): string {
  const id = process.env.TELEGRAM_CHAT_ID;
  if (!id) throw new Error("TELEGRAM_CHAT_ID is not set");
  return id;
}

export async function sendMessage(html: string): Promise<void> {
  const res = await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId(),
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }),
  });
  if (!res.ok) {
    throw new Error(`Telegram sendMessage failed (${res.status}): ${await res.text()}`);
  }
}

export async function sendDocument(filename: string, content: string, caption?: string): Promise<void> {
  const form = new FormData();
  form.append("chat_id", chatId());
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([content], { type: "text/csv" }), filename);
  const res = await fetch(api("sendDocument"), { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Telegram sendDocument failed (${res.status}): ${await res.text()}`);
  }
}
```

- [ ] **Step 2: Typecheck via build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/telegram.ts
git commit -m "feat: Telegram client (sendMessage, sendDocument)"
```

---

### Task 7: Orchestration route (`app/api/report/route.ts`)

**Files:**
- Create: `app/api/report/route.ts`

**Interfaces:**
- Consumes: everything above —
  `computeReport` (lib/diff), `formatMessage`/`formatCsv`/`escapeHtml` (lib/format),
  `jakartaDateKey`/`saveSnapshot`/`loadPreviousSnapshot`/`loadTokenState`/`saveTokenState` (lib/storage),
  `fetchAllReels`/`fetchViews`/`refreshLongLivedToken` (lib/instagram),
  `sendMessage`/`sendDocument` (lib/telegram).
- Produces: `GET /api/report` — the cron entrypoint.

- [ ] **Step 1: Implement `app/api/report/route.ts`**

```ts
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
```

- [ ] **Step 2: Typecheck via build and full test run**

Run: `npm run build && npm test`
Expected: build succeeds; all tests pass.

- [ ] **Step 3: Commit**

```bash
git add app/api/report/route.ts
git commit -m "feat: cron endpoint orchestrating snapshot, diff and Telegram report"
```

---

### Task 8: Setup instructions and README

**Files:**
- Create: `SETUP.md`, `README.md`

**Interfaces:**
- Consumes: env var names from Global Constraints.
- Produces: step-by-step Russian instructions the user follows to obtain tokens and deploy.

- [ ] **Step 1: Create `SETUP.md`** (Russian, complete walkthrough)

Content must cover, in this order, as numbered steps with exact UI paths:

1. **Instagram-токен** — на https://developers.facebook.com: My Apps → Create App → тип «Other»/«Business» → добавить продукт **Instagram** → «API setup with Instagram business login» → в разделе «Generate access tokens» добавить свой Instagram-аккаунт (должен быть Business/Creator) и нажать Generate token → выдать разрешения `instagram_business_basic` и `instagram_business_manage_insights` → скопировать долгоживущий токен (60 дней; дальше бот продлевает его сам). Там же скопировать **Instagram user ID** аккаунта.
2. **ID группового чата** — добавить бота в группу; отправить в группу любое сообщение с упоминанием бота; открыть `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates` и взять `chat.id` (для групп это отрицательное число, например `-1001234567890`).
3. **Vercel** — `npm i -g vercel@latest`, `vercel link`; в дашборде проекта: Storage → Create → Blob (подключить к проекту — появится `BLOB_READ_WRITE_TOKEN`); добавить env-переменные `IG_ACCESS_TOKEN`, `IG_USER_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `CRON_SECRET` (случайная строка: `openssl rand -hex 32`) через `vercel env add <NAME> production`; задеплоить `vercel --prod`.
4. **Проверка** — ручной запуск: `curl -H "Authorization: Bearer $CRON_SECRET" https://<project>.vercel.app/api/report` — в чат должны прийти отчёт и CSV (первый запуск — «базовый замер»). Крон дальше срабатывает сам каждый день в 12:30 по Джакарте.

- [ ] **Step 2: Create `README.md`** (short: what the bot does, report format, where snapshots live, link to SETUP.md, `npm test` / `npm run build` commands)

- [ ] **Step 3: Final verification**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add SETUP.md README.md
git commit -m "docs: setup walkthrough and README"
```

---

## Manual integration checklist (post-deploy, requires user's tokens)

Not automatable — performed with the user after Task 8:

1. User completes SETUP.md steps 1–3.
2. Trigger `/api/report` manually with the `CRON_SECRET` header → baseline report arrives in the group chat.
3. Next day at 12:30 WIB the cron fires automatically → first gain report arrives.
