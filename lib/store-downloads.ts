// ── Скачивания из сторов для сводки по приложению.
//
// Сторы публикуют суточные отчёты с задержкой: App Store — примерно сутки, Google Play —
// двое-трое. Поэтому каждый стор отдаёт ПОСЛЕДНИЙ ГОТОВЫЙ день со своей датой, а не
// «вчера»: сообщение обязано назвать эту дату, иначе цифра читается как вчерашняя.
// Рядом — всего скачиваний за всё время по этот же день.
//
// App Store: Sales and Trends (SALES / SUMMARY / DAILY) через App Store Connect API.
// Google Play: месячный CSV установок в бакете отчётов Play (Cloud Storage).

import { sign } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { APPSTORE_ID, PLAY_PACKAGE } from "./applink";
import { getAccessToken } from "./sheets";

// day — скачивания за день date; total — за всё время по date включительно.
export type StoreResult =
  | { status: "ok"; date: string; day: number; total: number }
  | { status: "off" }
  | { status: "error"; message: string };

export interface StoreDownloads {
  appStore: StoreResult;
  play: StoreResult;
}

/** Сколько дней назад искать готовый отчёт, прежде чем сдаться. */
const MAX_LOOKBACK_DAYS = 7;

const errorOf = (e: unknown): StoreResult => ({
  status: "error",
  message: e instanceof Error ? e.message : String(e),
});

// ── App Store ────────────────────────────────────────────────────────────────

// Типы продукта в отчёте продаж: первое скачивание и повторное (тот же Apple ID
// поставил заново). Обновления (7, 7F…) и покупки внутри приложения — не скачивания.
const FIRST_DOWNLOAD = new Set(["1", "1F", "1T", "F1", "1E", "1EP", "1EU"]);
const REDOWNLOAD = new Set(["3", "3F", "3T", "F3"]);

/**
 * TSV отчёта → скачивания Qurany. На аккаунте разработчика живут и другие приложения
 * (IQUP, TATAMI, QOS…), поэтому строки отбираются по Apple Identifier.
 */
export function parseAppStoreReport(tsv: string): { downloads: number; redownloads: number } {
  const [header, ...rows] = tsv.trim().split("\n").map((l) => l.split("\t"));
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`в отчёте App Store нет колонки «${name}»: ${header.join(", ")}`);
    return i;
  };
  const id = col("Apple Identifier");
  const type = col("Product Type Identifier");
  const units = col("Units");

  let downloads = 0;
  let redownloads = 0;
  for (const r of rows) {
    if (r[id] !== APPSTORE_ID) continue;
    const n = Number(r[units]) || 0;
    if (FIRST_DOWNLOAD.has(r[type])) downloads += n;
    else if (REDOWNLOAD.has(r[type])) redownloads += n;
  }
  return { downloads, redownloads };
}

function ascConfig() {
  const issuer = process.env.ASC_ISSUER_ID;
  const keyId = process.env.ASC_KEY_ID;
  const key = process.env.ASC_PRIVATE_KEY;
  const vendor = process.env.ASC_VENDOR_NUMBER;
  if (!issuer || !keyId || !key || !vendor) return null;
  // Ключ .p8 в env одной строкой с экранированными \n — как GOOGLE_SA_PRIVATE_KEY.
  return { issuer, keyId, key: key.replace(/\\n/g, "\n"), vendor };
}

const b64url = (v: string | Buffer): string => Buffer.from(v).toString("base64url");

/** JWT для App Store Connect API: ES256, живёт 15 минут (Apple принимает до 20). */
export function ascJwt(nowSec: number): string {
  const c = ascConfig();
  if (!c) throw new Error("ASC_ISSUER_ID / ASC_KEY_ID / ASC_PRIVATE_KEY / ASC_VENDOR_NUMBER не заданы");
  const input =
    `${b64url(JSON.stringify({ alg: "ES256", kid: c.keyId, typ: "JWT" }))}.` +
    b64url(JSON.stringify({ iss: c.issuer, iat: nowSec, exp: nowSec + 900, aud: "appstoreconnect-v1" }));
  // ieee-p1363: JWT ждёт подпись r||s, а не DER, который node отдаёт по умолчанию.
  const sig = sign("sha256", Buffer.from(input), { key: c.key, dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(sig)}`;
}

// Qurany вышел в App Store 18.08.2026 (releaseDate в itunes.apple.com/lookup). Готового
// «всего за всё время» Apple не отдаёт — итог складывается из отчётов продаж с этого месяца.
const APPSTORE_RELEASE_MONTH = "2026-08";

type AscUnits = (frequency: "DAILY" | "MONTHLY", reportDate: string) => Promise<number | null>;

// Версия отчёта продаж у Apple своя для каждой частоты, и документация отстаёт: дневной
// с 2024 г. принимает только 1_1, а месячный с 1_1 Apple отверг 12.10 (400
// PARAMETER_ERROR.INVALID). Первой идёт рабочая версия, на 400 пробуем другую.
const ASC_VERSIONS: Record<"DAILY" | "MONTHLY", string[]> = { DAILY: ["1_1", "1_0"], MONTHLY: ["1_0", "1_1"] };

/** Причина отказа Apple одной строкой: detail первой ошибки из JSON, иначе начало тела. */
async function ascError(res: Response): Promise<string> {
  const body = await res.text();
  try {
    const e = (JSON.parse(body) as { errors?: Array<{ code?: string; title?: string; detail?: string }> }).errors?.[0];
    if (e) return [e.code, e.detail ?? e.title].filter(Boolean).join(": ");
  } catch {
    // не JSON — ниже начало тела
  }
  return body.replace(/\s+/g, " ").slice(0, 200);
}

/**
 * Скачивания Qurany (первые + повторные) из одного отчёта продаж; null — отчёта нет (404:
 * Apple его ещё не выложил или в тот день у аккаунта не было ни одной продажи). Любой
 * другой отказ (ключ, права) — ошибка: искать дальше бессмысленно.
 */
function ascUnits(c: NonNullable<ReturnType<typeof ascConfig>>, jwt: string): AscUnits {
  return async (frequency, reportDate) => {
    let rejected = "";
    for (const version of ASC_VERSIONS[frequency]) {
      const url = new URL("https://api.appstoreconnect.apple.com/v1/salesReports");
      url.searchParams.set("filter[frequency]", frequency);
      url.searchParams.set("filter[reportType]", "SALES");
      url.searchParams.set("filter[reportSubType]", "SUMMARY");
      url.searchParams.set("filter[vendorNumber]", c.vendor);
      url.searchParams.set("filter[reportDate]", reportDate);
      url.searchParams.set("filter[version]", version);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${jwt}`, Accept: "application/a-gzip" },
      });
      if (res.status === 404) return null;
      if (res.status === 400) {
        rejected = await ascError(res);
        continue;
      }
      if (!res.ok) throw new Error(`App Store Connect ${res.status} (${frequency} ${reportDate}): ${await ascError(res)}`);
      const { downloads, redownloads } = parseAppStoreReport(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
      return downloads + redownloads;
    }
    throw new Error(`App Store Connect 400 (${frequency} ${reportDate}): ${rejected}`);
  };
}

const sum = (xs: Array<number | null>): number => xs.reduce<number>((a, x) => a + (x ?? 0), 0);

/** Дни месяца "YYYY-MM" с 1-го по last включительно (по умолчанию — до конца месяца). */
function daysOf(month: string, last?: number): string[] {
  const [y, m] = month.split("-").map(Number);
  const n = last ?? new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** Месяцы "YYYY-MM" от from включительно до to не включая. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}-01T00:00:00Z`);
  for (let key = from; key < to; key = d.toISOString().slice(0, 7)) {
    out.push(key);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/** Закрытый месяц: месячный отчёт, а пока Apple его не выложил (первые дни) — сумма дневных. */
async function monthUnits(units: AscUnits, month: string): Promise<number> {
  const n = await units("MONTHLY", month);
  return n ?? sum(await Promise.all(daysOf(month).map((d) => units("DAILY", d))));
}

/**
 * Последний готовый день — идём назад от вчера (UTC), пока Apple отвечает 404. Всего —
 * закрытые месяцы с выхода месячными отчётами + дни текущего месяца по этот день.
 */
export async function getAppStoreDownloads(now: Date): Promise<StoreResult> {
  const c = ascConfig();
  if (!c) return { status: "off" };
  try {
    const units = ascUnits(c, ascJwt(Math.floor(now.getTime() / 1000)));
    for (let back = 1; back <= MAX_LOOKBACK_DAYS; back++) {
      const date = new Date(now.getTime() - back * 86_400_000).toISOString().slice(0, 10);
      const day = await units("DAILY", date);
      if (day === null) continue;

      const month = date.slice(0, 7);
      const [closed, earlierDays] = await Promise.all([
        Promise.all(monthsBetween(APPSTORE_RELEASE_MONTH, month).map((m) => monthUnits(units, m))),
        Promise.all(daysOf(month, Number(date.slice(8)) - 1).map((d) => units("DAILY", d))),
      ]);
      return { status: "ok", date, day, total: sum(closed) + sum(earlierDays) + day };
    }
    throw new Error(`нет готового отчёта за последние ${MAX_LOOKBACK_DAYS} дней`);
  } catch (e) {
    return errorOf(e);
  }
}

// ── Google Play ──────────────────────────────────────────────────────────────

const GCS_SCOPE = "https://www.googleapis.com/auth/devstorage.read_only";

// Play кладёт CSV в UTF-16LE с BOM; на случай UTF-8 смотрим на BOM.
function decode(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  return buf.toString("utf8").replace(/^﻿/, "");
}

/** Строки месячного CSV установок по датам: Daily User Installs за каждый день. */
function playInstallRows(buf: Buffer): Array<{ date: string; day: number }> {
  const lines = decode(buf)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
  const [header, ...rows] = lines;
  const dateCol = header.indexOf("Date");
  const installsCol = header.indexOf("Daily User Installs");
  if (dateCol < 0 || installsCol < 0) {
    throw new Error(`в отчёте Play нет колонок Date / Daily User Installs: ${header.join(", ")}`);
  }
  return rows
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[dateCol]))
    .sort((a, b) => (a[dateCol] < b[dateCol] ? -1 : 1))
    .map((r) => ({ date: r[dateCol], day: Number(r[installsCol]) || 0 }));
}

/**
 * Месячный CSV установок → последний день в файле и Daily User Installs за него: люди,
 * впервые поставившие приложение. Пустой файл (начало месяца) — null: вызывающий берёт
 * прошлый месяц.
 */
export function parsePlayInstallsCsv(buf: Buffer): { date: string; day: number } | null {
  return playInstallRows(buf).at(-1) ?? null;
}

const yyyymm = (d: Date): string => d.toISOString().slice(0, 7).replace("-", "");

const PLAY_INSTALLS_PREFIX = `stats/installs/installs_${PLAY_PACKAGE}_`;

/** Файл бакета Play; null — такого нет (404). */
async function gcsObject(bucket: string, token: string, name: string): Promise<Buffer | null> {
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `нет доступа к бакету ${bucket} (${res.status}): пригласите ${process.env.GOOGLE_SA_EMAIL} в Play Console ` +
        "с правом «View app information and download bulk reports»"
    );
  }
  if (!res.ok) throw new Error(`Cloud Storage ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Всего установок за всё время — сумма Daily User Installs по всем месячным файлам.
 * Колонка Total User Installs в отчёте есть, но Google её больше не заполняет (в живом
 * отчёте 12.10 — нули).
 */
async function sumPlayUserInstalls(bucket: string, token: string): Promise<number> {
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(PLAY_INSTALLS_PREFIX)}&maxResults=1000`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Cloud Storage ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { items = [] } = (await res.json()) as { items?: Array<{ name: string }> };
  const files = await Promise.all(
    items.filter((o) => o.name.endsWith("_overview.csv")).map((o) => gcsObject(bucket, token, o.name))
  );
  return sum(files.flatMap((f) => (f ? playInstallRows(f).map((r) => r.day) : [])));
}

export async function getPlayDownloads(now: Date): Promise<StoreResult> {
  const bucket = process.env.PLAY_REPORTS_BUCKET;
  if (!bucket || !process.env.GOOGLE_SA_EMAIL || !process.env.GOOGLE_SA_PRIVATE_KEY) return { status: "off" };
  try {
    const token = await getAccessToken(GCS_SCOPE);
    // Текущий месяц, а в первые дни, пока в его файле пусто, — прошлый.
    const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    for (const month of [yyyymm(now), yyyymm(prevMonth)]) {
      const file = await gcsObject(bucket, token, `${PLAY_INSTALLS_PREFIX}${month}_overview.csv`);
      const last = file && parsePlayInstallsCsv(file);
      if (!last) continue;
      return { status: "ok", ...last, total: await sumPlayUserInstalls(bucket, token) };
    }
    throw new Error("в отчётах Play за этот и прошлый месяц нет ни одного дня");
  } catch (e) {
    return errorOf(e);
  }
}

/** Оба стора параллельно; сбой одного не трогает другой. Никогда не бросает. */
export async function getStoreDownloads(now: Date): Promise<StoreDownloads> {
  const [appStore, play] = await Promise.all([getAppStoreDownloads(now), getPlayDownloads(now)]);
  return { appStore, play };
}
