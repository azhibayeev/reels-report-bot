// ── Запись в Google Sheets через service account.
// Минимальный клиент поверх Sheets API v4: сами подписываем JWT (RS256) стандартным
// node:crypto и меняем его на access token. Библиотеку googleapis не тянем — в проекте
// принято обходиться без тяжёлых зависимостей (ср. график через QuickChart).

import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export interface SaCreds {
  email: string;
  privateKey: string;
}

export interface JwtClaim {
  iss: string;
  scope: string;
  aud: string;
  exp: number;
  iat: number;
}

// Ключ приходит из env одной строкой, где переводы строк экранированы как \n.
export function loadCreds(): SaCreds {
  const email = process.env.GOOGLE_SA_EMAIL;
  const key = process.env.GOOGLE_SA_PRIVATE_KEY;
  if (!email || !key) throw new Error("GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY не заданы");
  return { email, privateKey: key.replace(/\\n/g, "\n") };
}

// Таблица не настроена — вызывающий код молча пропускает синхронизацию.
export function sheetsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY && process.env.SHEETS_SPREADSHEET_ID
  );
}

export function buildJwtClaim(email: string, nowSec: number): JwtClaim {
  return { iss: email, scope: SCOPE, aud: TOKEN_URL, exp: nowSec + 3600, iat: nowSec };
}

const b64url = (v: string | Buffer): string => Buffer.from(v).toString("base64url");

export function signJwt(creds: SaCreds, nowSec: number): string {
  const input =
    `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.` +
    b64url(JSON.stringify(buildJwtClaim(creds.email, nowSec)));
  const sig = createSign("RSA-SHA256").update(input).end().sign(creds.privateKey);
  return `${input}.${b64url(sig)}`;
}

// Access token живёт час; держим в памяти модуля, чтобы не подписывать JWT на каждый вызов.
let cached: { token: string; expiresAtMs: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAtMs > Date.now() + 60_000) return cached.token;

  const nowSec = Math.floor(Date.now() / 1000);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signJwt(loadCreds(), nowSec),
    }).toString(),
  });
  if (!res.ok) throw new Error(`Google OAuth failed (${res.status}): ${await res.text()}`);
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("Google OAuth: пустой access_token");

  cached = { token: j.access_token, expiresAtMs: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${SHEETS}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${await getAccessToken()}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Sheets API ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

interface SheetProps {
  sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
}

// Возвращает числовой id листа с таким названием; создаёт лист, если его ещё нет.
// Так пользователю достаточно создать пустую таблицу — имя вкладки не важно.
async function ensureTab(spreadsheetId: string, tab: string): Promise<number> {
  const meta = (await api(`${spreadsheetId}?fields=sheets.properties`)) as SheetProps;
  const found = meta.sheets?.find((s) => s.properties?.title === tab)?.properties?.sheetId;
  if (typeof found === "number") return found;

  const created = (await api(`${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
  })) as { replies?: Array<{ addSheet?: { properties?: { sheetId?: number } } }> };
  const id = created.replies?.[0]?.addSheet?.properties?.sheetId;
  if (typeof id !== "number") throw new Error(`Sheets: не удалось создать лист «${tab}»`);
  return id;
}

// Полная перезапись листа: сначала чистим всё, потом кладём новые значения.
// Так прогон идемпотентен и хвост от прошлого (более длинного) прогона не остаётся.
export async function syncSheet(values: Array<Array<string | number>>): Promise<void> {
  const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("SHEETS_SPREADSHEET_ID не задан");
  const tab = process.env.SHEETS_TAB || "Reels";

  const sheetId = await ensureTab(spreadsheetId, tab);
  const range = encodeURIComponent(`'${tab}'!A:Z`);

  await api(`${spreadsheetId}/values/${range}:clear`, { method: "POST", body: "{}" });
  await api(
    `${spreadsheetId}/values/${encodeURIComponent(`'${tab}'!A1`)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values }) }
  );

  // Косметика: закрепить и выделить шапку. Не критично — своя изоляция.
  try {
    await api(`${spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: "userEnteredFormat.textFormat.bold",
            },
          },
        ],
      }),
    });
  } catch (e) {
    console.error("sheet formatting failed:", e);
  }
}
