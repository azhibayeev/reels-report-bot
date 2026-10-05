// ── Скачивания из сторов для сводки по приложению.
//
// Сторы публикуют суточные отчёты с задержкой: App Store — примерно сутки, Google Play —
// двое-трое. Поэтому каждый стор отдаёт ПОСЛЕДНИЙ ГОТОВЫЙ день со своей датой, а не
// «вчера»: сообщение обязано назвать эту дату, иначе цифра читается как вчерашняя.
//
// App Store: Sales and Trends (SALES / SUMMARY / DAILY) через App Store Connect API.
// Google Play: месячный CSV установок в бакете отчётов Play (Cloud Storage).

import { sign } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { APPSTORE_ID, PLAY_PACKAGE } from "./applink";
import { getAccessToken } from "./sheets";

export type StoreResult =
  | { status: "ok"; date: string; downloads: number; redownloads?: number }
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

/**
 * Последний готовый день: идём назад от вчера (UTC), пока Apple отвечает 404 —
 * «отчёта за этот день ещё нет». Любой другой отказ (ключ, права) — сразу ошибка:
 * искать дальше бессмысленно.
 */
export async function getAppStoreDownloads(now: Date): Promise<StoreResult> {
  const c = ascConfig();
  if (!c) return { status: "off" };
  try {
    const jwt = ascJwt(Math.floor(now.getTime() / 1000));
    for (let back = 1; back <= MAX_LOOKBACK_DAYS; back++) {
      const date = new Date(now.getTime() - back * 86_400_000).toISOString().slice(0, 10);
      const url = new URL("https://api.appstoreconnect.apple.com/v1/salesReports");
      url.searchParams.set("filter[frequency]", "DAILY");
      url.searchParams.set("filter[reportType]", "SALES");
      url.searchParams.set("filter[reportSubType]", "SUMMARY");
      url.searchParams.set("filter[vendorNumber]", c.vendor);
      url.searchParams.set("filter[reportDate]", date);
      url.searchParams.set("filter[version]", "1_1");

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${jwt}`, Accept: "application/a-gzip" },
      });
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`App Store Connect ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const tsv = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
      return { status: "ok", date, ...parseAppStoreReport(tsv) };
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

/**
 * Месячный CSV установок → последний день в файле. «Скачивания» = Daily User Installs:
 * люди, впервые поставившие приложение, — пара к первым скачиваниям App Store.
 * Пустой файл (начало месяца) — null: вызывающий берёт прошлый месяц.
 */
export function parsePlayInstallsCsv(buf: Buffer): { date: string; downloads: number } | null {
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
  const last = rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[dateCol])).sort((a, b) => (a[dateCol] < b[dateCol] ? -1 : 1)).at(-1);
  return last ? { date: last[dateCol], downloads: Number(last[installsCol]) || 0 } : null;
}

const yyyymm = (d: Date): string => d.toISOString().slice(0, 7).replace("-", "");

export async function getPlayDownloads(now: Date): Promise<StoreResult> {
  const bucket = process.env.PLAY_REPORTS_BUCKET;
  if (!bucket || !process.env.GOOGLE_SA_EMAIL || !process.env.GOOGLE_SA_PRIVATE_KEY) return { status: "off" };
  try {
    const token = await getAccessToken(GCS_SCOPE);
    // Текущий месяц, а в первые дни, пока в его файле пусто, — прошлый.
    const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    for (const month of [yyyymm(now), yyyymm(prevMonth)]) {
      const name = `stats/installs/installs_${PLAY_PACKAGE}_${month}_overview.csv`;
      const res = await fetch(
        `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.status === 404) continue;
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `нет доступа к бакету ${bucket} (${res.status}): пригласите ${process.env.GOOGLE_SA_EMAIL} в Play Console ` +
            "с правом «View app information and download bulk reports»"
        );
      }
      if (!res.ok) throw new Error(`Cloud Storage ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const day = parsePlayInstallsCsv(Buffer.from(await res.arrayBuffer()));
      if (day) return { status: "ok", ...day };
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
