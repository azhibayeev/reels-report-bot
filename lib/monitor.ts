// Монитор-бот: проверяет доступность сайтов и статус рекламного аккаунта Facebook,
// шлёт алерты в Telegram ТОЛЬКО при смене состояния (падение/восстановление), без спама.
// Состояние — в Vercel Blob (state/monitor.json), как и остальное в проекте.

import crypto from "node:crypto";
import { list, put } from "@vercel/blob";

const STATE_PATH = "state/monitor.json";
const FB_TOKEN_PATH = "state/fb-token.enc";

export interface SiteState {
  down: boolean;
  since: string; // ISO — с какого момента текущее состояние
  code: number | null; // последний HTTP-код (null = не ответил)
}

export interface FbState {
  status: number | null; // account_status
  reason: number | null; // disable_reason
  bad: boolean; // считаем ли текущий статус проблемным
  since: string;
}

export interface MonitorState {
  sites: Record<string, SiteState>;
  fb?: FbState;
  updatedAt: string;
}

export async function loadState(): Promise<MonitorState> {
  const { blobs } = await list({ prefix: STATE_PATH });
  const blob = blobs.find((b) => b.pathname === STATE_PATH);
  if (!blob) return { sites: {}, updatedAt: new Date(0).toISOString() };
  try {
    const res = await fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return { sites: {}, updatedAt: new Date(0).toISOString() };
    return (await res.json()) as MonitorState;
  } catch {
    return { sites: {}, updatedAt: new Date(0).toISOString() };
  }
}

export async function saveState(state: MonitorState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await put(STATE_PATH, JSON.stringify(state), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 30,
  });
}

// ── Проверка сайта ───────────────────────────────────────────────────────────
// Возвращает {ok, code}. Один ретрай, чтобы одиночный сетевой всплеск не поднимал алерт.
async function probe(url: string, timeoutMs = 10000): Promise<{ ok: boolean; code: number | null }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "Qurany-Monitor/1.0" },
      cache: "no-store",
    });
    return { ok: res.status >= 200 && res.status < 400, code: res.status };
  } catch {
    return { ok: false, code: null };
  } finally {
    clearTimeout(t);
  }
}

export async function checkSite(url: string): Promise<{ ok: boolean; code: number | null }> {
  const first = await probe(url);
  if (first.ok) return first;
  await new Promise((r) => setTimeout(r, 2500)); // короткая пауза и второй заход
  return probe(url);
}

// ── Facebook Ads account status ──────────────────────────────────────────────
export const FB_STATUS_LABEL: Record<number, string> = {
  1: "Активен",
  2: "Отключён (DISABLED)",
  3: "Не оплачен — платёж не прошёл (UNSETTLED)",
  7: "На проверке риск-модели (PENDING_RISK_REVIEW)",
  8: "Ожидает списания (PENDING_SETTLEMENT)",
  9: "Льготный период — есть задолженность (IN_GRACE_PERIOD)",
  100: "В процессе закрытия (PENDING_CLOSURE)",
  101: "Закрыт (CLOSED)",
};

export const FB_DISABLE_REASON_LABEL: Record<number, string> = {
  0: "нет",
  1: "нарушение рекламной политики",
  2: "проверка IP",
  3: "проблема с оплатой (RISK_PAYMENT)",
  4: "аккаунт закрыт (gray account)",
  5: "AFC review",
  6: "проверка добросовестности бизнеса",
  7: "закрыт навсегда",
};

// Проблемным считаем всё, кроме «1 — Активен».
export function fbIsBad(status: number | null): boolean {
  return status !== null && status !== 1;
}

export interface FbAccount {
  account_status: number;
  disable_reason?: number;
  balance?: string;
  amount_spent?: string;
  currency?: string;
  name?: string;
}

export async function fetchFbAccount(token: string, accountId: string): Promise<FbAccount> {
  const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const fields = "name,account_status,disable_reason,balance,amount_spent,currency";
  const url = `https://graph.facebook.com/v21.0/${act}?fields=${fields}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json()) as { error?: { message?: string; code?: number } } & FbAccount;
  if (!res.ok || json.error) {
    throw new Error(`FB API ${res.status}: ${json.error?.message ?? "unknown"}`);
  }
  return json;
}

// Баланс/траты приходят в минорных единицах (копейки/сен) — приводим к основной.
export function fbMoney(raw: string | undefined, currency: string | undefined): string {
  if (raw == null) return "—";
  const n = Number(raw) / 100;
  return `${n.toLocaleString("ru-RU")} ${currency ?? ""}`.trim();
}

// ── Токен FB: авто-продление, чтобы работал бессрочно без ручного вмешательства ──
// Токен хранится в Blob зашифрованным (ключ выводится из CRON_SECRET). Раз в 25 дней
// пере-обмениваем его через app_secret — это сбрасывает 90-дневное окно доступа к данным.
interface FbTokenStore {
  token: string;
  refreshedAt: string;
}

function encKey(): Buffer {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set");
  return crypto.createHash("sha256").update(secret).digest();
}

async function loadFbToken(): Promise<FbTokenStore | null> {
  const { blobs } = await list({ prefix: FB_TOKEN_PATH });
  const blob = blobs.find((b) => b.pathname === FB_TOKEN_PATH);
  if (!blob) return null;
  try {
    const res = await fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.text(), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const dec = crypto.createDecipheriv("aes-256-gcm", encKey(), iv);
    dec.setAuthTag(tag);
    const json = Buffer.concat([dec.update(buf.subarray(28)), dec.final()]).toString("utf8");
    return JSON.parse(json) as FbTokenStore;
  } catch {
    return null;
  }
}

async function saveFbToken(store: FbTokenStore): Promise<void> {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(store), "utf8"), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
  await put(FB_TOKEN_PATH, payload, {
    access: "public",
    contentType: "text/plain",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 30,
  });
}

async function exchangeToken(appId: string, secret: string, token: string): Promise<string | null> {
  const url =
    `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token` +
    `&client_id=${appId}&client_secret=${encodeURIComponent(secret)}&fb_exchange_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const j = (await res.json()) as { access_token?: string };
    return res.ok && j.access_token ? j.access_token : null;
  } catch {
    return null;
  }
}

// Возвращает актуальный токен: из Blob (если есть), иначе из env (первичный посев).
// Если заданы app id+secret и токену >25 дней — пере-обменивает и сохраняет.
export async function resolveFbToken(): Promise<string | null> {
  const envToken = process.env.META_ADS_TOKEN || null;
  const appId = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET;

  const stored = await loadFbToken();
  let token = stored?.token || envToken;
  if (!token) return null;

  if (appId && secret) {
    const ageDays = stored ? (Date.now() - new Date(stored.refreshedAt).getTime()) / 86400000 : Infinity;
    if (ageDays > 25) {
      const fresh = await exchangeToken(appId, secret, token);
      if (fresh) {
        token = fresh;
        await saveFbToken({ token: fresh, refreshedAt: new Date().toISOString() });
      }
    }
  }
  return token;
}
