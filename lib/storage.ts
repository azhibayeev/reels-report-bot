import crypto from "node:crypto";
import { list, put } from "@vercel/blob";
import { Snapshot } from "./types";

const SNAP_PREFIX = "snapshots/";
const TOKEN_PATH = "state/token.enc";

const dateKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function jakartaDateKey(d: Date): string {
  return dateKeyFmt.format(d); // en-CA => YYYY-MM-DD
}

export async function saveSnapshot(key: string, snap: Snapshot): Promise<void> {
  await put(`${SNAP_PREFIX}${key}.json`, JSON.stringify(snap), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function loadPreviousSnapshot(todayKey: string): Promise<Snapshot | null> {
  const { blobs } = await list({ prefix: SNAP_PREFIX });
  const prev = blobs
    .filter((b) => b.pathname < `${SNAP_PREFIX}${todayKey}.json`)
    .sort((a, b) => (a.pathname < b.pathname ? 1 : -1))[0];
  if (!prev) return null;
  const res = await fetch(`${prev.url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as Snapshot;
}

export interface TokenState {
  token: string;
  refreshedAt: string;
  seedHash?: string;
}

export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// Токен хранится в Blob в зашифрованном виде: blob-URL публичный,
// а ключ шифрования выводится из CRON_SECRET, который есть только в env.
function encryptionKey(): Buffer {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set");
  return crypto.createHash("sha256").update(secret).digest();
}

export async function saveTokenState(state: TokenState): Promise<void> {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
  await put(TOKEN_PATH, payload, {
    access: "public",
    contentType: "text/plain",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function loadTokenState(): Promise<TokenState | null> {
  const { blobs } = await list({ prefix: TOKEN_PATH });
  const blob = blobs.find((b) => b.pathname === TOKEN_PATH);
  if (!blob) return null;
  const res = await fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  try {
    const buf = Buffer.from(await res.text(), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
    return JSON.parse(json) as TokenState;
  } catch {
    return null;
  }
}
