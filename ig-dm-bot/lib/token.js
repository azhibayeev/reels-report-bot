// ── Хранение и обновление долгоживущего IG-токена.
// Живой токен лежит в Vercel Blob (ig-token.json). При первом запуске берётся из env IG_TOKEN_SEED.
// Крон /api/refresh раз в ~месяц продлевает токен (IG long-lived живёт 60 дней, refresh даёт ещё 60).

import { put, list } from "@vercel/blob";
import { GRAPH } from "./config.js";

const BLOB_KEY = "ig-token.json";
let cached = null; // прогретый инстанс переиспользует

async function readBlobToken() {
  try {
    const { blobs } = await list({ prefix: BLOB_KEY });
    const b = blobs.find((x) => x.pathname === BLOB_KEY);
    if (!b) return null;
    const res = await fetch(b.url, { cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    return j.access_token || null;
  } catch {
    return null;
  }
}

export async function getToken() {
  if (cached) return cached;
  const fromBlob = await readBlobToken();
  cached = fromBlob || process.env.IG_TOKEN_SEED || null;
  return cached;
}

export async function saveToken(token) {
  cached = token;
  await put(BLOB_KEY, JSON.stringify({ access_token: token, updated_at: new Date().toISOString() }), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

// Продлить токен на 60 дней
export async function refreshToken() {
  const cur = await getToken();
  if (!cur) throw new Error("no current token");
  const url = `${GRAPH.replace("/v21.0", "")}/refresh_access_token?grant_type=ig_refresh_token&access_token=${cur}`;
  const res = await fetch(url);
  const j = await res.json();
  if (!j.access_token) throw new Error("refresh failed: " + JSON.stringify(j));
  await saveToken(j.access_token);
  return { expires_in: j.expires_in };
}
