const BASE = "https://api.elevenlabs.io/v1";

// Бот делает одно направление, поэтому языки — константы, а не параметры.
export const SOURCE_LANG = "ru";
export const TARGET_LANG = "id";

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} не задан`);
  return v;
}

export class ElevenLabsError extends Error {
  constructor(readonly status: number, readonly body: string, action: string) {
    super(`ElevenLabs ${action} → ${status}: ${body.slice(0, 300)}`);
  }
}

async function xi(path: string, init: RequestInit = {}, action = path): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "xi-api-key": requireEnv("ELEVENLABS_API_KEY"), ...(init.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new ElevenLabsError(res.status, await res.text(), action);
  return res;
}

export interface CreatedDub {
  dubbingId: string;
  expectedSec: number | null;
}

export interface DubSource {
  /** Файл, скачанный из Telegram. Взаимоисключим с url. */
  file?: { buffer: Buffer; filename: string };
  /** Ссылка: ElevenLabs скачает ролик сам — так обходится лимит Telegram в 20 МБ. */
  url?: string;
  name: string;
  watermark: boolean;
}

export async function createDub(src: DubSource): Promise<CreatedDub> {
  const form = new FormData();
  if (src.file) {
    form.append("file", new Blob([new Uint8Array(src.file.buffer)], { type: "video/mp4" }), src.file.filename);
  } else if (src.url) {
    form.append("source_url", src.url);
  } else {
    throw new Error("createDub: нет ни файла, ни ссылки");
  }
  form.append("source_lang", SOURCE_LANG);
  form.append("target_lang", TARGET_LANG);
  form.append("num_speakers", process.env.DUB_SPEAKERS ?? "1");
  // Без этого ElevenLabs отдаёт видео пережатым: 1080×1920 возвращается как 1072×1904.
  form.append("highest_resolution", "true");
  form.append("watermark", String(src.watermark));
  form.append("name", src.name.slice(0, 100));

  const res = await xi("/dubbing", { method: "POST", body: form }, "createDub");
  const data = (await res.json()) as { dubbing_id: string; expected_duration_sec?: number };
  return { dubbingId: data.dubbing_id, expectedSec: data.expected_duration_sec ?? null };
}

// Водяной знак снимается только деньгами: на бесплатном тарифе watermark=false
// отвечает 403 subscription_required. Пробуем чистый вариант, откатываемся на знак.
export async function createDubPreferClean(
  src: Omit<DubSource, "watermark">
): Promise<CreatedDub & { watermarked: boolean }> {
  if (process.env.DUB_WATERMARK === "1") {
    return { ...(await createDub({ ...src, watermark: true })), watermarked: true };
  }
  try {
    return { ...(await createDub({ ...src, watermark: false })), watermarked: false };
  } catch (e) {
    if (e instanceof ElevenLabsError && e.status === 403 && /subscription/i.test(e.body)) {
      return { ...(await createDub({ ...src, watermark: true })), watermarked: true };
    }
    throw e;
  }
}

export interface DubStatus {
  status: string; // dubbing | dubbed | failed
  error: string | null;
  /** video/mp4 или audio/*: голосовое нельзя отдавать как видео. */
  contentType: string | null;
}

export async function getDubStatus(dubbingId: string): Promise<DubStatus> {
  const res = await xi(`/dubbing/${dubbingId}`, {}, "getDubStatus");
  const data = (await res.json()) as {
    status: string;
    error?: string | null;
    media_metadata?: { content_type?: string };
  };
  return {
    status: data.status,
    error: data.error ?? null,
    contentType: data.media_metadata?.content_type ?? null,
  };
}

export async function downloadDub(dubbingId: string): Promise<Buffer> {
  const res = await xi(`/dubbing/${dubbingId}/audio/${TARGET_LANG}`, {}, "downloadDub");
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Готовый перевод репликами с таймингами — тот же, что ElevenLabs положил в
 * озвучку. Свой разбор речи для субтитров не нужен: он уже сделан и оплачен.
 */
export async function getTranscript(dubbingId: string): Promise<string> {
  const res = await xi(
    `/dubbing/${dubbingId}/transcript/${TARGET_LANG}?format_type=srt`,
    {},
    "getTranscript"
  );
  return res.text();
}

export interface Subscription {
  tier: string;
  used: number;
  limit: number;
}

export async function getSubscription(): Promise<Subscription> {
  const res = await xi("/user/subscription", {}, "getSubscription");
  const d = (await res.json()) as { tier: string; character_count: number; character_limit: number };
  return { tier: d.tier, used: d.character_count, limit: d.character_limit };
}
