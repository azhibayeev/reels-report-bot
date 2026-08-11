// ── Чтение Meta Marketing API (Insights): реклама по таргету.
// Метрики за окно: потрачено, показы, клики, охват, лиды (результаты) и цена за результат.
// Уровень аккаунта (act_…) — агрегат по всем активным кампаниям.
//
// Ограничение API: Insights отдаёт данные по КАЛЕНДАРНЫМ дням в таймзоне рекламного
// аккаунта; истинного «скользящего 24ч»-окна нет. Поэтому суточная секция берёт
// date_preset=yesterday (последние завершённые рекламные сутки), а /targettotal — maximum.

const GRAPH = "https://graph.facebook.com/v21.0";

export type AdWindow = "yesterday" | "today" | "maximum";

export interface AdInsights {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  leads: number;
  costPerResult: number | null; // потрачено / лиды
  currency: string;
  leadActionType: string | null; // какой action_type засчитан как лид
  periodStart: string | null;
  periodEnd: string | null;
  hasData: boolean;
}

interface InsightAction {
  action_type: string;
  value: string;
}

export interface InsightRow {
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  actions?: InsightAction[];
  account_currency?: string;
  date_start?: string;
  date_stop?: string;
}

const N = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Выбор количества лидов из actions. Приоритет — от самого специфичного к общему,
// чтобы не двойного счёта из перекрывающихся типов. Точный тип можно закрепить
// через env META_LEAD_ACTION_TYPE (напр. offsite_conversion.fb_pixel_lead).
const LEAD_PRIORITY = [
  "offsite_conversion.fb_pixel_lead",
  "onsite_conversion.lead_grouped",
  "onsite_web_lead",
  "leadgen_grouped",
  "lead",
];

export function pickLeads(actions: InsightAction[] | undefined, pinned?: string): { leads: number; type: string | null } {
  if (!actions || actions.length === 0) return { leads: 0, type: null };
  const byType = new Map(actions.map((a) => [a.action_type, N(a.value)]));
  if (pinned && byType.has(pinned)) return { leads: byType.get(pinned)!, type: pinned };
  for (const t of LEAD_PRIORITY) {
    if (byType.has(t)) return { leads: byType.get(t)!, type: t };
  }
  // Фолбэк: любой тип, содержащий "lead" (берём максимальный, чтобы не суммировать дубли).
  let best: { leads: number; type: string } | null = null;
  for (const a of actions) {
    if (/lead/i.test(a.action_type) && (!best || N(a.value) > best.leads)) {
      best = { leads: N(a.value), type: a.action_type };
    }
  }
  return best ?? { leads: 0, type: null };
}

// Чистый парсер строки Insights → AdInsights (без сети, тестируемый).
export function parseInsights(row: InsightRow | undefined, pinnedLeadType?: string): AdInsights {
  if (!row) {
    return {
      spend: 0, impressions: 0, clicks: 0, reach: 0, leads: 0,
      costPerResult: null, currency: process.env.META_CURRENCY || "USD",
      leadActionType: null, periodStart: null, periodEnd: null, hasData: false,
    };
  }
  const spend = N(row.spend);
  const { leads, type } = pickLeads(row.actions, pinnedLeadType);
  return {
    spend,
    impressions: N(row.impressions),
    clicks: N(row.clicks),
    reach: N(row.reach),
    leads,
    costPerResult: leads > 0 ? spend / leads : null,
    currency: row.account_currency || process.env.META_CURRENCY || "USD",
    leadActionType: type,
    periodStart: row.date_start ?? null,
    periodEnd: row.date_stop ?? null,
    hasData: true,
  };
}

// Запрос Insights за окно. yesterday/today — суточные пресеты; maximum — за всё время.
export async function getAdInsights(window: AdWindow): Promise<AdInsights> {
  const account = process.env.META_AD_ACCOUNT_ID;
  const token = process.env.META_ADS_TOKEN;
  if (!account || !token) throw new Error("META_AD_ACCOUNT_ID / META_ADS_TOKEN не заданы");
  const act = account.startsWith("act_") ? account : `act_${account}`;

  const params = new URLSearchParams({
    fields: "spend,impressions,clicks,reach,actions,account_currency",
    date_preset: window,
    level: "account",
    access_token: token,
  });

  const res = await fetch(`${GRAPH}/${act}/insights?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Meta Insights failed (${res.status}): ${await res.text()}`);
  const j = (await res.json()) as { data?: InsightRow[]; error?: { message?: string } };
  if (j.error) throw new Error(`Meta Insights error: ${j.error.message ?? "unknown"}`);
  // Пустой data = за окно не было открутки → нулевой отчёт, а не ошибка.
  return parseInsights(j.data?.[0], process.env.META_LEAD_ACTION_TYPE);
}
