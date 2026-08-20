export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// Страница загрузки публична, а обработка стоит денег: команды принимаем
// только от перечисленных чатов.
export function allowedChatIds(): number[] {
  return requireEnv("TELEGRAM_ALLOWED_CHAT_IDS")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isFinite(id));
}

// Нужен, чтобы собрать ссылку на страницу загрузки и на само-вызов обработки.
export function baseUrl(): string {
  const explicit = process.env.SUB_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (host) return `https://${host}`;
  throw new Error("SUB_BASE_URL is not set");
}
