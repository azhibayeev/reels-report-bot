const BASE = "https://api.elevenlabs.io/v1";

// Бот делает ровно одно направление, поэтому языки — константы, а не параметры.
export const SOURCE_LANG = "ru";
export const TARGET_LANG = "id";

async function fail(action: string, res: Response): Promise<never> {
  throw new Error(`ElevenLabs ${action} failed (${res.status}): ${await res.text()}`);
}

export interface Subscription {
  tier: string;
  used: number;
  limit: number;
  remaining: number;
}

export async function getSubscription(apiKey: string): Promise<Subscription> {
  const res = await fetch(`${BASE}/user/subscription`, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (!res.ok) await fail("getSubscription", res);
  const data = (await res.json()) as {
    tier: string;
    character_count: number;
    character_limit: number;
  };
  return {
    tier: data.tier,
    used: data.character_count,
    limit: data.character_limit,
    remaining: Math.max(0, data.character_limit - data.character_count),
  };
}

export async function createDub(
  apiKey: string,
  opts: { sourceUrl: string; watermark: boolean; name: string }
): Promise<string> {
  // Файл не грузим — ElevenLabs сам скачает ролик по публичной ссылке из Blob.
  const form = new FormData();
  form.append("source_url", opts.sourceUrl);
  form.append("source_lang", SOURCE_LANG);
  form.append("target_lang", TARGET_LANG);
  form.append("num_speakers", "1");
  form.append("watermark", String(opts.watermark));
  form.append("name", opts.name);

  const res = await fetch(`${BASE}/dubbing`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!res.ok) await fail("createDub", res);
  const data = (await res.json()) as { dubbing_id: string };
  return data.dubbing_id;
}

export interface DubStatus {
  status: string;
  error: string | null;
  durationSec: number | null;
}

export async function getDubStatus(apiKey: string, dubbingId: string): Promise<DubStatus> {
  const res = await fetch(`${BASE}/dubbing/${dubbingId}`, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (!res.ok) await fail("getDubStatus", res);
  const data = (await res.json()) as {
    status: string;
    error?: string | null;
    media_metadata?: { duration?: number };
  };
  return {
    status: data.status,
    error: data.error ?? null,
    durationSec: data.media_metadata?.duration ?? null,
  };
}

// Отдаёт готовый MP4 потоком: наружу возвращаем сам Response, чтобы тело можно
// было перелить в Blob не буферизуя целиком.
export async function downloadDub(apiKey: string, dubbingId: string): Promise<Response> {
  const res = await fetch(`${BASE}/dubbing/${dubbingId}/audio/${TARGET_LANG}`, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (!res.ok) await fail("downloadDub", res);
  return res;
}
