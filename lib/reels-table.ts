// ── Сбор полной таблицы по Reels: медиа + инсайты → строки для Google Sheets.
// Сеть отделена от чистой логики: buildRows/toSheetValues тестируются без фетчей.

const G = "https://graph.instagram.com";

export interface ReelMedia {
  id: string;
  permalink: string;
  timestamp: string;
  caption: string;
  likeCount: number | null;
  commentsCount: number | null;
}

export interface ReelInsight {
  views: number | null;
  reach: number | null;
  shares: number | null;
  saved: number | null;
  totalInteractions: number | null;
  avgWatchTimeMs: number | null;
}

export interface ReelRow extends ReelMedia, ReelInsight {
  /** Всего реакций ÷ охват × 100. null, если охвата нет или он нулевой. */
  engagementRate: number | null;
}

const EMPTY_INSIGHT: ReelInsight = {
  views: null,
  reach: null,
  shares: null,
  saved: null,
  totalInteractions: null,
  avgWatchTimeMs: null,
};

export const HEADERS = [
  "№",
  "Дата",
  "Ссылка",
  "Описание",
  "Просмотры",
  "Охват",
  "Лайки",
  "Комментарии",
  "Репосты",
  "Сохранения",
  "Всего реакций",
  "ER %",
  "Ср. досмотр, с",
  "ID",
] as const;

// Полное описание ролика, но в одну строку: переводы строк схлопываем, иначе Sheets
// растягивает строки таблицы по высоте и матрицу истории становится не прочитать.
// Ячейка, начинающаяся с =/+/-/@, была бы прочитана как формула (пишем в режиме
// USER_ENTERED) — такие экранируем апострофом.
export function sheetCaption(caption: string): string {
  const flat = caption.replace(/\s+/g, " ").trim();
  return /^[=+\-@]/.test(flat) ? `'${flat}` : flat;
}

const jakarta = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// Формат ГГГГ-ММ-ДД ЧЧ:ММ — Google Sheets распознаёт его как дату-время в любой локали.
export function jakartaStamp(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const p = Object.fromEntries(jakarta.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export function buildRows(media: ReelMedia[], insights: Map<string, ReelInsight>): ReelRow[] {
  return media
    .map((m) => {
      const ins = insights.get(m.id) ?? EMPTY_INSIGHT;
      const er =
        ins.totalInteractions != null && ins.reach != null && ins.reach > 0
          ? Math.round((ins.totalInteractions / ins.reach) * 10_000) / 100
          : null;
      return { ...m, ...ins, engagementRate: er };
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

const cell = (v: number | null): string | number => (v == null ? "" : v);

export function toSheetValues(rows: ReelRow[], updatedAt: Date): Array<Array<string | number>> {
  const stamp = jakartaStamp(updatedAt.toISOString());
  return [
    [...HEADERS, `Обновлено: ${stamp} (WIB)`],
    ...rows.map((r, i) => [
      i + 1,
      jakartaStamp(r.timestamp),
      r.permalink,
      sheetCaption(r.caption),
      cell(r.views),
      cell(r.reach),
      cell(r.likeCount),
      cell(r.commentsCount),
      cell(r.shares),
      cell(r.saved),
      cell(r.totalInteractions),
      cell(r.engagementRate),
      r.avgWatchTimeMs == null ? "" : Math.round(r.avgWatchTimeMs / 100) / 10,
      r.id,
    ]),
  ];
}

// ── Сеть ───────────────────────────────────────────────────────────────────

interface RawMedia {
  id: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  caption?: string;
  like_count?: number;
  comments_count?: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function fetchAllReelsDetailed(igUserId: string, token: string): Promise<ReelMedia[]> {
  const out: RawMedia[] = [];
  let url: string | null =
    `${G}/${igUserId}/media?fields=id,media_product_type,permalink,timestamp,caption,like_count,comments_count` +
    `&limit=100&access_token=${encodeURIComponent(token)}`;
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
      likeCount: num(m.like_count),
      commentsCount: num(m.comments_count),
    }));
}

interface RawMetric {
  name?: string;
  total_value?: { value?: number };
  values?: Array<{ value?: number }>;
}

export function parseInsightPayload(data: { data?: RawMetric[] }): ReelInsight {
  const by = new Map<string, number | null>();
  for (const m of data.data ?? []) {
    if (!m.name) continue;
    by.set(m.name, num(m.total_value?.value) ?? num(m.values?.[0]?.value));
  }
  const get = (k: string) => by.get(k) ?? null;
  return {
    views: get("views"),
    reach: get("reach"),
    shares: get("shares"),
    saved: get("saved"),
    totalInteractions: get("total_interactions"),
    avgWatchTimeMs: get("ig_reels_avg_watch_time"),
  };
}

const FULL = "views,reach,shares,saved,total_interactions,ig_reels_avg_watch_time";
const BASIC = "views,reach,total_interactions";
const CONCURRENCY = 10;

// Instagram отклоняет ВЕСЬ запрос, если хотя бы одна метрика не поддержана для этого
// медиа (частое дело у старых роликов). Поэтому при отказе повторяем базовым набором,
// а если и он не прошёл — просто оставляем строку без метрик, прогон не роняем.
export async function fetchReelInsights(token: string, ids: string[]): Promise<Map<string, ReelInsight>> {
  const out = new Map<string, ReelInsight>();
  let i = 0;

  async function one(id: string, metrics: string): Promise<ReelInsight | null> {
    const res = await fetch(
      `${G}/${id}/insights?metric=${metrics}&access_token=${encodeURIComponent(token)}`
    );
    if (!res.ok) {
      console.error(`insights [${metrics}] failed for ${id}: ${res.status} ${await res.text()}`);
      return null;
    }
    return parseInsightPayload(await res.json());
  }

  async function worker(): Promise<void> {
    while (i < ids.length) {
      const id = ids[i++];
      try {
        const ins = (await one(id, FULL)) ?? (await one(id, BASIC));
        if (ins) out.set(id, ins);
      } catch (e) {
        console.error(`insights error for ${id}:`, e);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  return out;
}
