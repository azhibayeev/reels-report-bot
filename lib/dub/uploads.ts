// Чистый модуль без @vercel/blob: его константы нужны и странице загрузки в
// браузере, а тянуть туда серверный клиент Blob ради двух чисел незачем.

export const SOURCES_PREFIX = "dub/sources/";
export const OUT_PREFIX = "dub/out/";

// Потолок загрузки. Выше смысла нет: ElevenLabs отдаёт дубляж примерно того же
// веса, а всё, что не влезло в 50 МБ Telegram, человеку придётся забирать
// ссылкой — терпимо разово, но плохо как норма.
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

// Что вообще имеет смысл дублировать. Список тот же, что у фермы: Safari на
// айфоне отдаёт .mov как video/quicktime, а не video/mp4.
export const ALLOWED_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-matroska",
  "video/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/x-m4a",
  "audio/wav",
  "audio/ogg",
];

/**
 * Имя в Blob: кириллица и пробелы в pathname выходят боком при разборе URL.
 * Целиком кириллическое имя схлопывается в одно расширение, поэтому всё, что не
 * начинается с буквы или цифры, получает приставку — «.mp4» именем быть не должен.
 */
export function safeName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return /^[a-zA-Z0-9]/.test(cleaned) ? cleaned : `video${cleaned}`;
}

/** Исходник кладём под id задачи: так по осиротевшему файлу видно, чей он был. */
export function sourcePath(jobId: string, filename: string): string {
  return `${SOURCES_PREFIX}${jobId}-${safeName(filename)}`;
}

export function resultPath(jobId: string, filename: string): string {
  return `${OUT_PREFIX}${jobId}-${safeName(filename)}`;
}
