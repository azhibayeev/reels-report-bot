// ── Чтение лидов квиза из Supabase (таблица leads) и разбивка по уровню инвестора.
// Уровень (high/medium/low) считается из ответов — логика зеркалит
// pilar-qurany/lib/quiz/investor.ts (держим синхронно; она маленькая и стабильная).
// Считаем только завершённые заявки (status = complete).

export type InvestorLevel = "high" | "medium" | "low";

export interface LeadLevels {
  high: number;
  medium: number;
  low: number;
  total: number;
  sinceIso: string | null; // null = за всё время
}

// Минимум ответов, влияющих на уровень (см. investor.ts в pilar-qurany).
interface Answers {
  kapasitas?: string;
  warisan?: string;
  keputusan?: string;
}

// ЗЕРКАЛО pilar-qurany/lib/quiz/investor.ts — при изменении там обнови здесь.
export function investorLevel(a: Answers, tier?: string): InvestorLevel {
  const highBudget = a.kapasitas === "75-150" || a.kapasitas === ">150" || a.kapasitas === "langsung";
  const midBudget = a.kapasitas === "30-75";
  const institutional = a.warisan === "lembaga";
  const autonomous = a.keputusan === "sendiri" || a.keputusan === "mitra" || a.keputusan === "ustadz";

  if (highBudget || (tier === "A" && institutional)) return "high";
  if (midBudget || (institutional && autonomous) || tier === "B") return "medium";
  return "low";
}

interface LeadRow {
  tier?: string | null;
  answers?: Answers | null;
}

const PAGE = 1000;

/**
 * База лидов подключена? Квиз умеет писать их и мимо Supabase (LEAD_STORE=console),
 * и тогда разбивки по уровню инвестора просто нет — это не поломка.
 */
export function leadsConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function sbFetchLeads(sinceIso: string | null): Promise<LeadRow[]> {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы");

  const filters = ["status=eq.complete"];
  if (sinceIso) filters.push(`created_at=gte.${encodeURIComponent(sinceIso)}`);
  const query = `leads?select=tier,answers&${filters.join("&")}&order=created_at.asc`;

  const rows: LeadRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${base}/rest/v1/${query}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${from}-${from + PAGE - 1}`,
        "Range-Unit": "items",
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Supabase leads read failed (${res.status}): ${await res.text()}`);
    const page = (await res.json()) as LeadRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

// Счётчики по уровню инвестора за окно [sinceIso, now). sinceIso=null → за всё время.
// null — источник лидов не подключён; рекламная часть отчёта от этого не страдает.
export async function getLeadLevels(sinceIso: string | null): Promise<LeadLevels | null> {
  if (!leadsConfigured()) return null;
  const rows = await sbFetchLeads(sinceIso);
  const out: LeadLevels = { high: 0, medium: 0, low: 0, total: 0, sinceIso };
  for (const r of rows) {
    const lvl = investorLevel(r.answers ?? {}, r.tier ?? undefined);
    out[lvl] += 1;
    out.total += 1;
  }
  return out;
}
