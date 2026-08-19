// ── Чтение PostHog (Query API / HogQL): заходы по ссылкам.
// Заход = событие $pageview на лендинге go.quranyy.com с UTM-меткой.
// Метрика — УНИКАЛЬНЫЕ люди (uniq person_id), а не число загрузок.
//
// Особенность проекта: фильтр по property в WHERE отдаёт results:null — поэтому фильтруем
// только по event+timestamp, а разбивку по источнику делаем меткой в SELECT (multiIf) + GROUP BY.

import { DayPoint } from "./types";

const HOST = process.env.POSTHOG_HOST || "us.posthog.com";

export type Category = "bio" | "inf" | "direct" | "other";

export interface SourceRow {
  category: Category;
  name: string; // daristeppe / qurany_app / bara / Прямые / instagram…
  uniq: number; // уник. людей, зашедших по ссылке
}

export interface ClicksStats {
  sinceEpoch: number; // 0 = за всё время
  sources: SourceRow[];
}

// Метка источника прямо в HogQL. Порядок важен: инфлюенсер/DM ловим по utm_medium
// ДО content (иначе DM-трафик daristeppe утечёт в «шапку»). Формат метки: "cat|name".
const LABEL =
  "multiIf(" +
  "properties.utm_medium = 'influencer', concat('inf|', coalesce(nullIf(properties.utm_source,''),'?')), " +
  "properties.utm_medium = 'dm', 'other|DM-бот', " +
  "properties.utm_content IN ('daristeppe'), 'bio|daristeppe', " +
  "properties.utm_content IN ('qurany_app','link_in_bio'), 'bio|qurany_app', " +
  "properties.utm_source IS NULL AND properties.utm_medium IS NULL, 'direct|Прямые', " +
  "concat('other|', coalesce(nullIf(properties.utm_source,''),'?'), '/', coalesce(nullIf(properties.utm_medium,''),'?'))" +
  ")";

// Последняя суточная граница отчёта = 12:30 Asia/Jakarta (UTC+7, без перехода) = 05:30 UTC.
// Возвращает самый недавний такой момент ≤ now. Для /kliki — граница текущего спринта.
export function lastSprintStart(now: Date = new Date()): Date {
  const b = new Date(now);
  b.setUTCHours(5, 30, 0, 0); // 12:30 Джакарты
  if (b.getTime() > now.getTime()) b.setUTCDate(b.getUTCDate() - 1);
  return b;
}

async function phQuery(hogql: string): Promise<unknown[][]> {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const project = process.env.POSTHOG_PROJECT_ID;
  if (!key || !project) throw new Error("POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID не заданы");
  const res = await fetch(`https://${HOST}/api/projects/${project}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: hogql } }),
  });
  if (!res.ok) throw new Error(`PostHog query failed (${res.status}): ${await res.text()}`);
  const j = (await res.json()) as { error?: string | null; results?: unknown[][] | null };
  if (j.error) throw new Error(`PostHog query error: ${j.error}`);
  return j.results ?? [];
}

const N = (v: unknown): number => Number(v) || 0;

// Заходы по источникам за окно [sinceEpoch, now). sinceEpoch=0 → за всё время.
export async function getClicksStats(sinceEpoch: number): Promise<ClicksStats> {
  const win = `timestamp >= toDateTime(${Math.floor(sinceEpoch)})`;
  const pv = await phQuery(
    `SELECT ${LABEL} AS label, uniq(person_id) AS u FROM events WHERE event = '$pageview' AND ${win} GROUP BY label`
  );

  const sources: SourceRow[] = pv.map((row) => {
    const label = String(row[0]);
    const [category, ...rest] = label.split("|");
    return {
      category: (["bio", "inf", "direct", "other"].includes(category) ? category : "other") as Category,
      name: rest.join("|"),
      uniq: N(row[1]),
    };
  });

  return { sinceEpoch, sources };
}

// Заходы (уник. люди с $pageview) по СУТОЧНЫМ СПРИНТАМ, выровненным на 12:30 Джакарты —
// та же граница, что у дневного прироста просмотров (computeDailyViewGains по снапшотам
// в 12:30). Иначе линии графика бьются по разным суткам, а последняя точка выходит
// неполной (полночь→сейчас) и не сходится с «Заходы за сутки» в отчёте.
//
// День спринта = дата (в Джакарте) момента, сдвинутого на +11:30 ч: клики от 12:30 текущего
// дня до 12:30 следующего попадают в ЗАВЕРШАЮЩИЙ день — как метка у просмотров.
// WHERE держим на event+timestamp (property-фильтры в WHERE ломают PostHog), поэтому
// отбор по ссылке конкретного аккаунта (condition) уходит внутрь uniqIf.
export async function getDailyClicks(sinceEpoch: number, condition?: string | null): Promise<DayPoint[]> {
  const counter = condition ? `uniqIf(person_id, ${condition})` : "uniq(person_id)";
  const rows = await phQuery(
    `SELECT toDate(toTimeZone(timestamp, 'Asia/Jakarta') + INTERVAL 690 MINUTE) AS d, ${counter} AS u FROM events ` +
      `WHERE event = '$pageview' AND timestamp >= toDateTime(${Math.floor(sinceEpoch)}) ` +
      `GROUP BY d ORDER BY d`
  );
  return rows.map((row) => ({ date: String(row[0]), value: N(row[1]) }));
}
