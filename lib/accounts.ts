// ── Аккаунты Instagram, по которым бот ведёт отчётность.
// Всё, что различается между аккаунтами (переменные окружения, ключи в Blob,
// вкладки таблицы, подпись в сообщениях), собрано здесь: остальной код принимает
// конфиг параметром и не знает про конкретные аккаунты.
//
// ВАЖНО: пути daristeppe менять нельзя — по ним лежат снапшоты с 20.07.2026,
// на которых держатся приросты, график и вкладка History.

export interface AccountConfig {
  /** Ключ для ?account=/?only= и логов. */
  key: string;
  /** Подпись в заголовках сообщений Telegram. */
  label: string;
  userIdEnv: string;
  tokenEnv: string;
  /** Префикс ежедневных снапшотов в Blob; заканчивается «/». */
  snapshotPrefix: string;
  /** Зашифрованный токен доступа. */
  tokenPath: string;
  /** Кэш длительностей роликов (id → секунды). */
  durationsPath: string;
  reelsTabEnv: string;
  reelsTabDefault: string;
  historyTabEnv: string;
  historyTabDefault: string;
  /**
   * Условие HogQL, отбирающее заходы именно по ссылке этого аккаунта, — для линии
   * заходов на графике. null — линии нет (аккаунт не размечен в PostHog).
   */
  clicksCondition: string | null;
}

export const DARISTEPPE: AccountConfig = {
  key: "daristeppe",
  label: "@daristeppe",
  userIdEnv: "IG_USER_ID",
  tokenEnv: "IG_ACCESS_TOKEN",
  snapshotPrefix: "snapshots/",
  tokenPath: "state/token.enc",
  durationsPath: "state/durations.json",
  reelsTabEnv: "SHEETS_TAB",
  reelsTabDefault: "Reels",
  historyTabEnv: "SHEETS_HISTORY_TAB",
  historyTabDefault: "History",
  clicksCondition: "properties.utm_content = 'daristeppe'",
};

export const QURANY_APP: AccountConfig = {
  key: "qurany-app",
  label: "@qurany_app",
  userIdEnv: "IG_USER_ID_QURANY_APP",
  tokenEnv: "IG_ACCESS_TOKEN_QURANY_APP",
  // НЕ «snapshots/qurany-app/»: list() по префиксу «snapshots/» захватил бы
  // вложенные ключи, и чужие рилсы попали бы в отчёт daristeppe.
  snapshotPrefix: "snapshots-qurany-app/",
  tokenPath: "state/token-qurany-app.enc",
  durationsPath: "state/durations-qurany-app.json",
  reelsTabEnv: "SHEETS_TAB_QURANY_APP",
  reelsTabDefault: "Reels qurany_app",
  historyTabEnv: "SHEETS_HISTORY_TAB_QURANY_APP",
  historyTabDefault: "History qurany_app",
  // Старая метка link_in_bio — тот же аккаунт до переразметки ссылки.
  clicksCondition: "properties.utm_content IN ('qurany_app','link_in_bio')",
};

export const ACCOUNTS: AccountConfig[] = [DARISTEPPE, QURANY_APP];

export function accountByKey(key: string): AccountConfig | null {
  return ACCOUNTS.find((a) => a.key === key) ?? null;
}

/**
 * Аккаунты для прогона: по умолчанию все подключённые, с `only` — один названный.
 * Неизвестный ключ — ошибка: опечатка в ручной проверке иначе выглядела бы как
 * успешный прогон, в котором просто ничего не произошло.
 */
export function accountsToRun(only: string | null): AccountConfig[] {
  if (only) {
    const acc = accountByKey(only);
    if (!acc) throw new Error(`неизвестный аккаунт «${only}» (доступны: ${ACCOUNTS.map((a) => a.key).join(", ")})`);
    return accountConfigured(acc) ? [acc] : [];
  }
  return ACCOUNTS.filter(accountConfigured);
}

export function accountUserId(acc: AccountConfig): string {
  const id = process.env[acc.userIdEnv];
  if (!id) throw new Error(`${acc.userIdEnv} is not set`);
  return id;
}

/** Аккаунт подключён, если задан его IG id (токен догоняется из Blob). */
export function accountConfigured(acc: AccountConfig): boolean {
  return Boolean(process.env[acc.userIdEnv]);
}

export function reelsTabOf(acc: AccountConfig): string {
  return process.env[acc.reelsTabEnv] || acc.reelsTabDefault;
}

export function historyTabOf(acc: AccountConfig): string {
  return process.env[acc.historyTabEnv] || acc.historyTabDefault;
}
