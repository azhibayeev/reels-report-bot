/**
 * Отчёт о ключах доступа для команды /token.
 *
 * Понадобился после того, как первая живая публикация упала с «Invalid OAuth
 * access token — Cannot parse access token», а проверить ключ было нечем:
 * переменные окружения Vercel наружу не отдаёт, и единственным способом узнать,
 * годится ли токен, оставалась сама попытка публикации — то есть сгоревший ролик.
 */

// Права, без которых заливка в Trial Reels не работает, сколько бы токен ни жил.
export const REQUIRED_SCOPES = ["instagram_basic", "instagram_content_publish"];

export interface TokenCheck {
  valid: boolean;
  expiresAt: number | null;
  scopes: string[];
}

export interface TokenSubject {
  /** Как назвать ключ человеку. */
  label: string;
  /** Имя переменной окружения — его показывать можно, значение нельзя. */
  env: string;
  value: string | undefined;
}

/**
 * Вырезает из текста всё, что похоже на сам токен.
 *
 * Сообщения Graph обычно ключ не содержат, но «обычно» тут мало: ответ уходит
 * в чат, а чат пересылают и показывают с экрана. Один раз токен уже утёк
 * именно так — через безобидную на вид выдачу.
 */
export function redactSecrets(text: string, secrets: (string | undefined)[]): string {
  let safe = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 8) safe = safe.split(secret).join("…");
  }
  // И на всякий случай — любая длинная сплошная строка из алфавита токенов.
  return safe.replace(/[A-Za-z0-9_-]{40,}/g, "…");
}

function formatExpiry(expiresAt: number | null, nowMs: number): string {
  if (expiresAt === null) return "бессрочный";
  const days = Math.floor((expiresAt - nowMs) / 86_400_000);
  if (days < 0) return "истёк";
  if (days === 0) return "истекает сегодня";
  return `истекает через ${days} дн.`;
}

export interface ReportDeps {
  now: () => number;
  checkToken: (token: string) => Promise<TokenCheck>;
}

export async function formatTokenReport(subjects: TokenSubject[], deps: ReportDeps): Promise<string> {
  const secrets = subjects.map((s) => s.value);
  const lines: string[] = ["🔑 <b>Ключи доступа</b>"];

  for (const subject of subjects) {
    lines.push("");
    lines.push(`<b>${subject.label}</b> (${subject.env})`);

    if (!subject.value) {
      lines.push("не задан");
      continue;
    }
    // Пробелы и переносы внутри ключа — самая частая порча при вставке, и
    // именно она даёт «Cannot parse access token». Сказать об этом прямо
    // дешевле, чем гадать по ответу Graph.
    if (/\s/.test(subject.value)) {
      lines.push("⚠️ внутри значения есть пробел или перенос строки — ключ вставлен с мусором");
      continue;
    }

    let check: TokenCheck;
    try {
      check = await deps.checkToken(subject.value);
    } catch (error) {
      lines.push(`не удалось проверить: ${redactSecrets((error as Error).message, secrets)}`);
      continue;
    }

    if (!check.valid) {
      lines.push("❌ недействителен — отозван или истёк, нужен новый");
      continue;
    }

    const missing = REQUIRED_SCOPES.filter((s) => !check.scopes.includes(s));
    lines.push(`✅ действителен, ${formatExpiry(check.expiresAt, deps.now())}`);
    if (missing.length) {
      lines.push(`⚠️ не хватает прав: ${missing.join(", ")} — публиковать не сможет`);
    } else {
      lines.push("прав на публикацию хватает");
    }
  }

  return lines.join("\n");
}
