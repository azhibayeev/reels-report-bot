// Замерено на живом API: 334 кредита за 10-секундный ролик.
export const CREDITS_PER_MINUTE = 2000;

// Telegram скачивает по ссылке максимум 20 МБ, а принимает загрузкой — 50 МБ.
export const TELEGRAM_URL_LIMIT = 20 * 1024 * 1024;
export const TELEGRAM_UPLOAD_LIMIT = 50 * 1024 * 1024;

export type Delivery = "url" | "upload" | "link";

// Ноль означает «длительность не определилась» — тогда предварительную проверку
// баланса пропускаем, а не отказываем в загрузке.
export function estimateCredits(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.ceil((durationSec / 60) * CREDITS_PER_MINUTE);
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const total = Math.round(sec);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function pickDelivery(sizeBytes: number): Delivery {
  if (sizeBytes <= TELEGRAM_URL_LIMIT) return "url";
  if (sizeBytes <= TELEGRAM_UPLOAD_LIMIT) return "upload";
  return "link";
}
