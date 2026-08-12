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

export const reelsTab = (): string => process.env.SHEETS_TAB || "Reels";
export const historyTab = (): string => process.env.SHEETS_HISTORY_TAB || "History";

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

interface GridProps {
  sheetId?: number;
  title?: string;
  gridProperties?: { rowCount?: number; columnCount?: number };
}

interface SheetProps {
  sheets?: Array<{ properties?: GridProps }>;
}

// Возвращает лист с таким названием; создаёт, если его ещё нет — пользователю
// достаточно создать пустую таблицу, имя вкладки по умолчанию не важно.
// Сразу же расширяет сетку под нужный размер: values.update не растит лист сам и
// падает с "exceeds grid limits", если данных больше, чем строк/колонок в листе.
async function ensureTab(
  spreadsheetId: string,
  tab: string,
  rows: number,
  cols: number
): Promise<number> {
  const meta = (await api(`${spreadsheetId}?fields=sheets.properties`)) as SheetProps;
  const found = meta.sheets?.find((s) => s.properties?.title === tab)?.properties;

  if (!found || typeof found.sheetId !== "number") {
    const created = (await api(`${spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [
          { addSheet: { properties: { title: tab, gridProperties: { rowCount: rows, columnCount: cols } } } },
        ],
      }),
    })) as { replies?: Array<{ addSheet?: { properties?: { sheetId?: number } } }> };
    const id = created.replies?.[0]?.addSheet?.properties?.sheetId;
    if (typeof id !== "number") throw new Error(`Sheets: не удалось создать лист «${tab}»`);
    return id;
  }

  const haveRows = found.gridProperties?.rowCount ?? 0;
  const haveCols = found.gridProperties?.columnCount ?? 0;
  if (haveRows < rows || haveCols < cols) {
    await api(`${spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: found.sheetId,
                gridProperties: {
                  rowCount: Math.max(haveRows, rows),
                  columnCount: Math.max(haveCols, cols),
                },
              },
              fields: "gridProperties.rowCount,gridProperties.columnCount",
            },
          },
        ],
      }),
    });
  }
  return found.sheetId;
}

/**
 * `row` — своя шкала у каждой строки (матрица истории: сравниваем дни одного ролика).
 * `column` — своя шкала у каждой колонки (лист Reels: сравниваем ролики между собой).
 * Одним правилом ни то, ни другое не делается: градиент Sheets считается по всему
 * диапазону правила, поэтому кладём по правилу на строку либо на колонку.
 */
export interface Heatmap {
  kind: "row" | "column";
  /** 0-based индекс первой строки с данными (шапка не входит). */
  startRowIndex: number;
  rowCount: number;
  startColumnIndex: number;
  endColumnIndex: number;
  scale: "green" | "redYellowGreen";
}

const rgb = (hex: string) => ({
  red: parseInt(hex.slice(1, 3), 16) / 255,
  green: parseInt(hex.slice(3, 5), 16) / 255,
  blue: parseInt(hex.slice(5, 7), 16) / 255,
});

// Последовательная шкала: один тон, светлое → насыщенное. Чёрный текст читается
// на всех ступенях (контраст ≥ 7:1), поэтому цвет шрифта менять не нужно.
const SCALES = {
  green: { min: rgb("#ffffff"), mid: rgb("#98dbc3"), max: rgb("#1baf7a") },
  // Красный→жёлтый→зелёный: выбор пользователя, повторяем его ручную разметку
  // один в один. Оговорка: при красно-зелёной слепоте концы шкалы неразличимы.
  redYellowGreen: { min: rgb("#e67c73"), mid: rgb("#ffd666"), max: rgb("#57bb8a") },
} as const;

const RULES_PER_BATCH = 100;

// Правил становится по одному на ролик, а роликов прибавляется ~10–20 в день.
// Ограничиваем, иначе через полгода лист станет неповоротливым: красим самые
// свежие ролики (они сверху), остальные остаются без заливки — о чём пишем в лог.
const MAX_HEATMAP_ROWS = 400;

/** Чистая сборка запросов условного форматирования — тестируется без сети. */
export function buildHeatmapRequests(sheetId: number, h: Heatmap): unknown[] {
  const scale = SCALES[h.scale];
  const gradientRule = {
    minpoint: { color: scale.min, type: "MIN" },
    midpoint: { color: scale.mid, type: "PERCENTILE", value: "50" },
    maxpoint: { color: scale.max, type: "MAX" },
  };
  const rule = (range: Record<string, number>) => ({
    addConditionalFormatRule: { index: 0, rule: { ranges: [{ sheetId, ...range }], gradientRule } },
  });

  if (h.kind === "column") {
    const out: unknown[] = [];
    for (let c = h.startColumnIndex; c < h.endColumnIndex; c++) {
      out.push(
        rule({
          startRowIndex: h.startRowIndex,
          endRowIndex: h.startRowIndex + h.rowCount,
          startColumnIndex: c,
          endColumnIndex: c + 1,
        })
      );
    }
    return out;
  }

  const painted = Math.min(h.rowCount, MAX_HEATMAP_ROWS);
  if (painted < h.rowCount) {
    console.log(`heatmap: покрашено ${painted} строк из ${h.rowCount}, остальные без заливки`);
  }
  const out: unknown[] = [];
  for (let r = 0; r < painted; r++) {
    out.push(
      rule({
        startRowIndex: h.startRowIndex + r,
        endRowIndex: h.startRowIndex + r + 1,
        startColumnIndex: h.startColumnIndex,
        endColumnIndex: h.endColumnIndex,
      })
    );
  }
  return out;
}

async function applyHeatmaps(spreadsheetId: string, sheetId: number, maps: Heatmap[]): Promise<void> {
  // Значения мы перезаписываем, но правила остаются жить на листе — без чистки
  // они копились бы с каждым прогоном.
  const meta = (await api(
    `${spreadsheetId}?fields=sheets(properties.sheetId,conditionalFormats)`
  )) as { sheets?: Array<{ properties?: { sheetId?: number }; conditionalFormats?: unknown[] }> };
  const existing =
    meta.sheets?.find((s) => s.properties?.sheetId === sheetId)?.conditionalFormats?.length ?? 0;

  const requests: unknown[] = [];
  for (let i = existing - 1; i >= 0; i--) requests.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  for (const h of maps) requests.push(...buildHeatmapRequests(sheetId, h));

  for (let i = 0; i < requests.length; i += RULES_PER_BATCH) {
    await api(`${spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: requests.slice(i, i + RULES_PER_BATCH) }),
    });
  }
}

// Полная перезапись листа: сначала чистим всё, потом кладём новые значения.
// Так прогон идемпотентен и хвост от прошлого (более длинного) прогона не остаётся.
// freezeCols — сколько левых колонок закрепить (для широкой матрицы истории).
export async function syncSheet(
  values: Array<Array<string | number>>,
  tab: string,
  freezeCols = 0,
  heatmaps: Heatmap[] = []
): Promise<void> {
  const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("SHEETS_SPREADSHEET_ID не задан");

  const needRows = Math.max(values.length + 10, 100);
  const needCols = Math.max(...values.map((r) => r.length), 26);
  const sheetId = await ensureTab(spreadsheetId, tab, needRows, needCols);

  // Диапазон = имя листа целиком: чистим и старые колонки тоже, а не только A:Z.
  const range = encodeURIComponent(`'${tab}'`);
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
              properties: { sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: freezeCols } },
              fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
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

  // Тепловые карты — тоже косметика: их отказ не должен ронять запись данных.
  const usable = heatmaps.filter((h) => h.rowCount > 0 && h.endColumnIndex > h.startColumnIndex);
  if (usable.length > 0) {
    try {
      await applyHeatmaps(spreadsheetId, sheetId, usable);
    } catch (e) {
      console.error("sheet heatmap failed:", e);
    }
  }
}
